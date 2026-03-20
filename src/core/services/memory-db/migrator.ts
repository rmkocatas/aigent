// ============================================================
// OpenClaw Deploy — JSON/JSONL → SQLite Migrator
// ============================================================
// One-time migration that imports existing file-based data into
// SQLite. Runs on first startup if the DB is empty.
// ============================================================

import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { MemoryDatabase } from './database.js';
import type { MemoryStoreData, MemoryLayer } from '../memory/types.js';
import { ALL_LAYERS } from '../memory/types.js';
import { SqliteFactStore } from './fact-store.js';
import { FactHistoryService } from './fact-history.js';
import { SqliteActivityStore } from './activity-store.js';
import { SqliteCacheStore } from './cache-store.js';
import type { ActivityLogEntry } from '../document-memory/types.js';

export class Migrator {
  constructor(
    private readonly memDb: MemoryDatabase,
    private readonly baseDir: string,
  ) {}

  /** Run migration only if SQLite is empty */
  async migrateIfNeeded(): Promise<void> {
    const factCount = this.memDb.db.prepare(
      'SELECT COUNT(*) AS cnt FROM facts',
    ).get() as { cnt: number };

    if (factCount.cnt > 0) {
      console.log('[migrator] SQLite already has data, skipping migration');
      return;
    }

    console.log('[migrator] Starting JSON/JSONL → SQLite migration...');
    const t0 = Date.now();

    let factsMigrated = 0;
    let activityMigrated = 0;
    let cacheMigrated = 0;

    try {
      factsMigrated = await this.migrateFacts();
    } catch (err) {
      console.error('[migrator] Facts migration error:', err);
    }

    try {
      activityMigrated = await this.migrateActivity();
    } catch (err) {
      console.error('[migrator] Activity migration error:', err);
    }

    try {
      cacheMigrated = await this.migrateCache();
    } catch (err) {
      console.error('[migrator] Cache migration error:', err);
    }

    console.log(
      `[migrator] Migration complete in ${Date.now() - t0}ms: ` +
      `facts=${factsMigrated} activity=${activityMigrated} cache=${cacheMigrated}`,
    );
  }

  /** Migrate per-user layer JSON files to SQLite */
  private async migrateFacts(): Promise<number> {
    const semanticDir = join(this.baseDir, 'memory', 'semantic');
    const factStore = new SqliteFactStore(this.memDb);
    const historyService = new FactHistoryService(this.memDb);
    let total = 0;

    let userDirs: string[];
    try {
      userDirs = await readdir(semanticDir);
    } catch {
      return 0; // No semantic memory directory
    }

    const tx = this.memDb.db.transaction(() => {
      for (const userDir of userDirs) {
        if (userDir.endsWith('.json') || userDir.endsWith('.bak')) continue;

        const userPath = join(semanticDir, userDir);
        // Read each layer file synchronously within the transaction
        for (const layer of ALL_LAYERS) {
          try {
            const raw = require('fs').readFileSync(join(userPath, `${layer}.json`), 'utf-8');
            const data = JSON.parse(raw) as MemoryStoreData;

            for (const entry of data.entries) {
              // Use direct SQL insert to avoid async issues in transaction
              const embeddingBlob = entry.embedding
                ? Buffer.from(new Float32Array(entry.embedding).buffer)
                : null;

              this.memDb.db.prepare(`
                INSERT OR IGNORE INTO facts
                  (id, user_id, fact, layer, embedding, persons, topics, entities, dates,
                   conversation_id, turn_index, created_at, last_accessed_at, access_count,
                   strength, source_type, is_active)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
              `).run(
                entry.id,
                entry.userId,
                entry.fact,
                entry.layer || layer,
                embeddingBlob,
                JSON.stringify(entry.metadata?.persons ?? []),
                JSON.stringify(entry.metadata?.topics ?? []),
                JSON.stringify(entry.metadata?.entities ?? []),
                JSON.stringify(entry.metadata?.dates ?? []),
                entry.metadata?.conversationId ?? null,
                entry.metadata?.turnIndex ?? 0,
                entry.createdAt,
                entry.lastAccessedAt,
                entry.accessCount,
                entry.strength,
                entry.source?.type ?? 'auto_extract',
              );

              // Log creation in history
              historyService.logChange({
                factId: entry.id,
                userId: entry.userId,
                changeType: 'create',
                newFact: entry.fact,
                newStrength: entry.strength,
                context: 'migrated_from_json',
              });

              total++;
            }

            // Migrate stats
            if (data.stats) {
              this.memDb.db.prepare(`
                INSERT OR REPLACE INTO memory_stats
                  (user_id, layer, total_extractions, total_recalls, total_merges, total_prunes, last_consolidation)
                VALUES (?, ?, ?, ?, ?, ?, ?)
              `).run(
                userDir, layer,
                data.stats.totalExtractions ?? 0,
                data.stats.totalRecalls ?? 0,
                data.stats.totalMerges ?? 0,
                data.stats.totalPrunes ?? 0,
                data.lastConsolidation,
              );
            }
          } catch {
            // Layer file doesn't exist — skip
          }
        }
      }
    });

    tx();
    return total;
  }

  /** Migrate JSONL activity logs to SQLite */
  private async migrateActivity(): Promise<number> {
    const activityDir = join(this.baseDir, 'logs', 'activity');
    const activityStore = new SqliteActivityStore(this.memDb);
    let total = 0;

    let userDirs: string[];
    try {
      userDirs = await readdir(activityDir);
    } catch {
      return 0;
    }

    for (const userDir of userDirs) {
      const userPath = join(activityDir, userDir);
      try {
        const st = await stat(userPath);
        if (!st.isDirectory()) continue;
      } catch {
        continue;
      }

      const files = await readdir(userPath);
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;
        try {
          const content = await readFile(join(userPath, file), 'utf-8');
          const lines = content.split('\n').filter(Boolean);

          // Batch insert in a transaction
          const tx = this.memDb.db.transaction(() => {
            for (const line of lines) {
              try {
                const entry = JSON.parse(line) as ActivityLogEntry;
                activityStore.log(entry);
                total++;
              } catch {
                // Skip malformed lines
              }
            }
          });
          tx();
        } catch {
          // File read error — skip
        }
      }
    }

    return total;
  }

  /** Migrate cache/responses.json to SQLite */
  private async migrateCache(): Promise<number> {
    const cachePath = join(this.baseDir, 'cache', 'responses.json');
    let total = 0;

    try {
      const raw = await readFile(cachePath, 'utf-8');
      const data = JSON.parse(raw) as { entries?: any[] };
      if (!data.entries?.length) return 0;

      const tx = this.memDb.db.transaction(() => {
        for (const entry of data.entries!) {
          if (!entry.queryEmbedding?.length || !entry.response) continue;

          const embeddingBlob = Buffer.from(new Float32Array(entry.queryEmbedding).buffer);

          this.memDb.db.prepare(`
            INSERT INTO response_cache
              (query_embedding, query, response, provider, model, classification,
               created_at, last_accessed_at, ttl_ms, used_tools)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            embeddingBlob,
            entry.query ?? '',
            entry.response,
            entry.provider ?? '',
            entry.model ?? '',
            entry.classification ?? '',
            entry.createdAt ?? Date.now(),
            entry.lastAccessedAt ?? Date.now(),
            entry.ttlMs ?? 3600000,
            entry.usedTools ? 1 : 0,
          );
          total++;
        }
      });
      tx();
    } catch {
      // No cache file — skip
    }

    return total;
  }
}
