// ============================================================
// OpenClaw Deploy — MCP Server Types
// ============================================================

export interface McpConfig {
  enabled: boolean;
  /** Transport mode: 'sse' for HTTP Server-Sent Events, 'stdio' for stdin/stdout. */
  transport: 'stdio' | 'sse';
  /** Port for SSE transport (default: 18790). */
  port: number;
  /** Bearer token for authentication (same as gateway token). If unset, MCP server is unauthenticated. */
  token?: string;
  /** Tool names to expose via MCP (default: all allowed tools). */
  exposedTools?: string[];
  /** Expose semantic memory as MCP resources. */
  exposeMemory: boolean;
  /** Expose autonomous task state as MCP resources. */
  exposeAgentState: boolean;
}
