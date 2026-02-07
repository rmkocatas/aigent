import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GatewayRuntimeConfig } from '../../types/index.js';
import type { SessionStore } from './session-store.js';
import type { TrainingDataStore } from '../training/data-collector.js';
import type { ToolRegistry } from '../tools/registry.js';
import { processChatMessage } from './chat-pipeline.js';
import { initSSE, writeSSE, endSSE, errorSSE } from './sse.js';
import { WEBCHAT_HTML } from './webchat.js';

export interface HandlerDeps {
  config: GatewayRuntimeConfig;
  sessions: SessionStore;
  trainingStore: TrainingDataStore | null;
  toolRegistry?: ToolRegistry;
}

const MAX_BODY_SIZE = 100_000; // 100KB

function readBody(req: IncomingMessage): Promise<string> {
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
      errorSSE(res, (err as Error).message);
    }
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    } else {
      errorSSE(res, (err as Error).message);
    }
  }
}
