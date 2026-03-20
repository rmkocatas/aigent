// ============================================================
// OpenClaw Deploy — Autonomous Module Public API
// ============================================================

export type {
  AutonomousTask,
  Subtask,
  TaskStatus,
  SafetyTier,
  ResourceBudget,
  AuditEntry,
  AuditEvent,
  AutonomousConfig,
} from './types.js';

export { AutonomousTaskExecutor, type TaskExecutorDeps } from './task-executor.js';
export { AutonomousTaskStore } from './task-store.js';
export { AuditLogger } from './audit-logger.js';
export { BudgetManager } from './budget-manager.js';
export { classifyToolSafety, shouldRequireApproval } from './safety-classifier.js';
