// ============================================================
// OpenClaw Deploy — Reminder Scheduler Service
// ============================================================

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Reminder } from '../../types/index.js';
import { getNextCronTime } from '../tools/builtins/scheduler.js';

const CHECK_INTERVAL_MS = 30_000; // 30 seconds
const CLEANUP_AGE_MS = 24 * 60 * 60_000; // 24 hours
const PAST_DUE_GRACE_MS = 5 * 60_000; // 5 minutes — skip reminders older than this after restart

export class ReminderScheduler {
  private interval: ReturnType<typeof setInterval> | null = null;
  private callback: ((reminder: Reminder) => void) | null = null;

  constructor(private readonly remindersDir: string) {}

  onReminder(callback: (reminder: Reminder) => void): void {
    this.callback = callback;
  }

  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => {
      void this.checkReminders();
    }, CHECK_INTERVAL_MS);
    // Also run immediately on start
    void this.checkReminders();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private getFilePath(): string {
    return join(this.remindersDir, 'reminders.json');
  }

  private async loadReminders(): Promise<Reminder[]> {
    try {
      const content = await readFile(this.getFilePath(), 'utf-8');
      return JSON.parse(content) as Reminder[];
    } catch {
      return [];
    }
  }

  private async saveReminders(reminders: Reminder[]): Promise<void> {
    await mkdir(this.remindersDir, { recursive: true });
    await writeFile(this.getFilePath(), JSON.stringify(reminders, null, 2), 'utf-8');
  }

  async checkReminders(): Promise<void> {
    const reminders = await this.loadReminders();
    if (reminders.length === 0) return;

    const now = new Date();
    let changed = false;
    const newReminders: Reminder[] = [];

    for (const reminder of reminders) {
      if (reminder.fired) continue;
      const triggerAt = new Date(reminder.triggerAt);
      if (triggerAt <= now) {
        const overdueMs = now.getTime() - triggerAt.getTime();

        // Grace period: skip reminders that are too far past due (prevents flood after restart)
        if (overdueMs > PAST_DUE_GRACE_MS) {
          console.warn(
            `[reminders] Skipping overdue reminder "${reminder.message}" ` +
            `(was due ${Math.round(overdueMs / 60_000)}m ago)`,
          );
          if (reminder.recurring && reminder.cronExpression) {
            try {
              const nextTime = getNextCronTime(reminder.cronExpression);
              newReminders.push({
                ...reminder,
                id: reminder.id,
                triggerAt: nextTime.toISOString(),
                fired: false,
              });
            } catch {
              reminder.fired = true;
            }
          } else {
            reminder.fired = true; // one-time, too old — mark done without delivering
          }
          changed = true;
          continue;
        }

        // Within grace period — fire normally
        reminder.fired = true;
        changed = true;
        if (this.callback) {
          this.callback(reminder);
        }

        // Reschedule recurring reminders
        if (reminder.recurring && reminder.cronExpression) {
          try {
            const nextTime = getNextCronTime(reminder.cronExpression);
            newReminders.push({
              ...reminder,
              id: reminder.id, // keep same ID for recurring
              triggerAt: nextTime.toISOString(),
              fired: false,
            });
          } catch {
            // Cron expression can't find next time — let it stay fired
          }
        }
      }
    }

    // Replace fired recurring reminders with their rescheduled versions
    let result = reminders;
    if (newReminders.length > 0) {
      result = reminders.filter((r) => !newReminders.some((n) => n.id === r.id));
      result.push(...newReminders);
      changed = true;
    }

    // Clean up fired NON-recurring reminders older than 24h
    const cutoff = new Date(now.getTime() - CLEANUP_AGE_MS);
    const cleaned = result.filter((r) => {
      if (!r.fired) return true;
      if (r.recurring) return true; // keep recurring even if just fired
      const firedAt = new Date(r.triggerAt);
      return firedAt > cutoff;
    });

    if (cleaned.length !== result.length) {
      changed = true;
    }

    if (changed) {
      await this.saveReminders(cleaned);
    }
  }
}
