import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GatewayRuntimeConfig } from '../../types/index.js';
import type { SessionStore } from './session-store.js';
import type { TrainingDataStore } from '../training/data-collector.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { SkillLoader } from '../services/skill-loader.js';
import type { MemoryEngine } from '../services/memory/memory-engine.js';
import type { CostTracker } from '../services/cost-tracker.js';
import { processChatMessage } from './chat-pipeline.js';
import { initSSE, writeSSE, endSSE, errorSSE } from './sse.js';
import { WEBCHAT_HTML } from './webchat.js';
import { redactSensitive } from '../services/log-redactor.js';

export interface HandlerDeps {
  config: GatewayRuntimeConfig;
  sessions: SessionStore;
  trainingStore: TrainingDataStore | null;
  toolRegistry?: ToolRegistry;
  skillLoader?: SkillLoader;
  memoryEngine?: MemoryEngine;
  strategyEngine?: import('../services/strategies/strategy-engine.js').StrategyEngine;
  costTracker?: CostTracker;
  responseCache?: import('./response-cache.js').ResponseCache;
  pipelineHooks?: import('../services/pipeline-hooks.js').PipelineHooks;
  personaManager?: import('../services/persona-manager.js').PersonaManager;
  documentMemory?: import('../services/document-memory/document-memory.js').DocumentMemoryEngine;
}

const MAX_BODY_SIZE = 100_000; // 100KB
const MAX_MESSAGE_LENGTH = 32_000; // 32KB — prevents token exhaustion

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

export function handleHealth(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  }));
}

export function handleWebchat(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(WEBCHAT_HTML);
}

export function handleConfig(
  _req: IncomingMessage,
  res: ServerResponse,
  deps: HandlerDeps,
): void {
  const pub = {
    routing: deps.config.routing
      ? {
          mode: deps.config.routing.mode,
          primary: deps.config.routing.primary,
          rules: deps.config.routing.rules?.map((r) => ({
            condition: r.condition,
            provider: r.provider,
          })),
        }
      : null,
    ollama: deps.config.ollama ? { model: deps.config.ollama.model } : null,
    session: deps.config.session,
    training: deps.config.training ? { enabled: deps.config.training.enabled } : null,
  };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(pub));
}

export async function handleChat(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HandlerDeps,
): Promise<void> {
  try {
    const body = await readBody(req);
    const parsed = JSON.parse(body);
    const message = parsed.message;

    if (!message || typeof message !== 'string' || !message.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing or empty message' }));
      return;
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)` }));
      return;
    }

    // Start SSE
    initSSE(res);

    try {
      await processChatMessage(
        {
          message,
          conversationId: parsed.conversationId,
          source: 'webchat',
        },
        {
          config: deps.config,
          sessions: deps.sessions,
          trainingStore: deps.trainingStore,
          toolRegistry: deps.toolRegistry,
          skillLoader: deps.skillLoader,
          memoryEngine: deps.memoryEngine,
          strategyEngine: deps.strategyEngine,
          costTracker: deps.costTracker,
          responseCache: deps.responseCache,
          pipelineHooks: deps.pipelineHooks,
          personaManager: deps.personaManager,
          documentMemory: deps.documentMemory,
        },
        {
          onMeta: (meta) =>
            writeSSE(res, { event: 'meta', data: JSON.stringify(meta) }),
          onChunk: (content) =>
            writeSSE(res, { event: 'chunk', data: JSON.stringify({ content }) }),
          onFallback: (from, to) =>
            writeSSE(res, { event: 'fallback', data: JSON.stringify({ from, to }) }),
          onToolUse: (tool, input) =>
            writeSSE(res, { event: 'tool_use', data: JSON.stringify({ tool, input }) }),
          onToolResult: (tool, result, isError) =>
            writeSSE(res, { event: 'tool_result', data: JSON.stringify({ tool, result: result.slice(0, 500), isError }) }),
        },
      );

      endSSE(res);
    } catch (err) {
      errorSSE(res, redactSensitive((err as Error).message));
    }
  } catch (err) {
    const safeMsg = redactSensitive((err as Error).message);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeMsg }));
    } else {
      errorSSE(res, safeMsg);
    }
  }
}
