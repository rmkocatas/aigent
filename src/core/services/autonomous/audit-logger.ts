// ============================================================
// OpenClaw Deploy — Autonomous Audit Logger
// ============================================================

import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AuditEntry, AuditEvent, SafetyTier } from './types.js';
import { redactSensitive } from '../log-redactor.js';

const ERROR_EVENTS: AuditEvent[] = [
  'task_failed',
  'budget_exceeded',
  'kill_switch_activated',
  'circuit_breaker_tripped',
  'error',
];

export class AuditLogger {
  private dirReady = false;

  constructor(private readonly auditDir: string) {}

  private async ensureDir(): Promise<void> {
    if (this.dirReady) return;
    await mkdir(this.auditDir, { recursive: true });
    this.dirReady = true;
  }

  createEntry(
    event: AuditEvent,
    details: string,
    extra?: {
      subtaskId?: string;
      toolName?: string;
      safetyTier?: SafetyTier;
      approved?: boolean;
      tokensUsed?: number;
    },
  ): AuditEntry {
    return {
      timestamp: new Date().toISOString(),
      event,
      details,
      ...extra,
    };
  }

  async persistEntry(taskId: string, entry: AuditEntry): Promise<void> {
    try {
      await this.ensureDir();
      const logFile = join(this.auditDir, `audit-${taskId}.jsonl`);
      const line = JSON.stringify(entry) + '\n';
      await appendFile(logFile, line, 'utf-8');
    } catch {
      // Best-effort: don't crash the task if audit write fails
    }
  }

  logToConsole(taskId: string, entry: AuditEntry): void {
    const prefix = `[autonomous][${taskId.slice(0, 8)}]`;
    const safeDetails = redactSensitive(entry.details);
    if (ERROR_EVENTS.includes(entry.event)) {
      console.error(`${prefix} ${entry.event}: ${safeDetails}`);
    } else {
      console.log(`${prefix} ${entry.event}: ${safeDetails}`);
    }
  }
}
