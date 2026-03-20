// ============================================================
// OpenClaw Deploy — SQLite Activity Store
// ============================================================
// Replaces JSONL-based activity logging with SQLite queries.
// ============================================================

import type { MemoryDatabase } from './database.js';
import type { ActivityLogEntry, ActivitySearchQuery } from '../document-memory/types.js';

export class SqliteActivityStore {
  constructor(private readonly memDb: MemoryDatabase) {}

  private get db() { return this.memDb.db; }

  /** Insert an activity log entry */
  log(entry: ActivityLogEntry): void {
    this.db.prepare(`
      INSERT INTO activity_log
        (timestamp, user_id, conversation_id, channel, user_message,
         classification, provider, model, tools_used, tool_errors, response_snippet)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.timestamp,
      entry.userId,
      entry.conversationId,
      entry.channel,
      entry.userMessage,
      entry.classification,
      entry.provider,
      entry.model,
      JSON.stringify(entry.toolsUsed),
      JSON.stringify(entry.toolErrors),
      entry.responseSnippet,
    );
  }

  /** Search activity logs with filters */
  search(userId: string, query: ActivitySearchQuery): ActivityLogEntry[] {
    const limit = Math.min(query.limit ?? 20, 50);
    const { startDate, endDate } = this.resolveDateRange(query.dateRange ?? 'today');

    let sql = `
      SELECT * FROM activity_log
      WHERE user_id = ? AND timestamp >= ? AND timestamp < ?
    `;
    const args: any[] = [userId, startDate, endDate];

    if (query.toolName) {
      // JSON array contains check
      sql += ` AND tools_used LIKE ?`;
      args.push(`%"${query.toolName}"%`);
    }

    if (query.keyword) {
      sql += ` AND (user_message LIKE ? OR response_snippet LIKE ?)`;
      const kw = `%${query.keyword}%`;
      args.push(kw, kw);
    }

    sql += ` ORDER BY timestamp DESC LIMIT ?`;
    args.push(limit);

    const rows = this.db.prepare(sql).all(...args) as any[];
    return rows.map((r) => this.rowToEntry(r));
  }

  /** Get total activity count for a user */
  getCount(userId: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) AS cnt FROM activity_log WHERE user_id = ?',
    ).get(userId) as { cnt: number };
    return row.cnt;
  }

  /** Clean old entries beyond retention period */
  cleanOld(retentionDays: number): number {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const info = this.db.prepare(
      'DELETE FROM activity_log WHERE timestamp < ?',
    ).run(cutoff.toISOString());
    return info.changes;
  }

  private resolveDateRange(range: string): { startDate: string; endDate: string } {
    const today = new Date();
    const fmt = (d: Date) => d.toISOString().split('T')[0];

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    switch (range) {
      case 'today':
        return { startDate: fmt(today), endDate: fmt(tomorrow) };
      case 'yesterday': {
        const y = new Date(today);
        y.setDate(y.getDate() - 1);
        return { startDate: fmt(y), endDate: fmt(today) };
      }
      case 'week': {
        const w = new Date(today);
        w.setDate(w.getDate() - 7);
        return { startDate: fmt(w), endDate: fmt(tomorrow) };
      }
      case 'month': {
        const m = new Date(today);
        m.setDate(m.getDate() - 30);
        return { startDate: fmt(m), endDate: fmt(tomorrow) };
      }
      default:
        // Assume YYYY-MM-DD — return that single day
        const next = new Date(range);
        next.setDate(next.getDate() + 1);
        return { startDate: range, endDate: fmt(next) };
    }
  }

  private rowToEntry(row: any): ActivityLogEntry {
    return {
      timestamp: row.timestamp,
      userId: row.user_id,
      conversationId: row.conversation_id ?? '',
      channel: row.channel ?? '',
      userMessage: row.user_message ?? '',
      classification: row.classification ?? '',
      provider: row.provider ?? '',
      model: row.model ?? '',
      toolsUsed: JSON.parse(row.tools_used || '[]'),
      toolErrors: JSON.parse(row.tool_errors || '[]'),
      responseSnippet: row.response_snippet ?? '',
    };
  }
}
