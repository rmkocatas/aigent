// ============================================================
// OpenClaw Deploy — SQLite Response Cache Store
// ============================================================
// Replaces JSON-based response cache with SQLite persistence.
// ============================================================

import type { MemoryDatabase } from './database.js';
import { encodeEmbedding, decodeEmbedding, cosineSimilarity } from './embedding-codec.js';

const MAX_ENTRIES = 500;
const SIMILARITY_THRESHOLD = 0.93;

interface CacheRow {
  id: number;
  query_embedding: Buffer | null;
  query: string;
  response: string;
  provider: string;
  model: string;
  classification: string;
  created_at: number;
  last_accessed_at: number;
  ttl_ms: number;
  used_tools: number;
}

export class SqliteCacheStore {
  constructor(private readonly memDb: MemoryDatabase) {}

  private get db() { return this.memDb.db; }

  /** Look up a cached response by semantic similarity */
  lookup(
    queryEmbedding: number[],
    classification: string,
  ): { response: string; provider: string; model: string } | null {
    const now = Date.now();

    // Get non-expired entries matching classification
    const rows = this.db.prepare(`
      SELECT * FROM response_cache
      WHERE classification = ? AND (created_at + ttl_ms) > ?
      ORDER BY last_accessed_at DESC
    `).all(classification, now) as CacheRow[];

    let bestMatch: CacheRow | null = null;
    let bestSimilarity = 0;

    for (const row of rows) {
      if (!row.query_embedding) continue;
      const embedding = decodeEmbedding(row.query_embedding);
      const similarity = cosineSimilarity(queryEmbedding, embedding);
      if (similarity > SIMILARITY_THRESHOLD && similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = row;
      }
    }

    if (!bestMatch) return null;

    // Update LRU timestamp
    this.db.prepare(
      'UPDATE response_cache SET last_accessed_at = ? WHERE id = ?',
    ).run(now, bestMatch.id);

    console.log(
      `[cache-sqlite] Hit (similarity=${bestSimilarity.toFixed(3)}): "${bestMatch.query.slice(0, 60)}..."`,
    );

    return {
      response: bestMatch.response,
      provider: bestMatch.provider,
      model: bestMatch.model,
    };
  }

  /** Store a response in the cache */
  store(
    queryEmbedding: number[],
    query: string,
    response: string,
    provider: string,
    model: string,
    classification: string,
    usedTools: boolean,
    ttlMs: number,
  ): void {
    const now = Date.now();
    const embeddingBlob = encodeEmbedding(queryEmbedding);

    this.db.prepare(`
      INSERT INTO response_cache
        (query_embedding, query, response, provider, model, classification,
         created_at, last_accessed_at, ttl_ms, used_tools)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      embeddingBlob,
      query.slice(0, 200),
      response,
      provider,
      model,
      classification,
      now,
      now,
      ttlMs,
      usedTools ? 1 : 0,
    );

    this.evict();
  }

  /** Remove expired entries and enforce max capacity */
  private evict(): void {
    const now = Date.now();

    // Remove expired
    this.db.prepare(
      'DELETE FROM response_cache WHERE (created_at + ttl_ms) <= ?',
    ).run(now);

    // LRU eviction if over capacity
    const count = this.db.prepare('SELECT COUNT(*) AS cnt FROM response_cache').get() as { cnt: number };
    if (count.cnt > MAX_ENTRIES) {
      this.db.prepare(`
        DELETE FROM response_cache WHERE id NOT IN (
          SELECT id FROM response_cache ORDER BY last_accessed_at DESC LIMIT ?
        )
      `).run(MAX_ENTRIES);
    }
  }

  /** Get cache stats */
  getStats(): { entries: number; maxEntries: number } {
    const count = this.db.prepare('SELECT COUNT(*) AS cnt FROM response_cache').get() as { cnt: number };
    return { entries: count.cnt, maxEntries: MAX_ENTRIES };
  }

  /** Flush is a no-op for SQLite (writes are immediate) */
  flush(): void {
    // No-op
  }
}
