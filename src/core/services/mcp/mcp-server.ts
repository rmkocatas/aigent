// ============================================================
// OpenClaw Deploy — MCP Memory & Agent Server
// ============================================================
//
// Exposes MoltBot's semantic memory, tools, and autonomous
// task state via the Model Context Protocol (MCP).
//
// External clients (Claude Desktop, Cursor, other MCP clients)
// can connect to read memory, execute tools, and monitor agents.
//
// Uses per-session transport management: each client gets its
// own McpServer + StreamableHTTPServerTransport instance.
// ============================================================

import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { authenticateRequest } from '../../gateway/auth.js';
import type { McpConfig } from './types.js';
import type { SharedAgentState } from './shared-state.js';
import type { MemoryEngine } from '../memory/memory-engine.js';
import type { ToolRegistry, ToolContext } from '../../tools/registry.js';
import type { ToolsConfig } from '../../../types/index.js';

export interface McpServerDeps {
  config: McpConfig;
  memoryEngine?: MemoryEngine;
  toolRegistry?: ToolRegistry;
  toolsConfig?: ToolsConfig;
  sharedAgentState: SharedAgentState;
  getActiveTasks: () => Array<{ id: string; goal: string; status: string; subtaskCount: number }>;
  getTaskDetails: (taskId: string) => Record<string, unknown> | null;
}

export class OpenClawMcpServer {
  private httpServer: HttpServer | null = null;
  private readonly deps: McpServerDeps;
  private readonly transports = new Map<string, StreamableHTTPServerTransport>();
  private toolCount = 0;

  constructor(deps: McpServerDeps) {
    this.deps = deps;

    // Count available tools for logging
    if (deps.toolRegistry && deps.toolsConfig) {
      this.toolCount = deps.toolRegistry.getAvailableTools(deps.toolsConfig).length;
      console.log(`[mcp] Registered ${this.toolCount} tools`);
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.deps.config.transport === 'sse') {
      await this.startHttpTransport();
    }
  }

  async stop(): Promise<void> {
    // Close all active sessions
    for (const [, transport] of this.transports) {
      try {
        await transport.close();
      } catch {
        // Ignore close errors during shutdown
      }
    }
    this.transports.clear();

    if (this.httpServer) {
      await new Promise<void>((resolve, reject) => {
        this.httpServer!.close((err) => (err ? reject(err) : resolve()));
      });
      this.httpServer = null;
    }
  }

  // ── HTTP Transport ───────────────────────────────────────────

  private async startHttpTransport(): Promise<void> {
    const port = this.deps.config.port;

    this.httpServer = createServer(async (req, res) => {
      // Only handle /mcp endpoint
      if (!req.url?.startsWith('/mcp')) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      // CORS headers — restrict to localhost only
      const origin = req.headers.origin ?? '';
      const allowedOrigins = [
        `http://127.0.0.1:${port}`,
        `http://localhost:${port}`,
      ];
      if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
      }
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Mcp-Session-Id, Last-Event-Id, Mcp-Protocol-Version');
      res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // Bearer token authentication (if token is configured)
      if (this.deps.config.token) {
        const authResult = authenticateRequest(req, this.deps.config.token);
        if (!authResult.authenticated) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: authResult.error }));
          return;
        }
      }

      try {
        switch (req.method) {
          case 'POST':
            await this.handlePost(req, res);
            break;
          case 'GET':
            await this.handleGet(req, res);
            break;
          case 'DELETE':
            await this.handleDelete(req, res);
            break;
          default:
            res.writeHead(405, { Allow: 'GET, POST, DELETE, OPTIONS' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32000, message: 'Method not allowed' },
              id: null,
            }));
        }
      } catch (err) {
        console.error('[mcp] Request handling error:', err);
        if (!res.headersSent) {
          this.sendJsonError(res, 500, -32603, 'Internal server error');
        }
      }
    });

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.on('error', reject);
      this.httpServer!.listen(port, '127.0.0.1', () => {
        console.log(`[mcp] MCP server listening on http://127.0.0.1:${port}/mcp`);
        resolve();
      });
    });
  }

  // ── POST: JSON-RPC messages (initialize + subsequent) ────────

  private async handlePost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    if (body === undefined) {
      this.sendJsonError(res, 400, -32700, 'Parse error: Invalid JSON');
      return;
    }

    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    // Existing session — reuse its transport
    if (sessionId && this.transports.has(sessionId)) {
      const transport = this.transports.get(sessionId)!;
      await transport.handleRequest(req, res, body);
      return;
    }

    // New session — create transport + server
    if (!sessionId && isInitializeRequest(body)) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid: string) => {
          console.log(`[mcp] Session initialized: ${sid.slice(0, 8)}…`);
          this.transports.set(sid, transport);
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid && this.transports.has(sid)) {
          console.log(`[mcp] Session closed: ${sid.slice(0, 8)}…`);
          this.transports.delete(sid);
        }
      };

      // Wire a fresh McpServer to this transport
      const mcpServer = this.createSessionServer();
      await mcpServer.connect(transport);

      await transport.handleRequest(req, res, body);
      return;
    }

    // Invalid request
    this.sendJsonError(res, 400, -32000, 'Bad Request: No valid session ID or not an initialize request');
  }

  // ── GET: SSE stream for server-initiated notifications ───────

  private async handleGet(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !this.transports.has(sessionId)) {
      this.sendJsonError(res, 400, -32000, 'Invalid or missing session ID');
      return;
    }

    await this.transports.get(sessionId)!.handleRequest(req, res);
  }

  // ── DELETE: session termination ──────────────────────────────

  private async handleDelete(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !this.transports.has(sessionId)) {
      this.sendJsonError(res, 400, -32000, 'Invalid or missing session ID');
      return;
    }

    await this.transports.get(sessionId)!.handleRequest(req, res);
  }

  // ── Session Server Factory ───────────────────────────────────
  // Each MCP session gets its own McpServer with resources/tools/prompts

  private createSessionServer(): McpServer {
    const mcpServer = new McpServer({
      name: 'openclaw-moltbot',
      version: '1.0.0',
    });

    this.registerResources(mcpServer);
    this.registerTools(mcpServer);
    this.registerPrompts(mcpServer);

    return mcpServer;
  }

  // ── Resources ──────────────────────────────────────────────

  private registerResources(mcpServer: McpServer): void {
    if (this.deps.config.exposeMemory && this.deps.memoryEngine) {
      this.registerMemoryResources(mcpServer);
    }
    if (this.deps.config.exposeAgentState) {
      this.registerAgentResources(mcpServer);
    }
  }

  private registerMemoryResources(mcpServer: McpServer): void {
    const engine = this.deps.memoryEngine!;

    const searchTemplate = new ResourceTemplate(
      'memory://user/{userId}/search/{query}',
      { list: undefined },
    );

    mcpServer.resource(
      'memory-search',
      searchTemplate,
      async (uri, variables) => {
        const userId = String(variables.userId);
        const query = decodeURIComponent(String(variables.query));
        const results = await engine.search(userId, query, 10);
        const text = results.length === 0
          ? 'No memories found.'
          : results.map((r) =>
              `[${r.entry.layer}] (${r.score.toFixed(2)}) ${r.entry.fact}`,
            ).join('\n');

        return {
          contents: [{
            uri: uri.href,
            mimeType: 'text/plain',
            text,
          }],
        };
      },
    );
  }

  private registerAgentResources(mcpServer: McpServer): void {
    const deps = this.deps;

    // List active autonomous tasks
    mcpServer.resource(
      'agent-tasks',
      'agents://tasks',
      async (uri) => {
        const tasks = deps.getActiveTasks();
        const text = tasks.length === 0
          ? 'No active autonomous tasks.'
          : tasks.map((t) =>
              `[${t.id.slice(0, 8)}] ${t.status} — ${t.goal} (${t.subtaskCount} subtasks)`,
            ).join('\n');

        return {
          contents: [{
            uri: uri.href,
            mimeType: 'text/plain',
            text,
          }],
        };
      },
    );

    // Get task details
    const taskTemplate = new ResourceTemplate(
      'agents://tasks/{taskId}',
      { list: undefined },
    );

    mcpServer.resource(
      'agent-task-detail',
      taskTemplate,
      async (uri, variables) => {
        const taskId = String(variables.taskId);
        const details = deps.getTaskDetails(taskId);
        const text = details
          ? JSON.stringify(details, null, 2)
          : `Task ${taskId} not found.`;

        return {
          contents: [{
            uri: uri.href,
            mimeType: details ? 'application/json' : 'text/plain',
            text,
          }],
        };
      },
    );

    // Get shared agent state for a task
    const stateTemplate = new ResourceTemplate(
      'agents://state/{taskId}',
      { list: undefined },
    );

    mcpServer.resource(
      'agent-shared-state',
      stateTemplate,
      async (uri, variables) => {
        const taskId = String(variables.taskId);
        const state = deps.sharedAgentState.getAll(taskId);
        const text = Object.keys(state).length === 0
          ? `No shared state for task ${taskId}.`
          : JSON.stringify(state, null, 2);

        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text,
          }],
        };
      },
    );
  }

  // ── Tools ──────────────────────────────────────────────────

  private registerTools(mcpServer: McpServer): void {
    const { toolRegistry, toolsConfig, config } = this.deps;
    if (!toolRegistry || !toolsConfig) return;

    const availableTools = toolRegistry.getAvailableTools(toolsConfig);
    const exposedNames = config.exposedTools
      ? new Set(config.exposedTools)
      : null; // null = expose all allowed

    for (const toolDef of availableTools) {
      if (exposedNames && !exposedNames.has(toolDef.name)) continue;

      // Build a zod schema from the tool's JSON Schema properties
      const zodShape: Record<string, z.ZodTypeAny> = {};
      const required = new Set(toolDef.parameters.required ?? []);

      for (const [key, prop] of Object.entries(toolDef.parameters.properties)) {
        let field: z.ZodTypeAny;
        switch (prop.type) {
          case 'number':
          case 'integer':
            field = z.number().describe(prop.description);
            break;
          case 'boolean':
            field = z.boolean().describe(prop.description);
            break;
          case 'array':
            field = z.array(z.string()).describe(prop.description);
            break;
          default:
            field = prop.enum
              ? z.enum(prop.enum as [string, ...string[]]).describe(prop.description)
              : z.string().describe(prop.description);
        }

        zodShape[key] = required.has(key) ? field : field.optional();
      }

      const handler = toolRegistry.getHandler(toolDef.name);
      if (!handler) continue;

      const toolName = toolDef.name;
      mcpServer.tool(
        toolName,
        toolDef.description,
        zodShape,
        async (args) => {
          const context: ToolContext = {
            workspaceDir: toolsConfig.workspaceDir,
            memoryDir: toolsConfig.workspaceDir.replace(/workspace\/?$/, 'memory'),
            conversationId: `mcp-${randomUUID().slice(0, 8)}`,
            userId: 'mcp-client',
            maxExecutionMs: toolsConfig.maxExecutionMs,
            allowedProjectDirs: toolsConfig.allowedProjectDirs,
          };

          try {
            const result = await handler(args as Record<string, unknown>, context);
            return { content: [{ type: 'text' as const, text: result }] };
          } catch (err) {
            return {
              content: [{
                type: 'text' as const,
                text: `Error: ${err instanceof Error ? err.message : String(err)}`,
              }],
              isError: true,
            };
          }
        },
      );
    }
  }

  // ── Prompts ────────────────────────────────────────────────

  private registerPrompts(mcpServer: McpServer): void {
    mcpServer.prompt(
      'research',
      'Research a topic thoroughly using web search and summarize findings',
      { topic: z.string().describe('The topic to research') },
      async (args) => ({
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Research the following topic thoroughly. Use web_search to find current information, ` +
              `then summarize the key findings with sources.\n\nTopic: ${args.topic}`,
          },
        }],
      }),
    );

    mcpServer.prompt(
      'analyze',
      'Analyze data and provide structured insights',
      { data: z.string().describe('The data or topic to analyze') },
      async (args) => ({
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Analyze the following data and provide structured insights ` +
              `with key findings, patterns, and recommendations.\n\nData: ${args.data}`,
          },
        }],
      }),
    );

    mcpServer.prompt(
      'remember-context',
      'Recall relevant memories about a user and topic',
      {
        userId: z.string().describe('The user ID to recall memories for'),
        topic: z.string().describe('The topic or context to search for'),
      },
      async (args) => ({
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Use memory_recall to search for memories about "${args.topic}" for user ${args.userId}. ` +
              `Summarize what you know about this user and topic from past conversations.`,
          },
        }],
      }),
    );
  }

  // ── Helpers ────────────────────────────────────────────────

  private async readBody(req: IncomingMessage): Promise<unknown | undefined> {
    return new Promise<unknown | undefined>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch {
          resolve(undefined);
        }
      });
      req.on('error', reject);
    });
  }

  private sendJsonError(res: ServerResponse, status: number, code: number, message: string): void {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      error: { code, message },
      id: null,
    });
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body);
  }
}
