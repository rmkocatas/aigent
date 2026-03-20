// ============================================================
// OpenClaw Deploy — Event-Driven Trigger System
// ============================================================
//
// Supports scheduled triggers (cron-based) that automatically
// execute actions at specified times. Actions are processed
// through the chat pipeline as if the user sent a message.
//
// Config file: triggers.json in workspace directory
// ============================================================

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { getNextCronTime } from '../tools/builtins/scheduler.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EventTrigger {
  id: string;
  name: string;
  enabled: boolean;
  /** Cron expression (5-field) */
  schedule: string;
  /** The message to send through the pipeline */
  action: string;
  /** Channel to deliver the result on */
  channel: 'telegram' | 'webchat' | 'discord';
  /** Chat/user ID to send the result to */
  targetId: string | number;
  /** Next scheduled fire time (ISO) */
  nextFireAt: string;
  /** Last time it fired (ISO or null) */
  lastFiredAt: string | null;
  /** How many times it has fired */
  fireCount: number;
  /** When true, fires through the autonomous task executor instead of the regular pipeline */
  autonomous?: boolean;
}

export type TriggerCallback = (trigger: EventTrigger) => void;

// ---------------------------------------------------------------------------
// Trigger Manager
// ---------------------------------------------------------------------------

const CHECK_INTERVAL_MS = 30_000; // 30 seconds
const PAST_DUE_GRACE_MS = 5 * 60_000; // 5 minutes — skip triggers older than this after restart

export class EventTriggerManager {
  private interval: ReturnType<typeof setInterval> | null = null;
  private callback: TriggerCallback | null = null;
  private readonly filePath: string;

  constructor(baseDir: string) {
    this.filePath = join(baseDir, 'triggers', 'triggers.json');
  }

  onTrigger(callback: TriggerCallback): void {
    this.callback = callback;
  }

  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => {
      void this.check();
    }, CHECK_INTERVAL_MS);
    void this.check();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async loadTriggers(): Promise<EventTrigger[]> {
    try {
      const content = await readFile(this.filePath, 'utf-8');
      return JSON.parse(content) as EventTrigger[];
    } catch {
      return [];
    }
  }

  async saveTriggers(triggers: EventTrigger[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(triggers, null, 2), 'utf-8');
  }

  async addTrigger(trigger: Omit<EventTrigger, 'nextFireAt' | 'lastFiredAt' | 'fireCount'>): Promise<EventTrigger> {
    const triggers = await this.loadTriggers();

    const nextFireAt = getNextCronTime(trigger.schedule);
    const full: EventTrigger = {
      ...trigger,
      nextFireAt: nextFireAt.toISOString(),
      lastFiredAt: null,
      fireCount: 0,
    };

    triggers.push(full);
    await this.saveTriggers(triggers);
    return full;
  }

  async removeTrigger(id: string): Promise<boolean> {
    const triggers = await this.loadTriggers();
    const idx = triggers.findIndex((t) => t.id === id);
    if (idx === -1) return false;
    triggers.splice(idx, 1);
    await this.saveTriggers(triggers);
    return true;
  }

  async toggleTrigger(id: string, enabled: boolean): Promise<boolean> {
    const triggers = await this.loadTriggers();
    const trigger = triggers.find((t) => t.id === id);
    if (!trigger) return false;
    trigger.enabled = enabled;
    if (enabled) {
      trigger.nextFireAt = getNextCronTime(trigger.schedule).toISOString();
    }
    await this.saveTriggers(triggers);
    return true;
  }

  private async check(): Promise<void> {
    const triggers = await this.loadTriggers();
    if (triggers.length === 0) return;

    const now = new Date();
    let changed = false;

    for (const trigger of triggers) {
      if (!trigger.enabled) continue;

      const fireAt = new Date(trigger.nextFireAt);
      if (fireAt <= now) {
        const overdueMs = now.getTime() - fireAt.getTime();

        // Grace period: skip triggers that are too far past due (prevents flood after restart)
        if (overdueMs > PAST_DUE_GRACE_MS) {
          console.warn(
            `[triggers] Skipping overdue trigger "${trigger.name}" ` +
            `(was due ${Math.round(overdueMs / 60_000)}m ago)`,
          );
          try {
            trigger.nextFireAt = getNextCronTime(trigger.schedule).toISOString();
          } catch {
            trigger.enabled = false;
          }
          changed = true;
          continue;
        }

        // Within grace period — fire normally
        trigger.lastFiredAt = now.toISOString();
        trigger.fireCount++;
        changed = true;

        if (this.callback) {
          this.callback(trigger);
        }

        // Schedule next occurrence
        try {
          trigger.nextFireAt = getNextCronTime(trigger.schedule).toISOString();
        } catch {
          // Can't find next time — disable
          trigger.enabled = false;
        }
      }
    }

    if (changed) {
      await this.saveTriggers(triggers);
    }
  }
}
