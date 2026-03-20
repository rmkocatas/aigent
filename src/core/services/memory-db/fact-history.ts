// ============================================================
// OpenClaw Deploy — Fact Version History Service
// ============================================================
// Logs every mutation to facts (create, update, merge, prune,
// decay, forget) for full audit trail and timeline tools.
// ============================================================

import type { MemoryDatabase } from './database.js';
import type { FactChange, FactChangeType } from './types.js';

export class FactHistoryService {
  constructor(private readonly memDb: MemoryDatabase) {}

  private get db() { return this.memDb.db; }

  /** Log a fact mutation */
  logChange(params: {
    factId: string;
    userId: string;
    changeType: FactChangeType;
    oldFact?: string | null;
    newFact?: string | null;
    oldStrength?: number | null;
    newStrength?: number | null;
    mergedFromIds?: string[] | null;
    context?: string | null;
  }): void {
    this.db.prepare(`
      INSERT INTO fact_history
        (fact_id, user_id, change_type, old_fact, new_fact,
         old_strength, new_strength, merged_from_ids, changed_at, context)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.factId,
      params.userId,
      params.changeType,
      params.oldFact ?? null,
      params.newFact ?? null,
      params.oldStrength ?? null,
      params.newStrength ?? null,
      params.mergedFromIds ? JSON.stringify(params.mergedFromIds) : null,
      new Date().toISOString(),
      params.context ?? null,
    );
  }

  /** Get full history for a specific fact */
  getFactHistory(factId: string): FactChange[] {
    const rows = this.db.prepare(
      'SELECT * FROM fact_history WHERE fact_id = ? ORDER BY changed_at ASC',
    ).all(factId) as any[];
    return rows.map((r) => this.rowToChange(r));
  }

  /** Get recent changes for a user, newest first */
  getUserTimeline(userId: string, limit = 20, offset = 0): FactChange[] {
    const rows = this.db.prepare(
      'SELECT * FROM fact_history WHERE user_id = ? ORDER BY changed_at DESC LIMIT ? OFFSET ?',
    ).all(userId, limit, offset) as any[];
    return rows.map((r) => this.rowToChange(r));
  }

  /** Get changes of a specific type for a user */
  getChangesByType(userId: string, changeType: FactChangeType, limit = 20): FactChange[] {
    const rows = this.db.prepare(
      'SELECT * FROM fact_history WHERE user_id = ? AND change_type = ? ORDER BY changed_at DESC LIMIT ?',
    ).all(userId, changeType, limit) as any[];
    return rows.map((r) => this.rowToChange(r));
  }

  /** Count total changes for a user */
  getChangeCount(userId: string): Record<FactChangeType, number> {
    const rows = this.db.prepare(
      'SELECT change_type, COUNT(*) AS cnt FROM fact_history WHERE user_id = ? GROUP BY change_type',
    ).all(userId) as { change_type: string; cnt: number }[];

    const result: Record<string, number> = {
      create: 0, update: 0, merge: 0, prune: 0, decay: 0, forget: 0,
    };
    for (const row of rows) {
      result[row.change_type] = row.cnt;
    }
    return result as Record<FactChangeType, number>;
  }

  private rowToChange(row: any): FactChange {
    return {
      id: row.id,
      factId: row.fact_id,
      userId: row.user_id,
      changeType: row.change_type as FactChangeType,
      oldFact: row.old_fact,
      newFact: row.new_fact,
      oldStrength: row.old_strength,
      newStrength: row.new_strength,
      mergedFromIds: row.merged_from_ids ? JSON.parse(row.merged_from_ids) : null,
      changedAt: row.changed_at,
      context: row.context,
    };
  }
}
