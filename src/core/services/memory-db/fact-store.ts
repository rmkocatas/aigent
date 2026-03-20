// ============================================================
// OpenClaw Deploy — SQLite Fact Store
// ============================================================
// Drop-in replacement for MemoryStore (duck-typed, same method
// signatures). Stores facts in SQLite instead of JSON files.
// ============================================================

import type { MemoryEntry, MemoryLayer, MemoryStoreData } from '../memory/types.js';
import { ALL_LAYERS } from '../memory/types.js';
import type { MemoryDatabase } from './database.js';
import { encodeEmbedding, decodeEmbedding } from './embedding-codec.js';

/** Per-layer capacity limits (same as file-based MemoryStore) */
const LAYER_CAPACITY: Record<MemoryLayer, number> = {
  identity: 50,
  projects: 100,
  knowledge: 300,
  episodes: 20,
};

export class SqliteFactStore {
  constructor(private readonly memDb: MemoryDatabase) {}

  private get db() { return this.memDb.db; }

  // ── Load (no-op, data is always in SQLite) ──────────────

  async load(_userId: string): Promise<Record<MemoryLayer, MemoryStoreData>> {
    // Compatibility stub — SQLite doesn't need explicit loading
    const result = {} as Record<MemoryLayer, MemoryStoreData>;
    for (const layer of ALL_LAYERS) {
      result[layer] = {
        version: 2,
        layer,
        entries: [],
        lastConsolidation: null,
        stats: { totalFacts: 0, totalExtractions: 0, totalRecalls: 0, totalMerges: 0, totalPrunes: 0 },
      };
    }
    return result;
  }

  // ── Save (no-op, writes are immediate) ──────────────────

  async save(_userId: string): Promise<void> {
    // No-op — SQLite writes are immediate
  }

  async flush(): Promise<void> {
    // No-op
  }

  // ── Entry CRUD ──────────────────────────────────────────

  async addEntry(userId: string, entry: MemoryEntry): Promise<void> {
    const layer = entry.layer || 'knowledge';

    // Enforce per-layer capacity
    const count = this.db.prepare(
      'SELECT COUNT(*) AS cnt FROM facts WHERE user_id = ? AND layer = ? AND is_active = 1',
    ).get(userId, layer) as { cnt: number };

    if (count.cnt >= LAYER_CAPACITY[layer]) return;

    const embeddingBlob = entry.embedding ? encodeEmbedding(entry.embedding) : null;

    this.db.prepare(`
      INSERT OR IGNORE INTO facts
        (id, user_id, fact, layer, embedding, persons, topics, entities, dates,
         conversation_id, turn_index, created_at, last_accessed_at, access_count,
         strength, source_type, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      entry.id,
      userId,
      entry.fact,
      layer,
      embeddingBlob,
      JSON.stringify(entry.metadata.persons),
      JSON.stringify(entry.metadata.topics),
      JSON.stringify(entry.metadata.entities),
      JSON.stringify(entry.metadata.dates),
      entry.metadata.conversationId,
      entry.metadata.turnIndex,
      entry.createdAt,
      entry.lastAccessedAt,
      entry.accessCount,
      entry.strength,
      entry.source.type,
    );
  }

  async getEntries(userId: string, layer?: MemoryLayer): Promise<MemoryEntry[]> {
    const sql = layer
      ? 'SELECT * FROM facts WHERE user_id = ? AND layer = ? AND is_active = 1'
      : 'SELECT * FROM facts WHERE user_id = ? AND is_active = 1';
    const rows = layer
      ? this.db.prepare(sql).all(userId, layer) as any[]
      : this.db.prepare(sql).all(userId) as any[];

    return rows.map((r) => this.rowToEntry(r));
  }

  async getLayerEntries(userId: string): Promise<Record<MemoryLayer, MemoryEntry[]>> {
    const all = await this.getEntries(userId);
    const result: Record<MemoryLayer, MemoryEntry[]> = {
      identity: [], projects: [], knowledge: [], episodes: [],
    };
    for (const entry of all) {
      result[entry.layer].push(entry);
    }
    return result;
  }

  async removeEntry(userId: string, entryId: string): Promise<boolean> {
    const info = this.db.prepare(
      'UPDATE facts SET is_active = 0 WHERE id = ? AND user_id = ?',
    ).run(entryId, userId);
    return info.changes > 0;
  }

  async replaceEntries(userId: string, entries: MemoryEntry[], layer: MemoryLayer): Promise<void> {
    const tx = this.db.transaction(() => {
      // Soft-delete all existing entries for this user+layer
      this.db.prepare(
        'UPDATE facts SET is_active = 0 WHERE user_id = ? AND layer = ?',
      ).run(userId, layer);

      // Re-insert the consolidated entries
      for (const entry of entries) {
        entry.layer = layer;
        // Use addEntry logic but we need to bypass capacity check
        const embeddingBlob = entry.embedding ? encodeEmbedding(entry.embedding) : null;
        this.db.prepare(`
          INSERT OR REPLACE INTO facts
            (id, user_id, fact, layer, embedding, persons, topics, entities, dates,
             conversation_id, turn_index, created_at, last_accessed_at, access_count,
             strength, source_type, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `).run(
          entry.id, userId, entry.fact, layer, embeddingBlob,
          JSON.stringify(entry.metadata.persons),
          JSON.stringify(entry.metadata.topics),
          JSON.stringify(entry.metadata.entities),
          JSON.stringify(entry.metadata.dates),
          entry.metadata.conversationId, entry.metadata.turnIndex,
          entry.createdAt, entry.lastAccessedAt, entry.accessCount,
          entry.strength, entry.source.type,
        );
      }
    });
    tx();
  }

  async getLayerStats(userId: string, layer: MemoryLayer): Promise<{
    count: number;
    capacity: number;
    lastConsolidation: string | null;
  }> {
    const count = this.db.prepare(
      'SELECT COUNT(*) AS cnt FROM facts WHERE user_id = ? AND layer = ? AND is_active = 1',
    ).get(userId, layer) as { cnt: number };

    const stats = this.db.prepare(
      'SELECT last_consolidation FROM memory_stats WHERE user_id = ? AND layer = ?',
    ).get(userId, layer) as { last_consolidation: string | null } | undefined;

    return {
      count: count.cnt,
      capacity: LAYER_CAPACITY[layer],
      lastConsolidation: stats?.last_consolidation ?? null,
    };
  }

  async setLastConsolidation(userId: string, layer: MemoryLayer, timestamp: string): Promise<void> {
    this.db.prepare(`
      INSERT INTO memory_stats (user_id, layer, last_consolidation)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, layer) DO UPDATE SET last_consolidation = excluded.last_consolidation
    `).run(userId, layer, timestamp);
  }

  async updateStats(
    userId: string,
    layer: MemoryLayer,
    update: Partial<{ totalMerges: number; totalPrunes: number; totalRecalls: number; totalExtractions: number }>,
  ): Promise<void> {
    // Ensure row exists
    this.db.prepare(`
      INSERT OR IGNORE INTO memory_stats (user_id, layer) VALUES (?, ?)
    `).run(userId, layer);

    if (update.totalMerges) {
      this.db.prepare(
        'UPDATE memory_stats SET total_merges = total_merges + ? WHERE user_id = ? AND layer = ?',
      ).run(update.totalMerges, userId, layer);
    }
    if (update.totalPrunes) {
      this.db.prepare(
        'UPDATE memory_stats SET total_prunes = total_prunes + ? WHERE user_id = ? AND layer = ?',
      ).run(update.totalPrunes, userId, layer);
    }
    if (update.totalRecalls) {
      this.db.prepare(
        'UPDATE memory_stats SET total_recalls = total_recalls + ? WHERE user_id = ? AND layer = ?',
      ).run(update.totalRecalls, userId, layer);
    }
    if (update.totalExtractions) {
      this.db.prepare(
        'UPDATE memory_stats SET total_extractions = total_extractions + ? WHERE user_id = ? AND layer = ?',
      ).run(update.totalExtractions, userId, layer);
    }
  }

  getLayerCapacity(layer: MemoryLayer): number {
    return LAYER_CAPACITY[layer];
  }

  evict(_userId: string): void {
    // No-op — SQLite handles its own caching
  }

  getLoadedUserIds(): string[] {
    const rows = this.db.prepare(
      'SELECT DISTINCT user_id FROM facts WHERE is_active = 1',
    ).all() as { user_id: string }[];
    return rows.map((r) => r.user_id);
  }

  /** Get a single fact by ID */
  getFactById(factId: string): MemoryEntry | null {
    const row = this.db.prepare(
      'SELECT * FROM facts WHERE id = ? AND is_active = 1',
    ).get(factId) as any | undefined;
    return row ? this.rowToEntry(row) : null;
  }

  // ── Row mapping ─────────────────────────────────────────

  private rowToEntry(row: any): MemoryEntry {
    return {
      id: row.id,
      userId: row.user_id,
      fact: row.fact,
      layer: row.layer as MemoryLayer,
      embedding: row.embedding ? decodeEmbedding(row.embedding) : null,
      metadata: {
        persons: JSON.parse(row.persons || '[]'),
        topics: JSON.parse(row.topics || '[]'),
        entities: JSON.parse(row.entities || '[]'),
        dates: JSON.parse(row.dates || '[]'),
        conversationId: row.conversation_id ?? '',
        turnIndex: row.turn_index ?? 0,
      },
      createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at,
      accessCount: row.access_count,
      strength: row.strength,
      source: {
        type: row.source_type as MemoryEntry['source']['type'],
      },
    };
  }
}
