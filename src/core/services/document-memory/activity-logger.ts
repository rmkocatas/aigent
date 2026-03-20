// ============================================================
// OpenClaw Deploy — Activity Logger (JSONL per-user per-day)
// ============================================================

import { readFile, appendFile, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { ActivityLogEntry, ActivitySearchQuery } from './types.js';
import type { SqliteActivityStore } from '../memory-db/activity-store.js';

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

export class ActivityLogger {
  private buffer: ActivityLogEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private sqliteStore: SqliteActivityStore | null = null;

  constructor(
    private readonly logsDir: string,
    private readonly retentionDays: number,
    sqliteStore?: SqliteActivityStore,
  ) {
    this.sqliteStore = sqliteStore ?? null;
  }

  // ── Lifecycle ──────────────────────────────────────────────

  startCleanup(): void {
    // Run cleanup once on start, then daily
    this.cleanOldLogs().catch(() => {});
    this.cleanupTimer = setInterval(
      () => this.cleanOldLogs().catch(console.error),
      24 * 60 * 60 * 1000,
    );
    this.cleanupTimer.unref();
  }

  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    // Final flush
    this.flushSync();
  }

  // ── Logging ────────────────────────────────────────────────

  async log(entry: ActivityLogEntry): Promise<void> {
    // Delegate to SQLite if available
    if (this.sqliteStore) {
      this.sqliteStore.log(entry);
      return;
    }

    this.buffer.push(entry);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), 5000);
      this.flushTimer.unref();
    }
  }

  private async flush(): Promise<void> {
    this.flushTimer = null;
    if (this.buffer.length === 0) return;

    const toFlush = this.buffer;
    this.buffer = [];

    // Group by userId + date for efficient file writes
    const grouped = new Map<string, string[]>();
    for (const entry of toFlush) {
      const date = entry.timestamp.split('T')[0];
      const key = `${entry.userId}|${date}`;
      const arr = grouped.get(key) ?? [];
      arr.push(JSON.stringify(entry));
      grouped.set(key, arr);
    }

    for (const [key, lines] of grouped) {
      const [userId, date] = key.split('|');
      const filePath = this.logPath(userId, date);
      try {
        await mkdir(dirname(filePath), { recursive: true });
        await appendFile(filePath, lines.join('\n') + '\n');
      } catch (err) {
        console.error('[activity] Write error:', (err as Error).message);
      }
    }
  }

  private flushSync(): void {
    // Best-effort sync flush on shutdown
    this.flush().catch(() => {});
  }

  // ── Search ─────────────────────────────────────────────────

  async search(userId: string, query: ActivitySearchQuery): Promise<ActivityLogEntry[]> {
    // Delegate to SQLite if available
    if (this.sqliteStore) {
      return this.sqliteStore.search(userId, query);
    }

    // Flush buffer first so recent entries are searchable
    await this.flush();

    const dates = this.resolveDateRange(query.dateRange ?? 'today');
    const results: ActivityLogEntry[] = [];
    const limit = Math.min(query.limit ?? 20, 50);

    for (const date of dates) {
      try {
        const content = await readFile(this.logPath(userId, date), 'utf-8');
        for (const line of content.split('\n').filter(Boolean)) {
          try {
            const entry = JSON.parse(line) as ActivityLogEntry;
            if (this.matchesQuery(entry, query)) {
              results.push(entry);
            }
          } catch {
            // Skip malformed lines
          }
        }
      } catch {
        // File doesn't exist for this date
      }
    }

    // Return most recent first, limited
    return results.reverse().slice(0, limit);
  }

  // ── Internals ──────────────────────────────────────────────

  private logPath(userId: string, date: string): string {
    return join(this.logsDir, sanitizeId(userId), `${date}.jsonl`);
  }

  private matchesQuery(entry: ActivityLogEntry, query: ActivitySearchQuery): boolean {
    if (query.toolName && !entry.toolsUsed.includes(query.toolName)) {
      return false;
    }
    if (query.keyword) {
      const kw = query.keyword.toLowerCase();
      if (
        !entry.userMessage.toLowerCase().includes(kw) &&
        !entry.responseSnippet.toLowerCase().includes(kw)
      ) {
        return false;
      }
    }
    return true;
  }

  private resolveDateRange(range: string): string[] {
    const today = new Date();
    const fmt = (d: Date) => d.toISOString().split('T')[0];

    switch (range) {
      case 'today':
        return [fmt(today)];
      case 'yesterday': {
        const y = new Date(today);
        y.setDate(y.getDate() - 1);
        return [fmt(y)];
      }
      case 'week': {
        const dates: string[] = [];
        for (let i = 0; i < 7; i++) {
          const d = new Date(today);
          d.setDate(d.getDate() - i);
          dates.push(fmt(d));
        }
        return dates;
      }
      case 'month': {
        const dates: string[] = [];
        for (let i = 0; i < 30; i++) {
          const d = new Date(today);
          d.setDate(d.getDate() - i);
          dates.push(fmt(d));
        }
        return dates;
      }
      default:
        // Assume YYYY-MM-DD
        return [range];
    }
  }

  private async cleanOldLogs(): Promise<void> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.retentionDays);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    try {
      const userDirs = await readdir(this.logsDir);
      for (const userDir of userDirs) {
        const userPath = join(this.logsDir, userDir);
        try {
          const st = await stat(userPath);
          if (!st.isDirectory()) continue;
        } catch {
          continue;
        }

        const files = await readdir(userPath);
        for (const file of files) {
          if (!file.endsWith('.jsonl')) continue;
          const dateStr = file.replace('.jsonl', '');
          if (dateStr < cutoffStr) {
            await unlink(join(userPath, file)).catch(() => {});
          }
        }
      }
    } catch {
      // Logs dir may not exist yet
    }
  }
}
