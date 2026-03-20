// ============================================================
// OpenClaw Deploy — Agent Profile Types
// ============================================================

export interface AgentProfile {
  /** Unique identifier (e.g., 'researcher', 'coder') */
  id: string;
  /** Display name */
  name: string;
  /** Short description of the agent's specialty */
  description: string;
  /** Appended to the base system prompt for this agent */
  systemPromptSuffix: string;
  /** Whitelist of tool names this agent can use */
  allowedTools: string[];
  /** Optional model routing overrides keyed by classification */
  routingOverride?: Record<string, string>;
}
