// ============================================================
// OpenClaw Deploy — Semantic Response Cache
// ============================================================
//
// Uses local Ollama embeddings (nomic-embed-text) to cache LLM
// responses for semantically similar queries.
//
// - Cosine similarity > 0.93 = cache hit
// - TTL: 1 hour for no-tool responses, 5 min for tool-using
// - 500 entries max, LRU eviction
// - Skip: autonomous subtasks, empty responses
// ============================================================

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { OllamaConfig } from '../../types/index.js';
import { getEmbedding } from '../services/memory/embedding-client.js';
import type { SqliteCacheStore } from '../services/memory-db/cache-store.js';

const MAX_ENTRIES = 500;
const DEFAULT_TTL_MS = 60 * 60 * 1000;       // 1 hour for static responses
const TOOL_TTL_MS = 5 * 60 * 1000;            // 5 min for tool-using responses
const SIMILARITY_THRESHOLD = 0.93;
const SAVE_DEBOUNCE_MS = 10_000;

interface CachedResponse {
  queryEmbedding: number[];
  query: string;
  response: string;
  provider: string;
  model: string;
  classification: string;
  createdAt: number;
  lastAccessedAt: number;
  ttlMs: number;
  usedTools: boolean;
}

interface CacheData {
  version: 1;
  entries: CachedResponse[];
}

export class ResponseCache {
  private entries: CachedResponse[] = [];
  private loaded = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private filePath: string;
  private sqliteStore: SqliteCacheStore | null = null;

  constructor(
    private ollamaConfig: OllamaConfig | null,
    private embeddingModel: string,
    baseDir: string,
    sqliteStore?: SqliteCacheStore,
  ) {
    this.filePath = join(baseDir, 'cache', 'responses.json');
    this.sqliteStore = sqliteStore ?? null;
  }

  // ---- Lookup ----

  async lookup(
    query: string,
    classification: string,
  ): Promise<{ response: string; provider: string; model: string } | null> {
    if (!this.ollamaConfig) return null;

    const queryEmbedding = await getEmbedding(
      this.ollamaConfig,
      this.embeddingModel,
      query,
    );
    if (!queryEmbedding) return null;

    // Delegate to SQLite if available
    if (this.sqliteStore) {
      return this.sqliteStore.lookup(queryEmbedding, classification);
    }

    await this.ensureLoaded();

    const now = Date.now();
    let bestMatch: CachedResponse | null = null;
    let bestSimilarity = 0;

    for (const entry of this.entries) {
      // Skip expired
      if (now - entry.createdAt > entry.ttlMs) continue;

      // Must match classification tier (don't serve a Haiku result for a Sonnet query)
      if (entry.classification !== classification) continue;

      const similarity = cosineSimilarity(queryEmbedding, entry.queryEmbedding);
      if (similarity > SIMILARITY_THRESHOLD && similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = entry;
      }
    }

    if (!bestMatch) return null;

    // Update LRU timestamp
    bestMatch.lastAccessedAt = now;
    this.scheduleSave();

    console.log(
      `[cache] Hit (similarity=${bestSimilarity.toFixed(3)}): "${query.slice(0, 60)}..." → cached from ${bestMatch.provider}/${bestMatch.model}`,
    );

    return {
      response: bestMatch.response,
      provider: bestMatch.provider,
      model: bestMatch.model,
    };
  }

  // ---- Store ----

  async store(
    query: string,
    response: string,
    provider: string,
    model: string,
    classification: string,
    usedTools: boolean,
  ): Promise<void> {
    if (!this.ollamaConfig) return;
    if (!response || response.length < 10) return;

    const queryEmbedding = await getEmbedding(
      this.ollamaConfig,
      this.embeddingModel,
      query,
    );
    if (!queryEmbedding) return;

    // Delegate to SQLite if available
    if (this.sqliteStore) {
      const ttlMs = usedTools ? TOOL_TTL_MS : DEFAULT_TTL_MS;
      this.sqliteStore.store(queryEmbedding, query, response, provider, model, classification, usedTools, ttlMs);
      return;
    }

    await this.ensureLoaded();

    const now = Date.now();
    const entry: CachedResponse = {
      queryEmbedding,
      query: query.slice(0, 200), // Store truncated query for debugging
      response,
      provider,
      model,
      classification,
      createdAt: now,
      lastAccessedAt: now,
      ttlMs: usedTools ? TOOL_TTL_MS : DEFAULT_TTL_MS,
      usedTools,
    };

    this.entries.push(entry);

    // Evict expired + LRU if over capacity
    this.evict();

    this.scheduleSave();
  }

  // ---- Eviction ----

  private evict(): void {
    const now = Date.now();

    // Remove expired entries
    this.entries = this.entries.filter((e) => now - e.createdAt <= e.ttlMs);

    // LRU eviction if still over capacity
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
      this.entries = this.entries.slice(0, MAX_ENTRIES);
    }
  }

  // ---- Persistence ----

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const raw = await readFile(this.filePath, 'utf-8');
      const data = JSON.parse(raw) as CacheData;
      this.entries = data.entries ?? [];

      // Prune expired on load
      const now = Date.now();
      const before = this.entries.length;
      this.entries = this.entries.filter((e) => now - e.createdAt <= e.ttlMs);
      if (this.entries.length < before) {
        console.log(`[cache] Loaded ${this.entries.length} entries (pruned ${before - this.entries.length} expired)`);
      } else {
        console.log(`[cache] Loaded ${this.entries.length} cached responses`);
      }
    } catch {
      this.entries = [];
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveToDisk().catch((err) =>
        console.error('[cache] Save error:', err),
      );
    }, SAVE_DEBOUNCE_MS);
    if (this.saveTimer.unref) this.saveTimer.unref();
  }

  private async saveToDisk(): Promise<void> {
    const data: CacheData = {
      version: 1,
      entries: this.entries,
    };

    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(data), 'utf-8');
  }

  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.saveToDisk();
  }

  // ---- Stats ----

  getStats(): { entries: number; maxEntries: number } {
    if (this.sqliteStore) return this.sqliteStore.getStats();
    return { entries: this.entries.length, maxEntries: MAX_ENTRIES };
  }
}

// ---- Utilities ----

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
