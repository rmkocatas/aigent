// ============================================================
// OpenClaw Deploy — SQLite Memory Database
// ============================================================
// Single WAL-mode database for facts, relationships, history,
// activity logs, and response cache.
// ============================================================

import Database from 'better-sqlite3';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export class MemoryDatabase {
  readonly db: Database.Database;

  constructor(dbPath: string) {
    // Synchronous open — caller must ensure directory exists
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
    console.log(`[memory-db] Opened SQLite database at ${dbPath}`);
  }

  /** Ensure the parent directory exists before constructing */
  static async create(dbPath: string): Promise<MemoryDatabase> {
    await mkdir(dirname(dbPath), { recursive: true });
    return new MemoryDatabase(dbPath);
  }

  private initSchema(): void {
    this.db.exec(`
      -- Facts: replaces per-user layer JSON files
      CREATE TABLE IF NOT EXISTS facts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        fact TEXT NOT NULL,
        layer TEXT NOT NULL CHECK(layer IN ('identity','projects','knowledge','episodes')),
        embedding BLOB,
        persons TEXT NOT NULL DEFAULT '[]',
        topics TEXT NOT NULL DEFAULT '[]',
        entities TEXT NOT NULL DEFAULT '[]',
        dates TEXT NOT NULL DEFAULT '[]',
        conversation_id TEXT,
        turn_index INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        last_accessed_at TEXT NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0,
        strength REAL NOT NULL DEFAULT 1.0,
        source_type TEXT NOT NULL DEFAULT 'auto_extract',
        is_active INTEGER NOT NULL DEFAULT 1
      );

      -- Fact version history
      CREATE TABLE IF NOT EXISTS fact_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fact_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        change_type TEXT NOT NULL CHECK(change_type IN ('create','update','merge','prune','decay','forget')),
        old_fact TEXT,
        new_fact TEXT,
        old_strength REAL,
        new_strength REAL,
        merged_from_ids TEXT,
        changed_at TEXT NOT NULL,
        context TEXT
      );

      -- Knowledge graph relationships
      CREATE TABLE IF NOT EXISTS relationships (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        source_fact_id TEXT NOT NULL REFERENCES facts(id),
        target_fact_id TEXT NOT NULL REFERENCES facts(id),
        relation_type TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 1.0,
        extracted_at TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        UNIQUE(source_fact_id, target_fact_id, relation_type)
      );

      -- Per-user per-layer aggregate stats
      CREATE TABLE IF NOT EXISTS memory_stats (
        user_id TEXT NOT NULL,
        layer TEXT NOT NULL,
        total_extractions INTEGER NOT NULL DEFAULT 0,
        total_recalls INTEGER NOT NULL DEFAULT 0,
        total_merges INTEGER NOT NULL DEFAULT 0,
        total_prunes INTEGER NOT NULL DEFAULT 0,
        last_consolidation TEXT,
        PRIMARY KEY(user_id, layer)
      );

      -- Activity log (replaces JSONL files)
      CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        user_id TEXT NOT NULL,
        conversation_id TEXT,
        channel TEXT,
        user_message TEXT,
        classification TEXT,
        provider TEXT,
        model TEXT,
        tools_used TEXT NOT NULL DEFAULT '[]',
        tool_errors TEXT NOT NULL DEFAULT '[]',
        response_snippet TEXT
      );

      -- Response cache (replaces cache/responses.json)
      CREATE TABLE IF NOT EXISTS response_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query_embedding BLOB,
        query TEXT,
        response TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        classification TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL,
        ttl_ms INTEGER NOT NULL,
        used_tools INTEGER NOT NULL DEFAULT 0
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_facts_user_layer ON facts(user_id, layer);
      CREATE INDEX IF NOT EXISTS idx_facts_active ON facts(user_id, is_active);
      CREATE INDEX IF NOT EXISTS idx_fact_history_fact ON fact_history(fact_id);
      CREATE INDEX IF NOT EXISTS idx_fact_history_user_time ON fact_history(user_id, changed_at);
      CREATE INDEX IF NOT EXISTS idx_rel_source ON relationships(source_fact_id);
      CREATE INDEX IF NOT EXISTS idx_rel_target ON relationships(target_fact_id);
      CREATE INDEX IF NOT EXISTS idx_rel_user_type ON relationships(user_id, relation_type);
      CREATE INDEX IF NOT EXISTS idx_activity_user_time ON activity_log(user_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_cache_class_time ON response_cache(classification, created_at);
    `);
  }

  close(): void {
    this.db.close();
    console.log('[memory-db] Database closed');
  }
}
