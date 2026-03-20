// ============================================================
// OpenClaw Deploy — Document Memory Types
// ============================================================

export interface DocumentMemoryConfig {
  enabled: boolean;
  /** Auto-inject soul.md + memory.md + tasks.md into system prompt */
  autoInject: boolean;
  /** Token budget for soul.md injection */
  soulTokenBudget: number;
  /** Token budget for memory.md injection */
  memoryTokenBudget: number;
  /** Token budget for tasks.md injection */
  tasksTokenBudget: number;
  /** Max memory.md file size in bytes before warning */
  memoryMaxBytes: number;
  /** Max tasks.md file size in bytes before warning */
  tasksMaxBytes: number;
  /** Enable activity logging */
  activityLogging: boolean;
  /** Days of activity logs to retain */
  activityRetentionDays: number;
}

export interface ActivityLogEntry {
  timestamp: string;
  userId: string;
  conversationId: string;
  channel: string;
  userMessage: string;
  classification: string;
  provider: string;
  model: string;
  toolsUsed: string[];
  toolErrors: string[];
  responseSnippet: string;
}

export interface ActivitySearchQuery {
  dateRange?: string;
  toolName?: string;
  keyword?: string;
  limit?: number;
}
