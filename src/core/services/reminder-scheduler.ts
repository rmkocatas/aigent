// ============================================================
// OpenClaw Deploy — Reminder Scheduler Service
// ============================================================

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Reminder } from '../../types/index.js';

const CHECK_INTERVAL_MS = 30_000; // 30 seconds
const CLEANUP_AGE_MS = 24 * 60 * 60_000; // 24 hours

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

    for (const reminder of reminders) {
      if (reminder.fired) continue;
      const triggerAt = new Date(reminder.triggerAt);
      if (triggerAt <= now) {
        reminder.fired = true;
        changed = true;
        if (this.callback) {
          this.callback(reminder);
        }
      }
    }

    // Clean up fired reminders older than 24h
    const cutoff = new Date(now.getTime() - CLEANUP_AGE_MS);
    const cleaned = reminders.filter((r) => {
      if (!r.fired) return true;
      const firedAt = new Date(r.triggerAt);
      return firedAt > cutoff;
    });

    if (cleaned.length !== reminders.length) {
      changed = true;
    }

    if (changed) {
      await this.saveReminders(cleaned);
    }
  }
}
