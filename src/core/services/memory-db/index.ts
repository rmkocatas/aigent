// ============================================================
// OpenClaw Deploy — Memory Database Module Exports
// ============================================================

export { MemoryDatabase } from './database.js';
export { SqliteFactStore } from './fact-store.js';
export { FactHistoryService } from './fact-history.js';
export { KnowledgeGraphService } from './knowledge-graph.js';
export { SqliteActivityStore } from './activity-store.js';
export { SqliteCacheStore } from './cache-store.js';
export { Migrator } from './migrator.js';
export { encodeEmbedding, decodeEmbedding, cosineSimilarity } from './embedding-codec.js';
export type {
  RelationshipEntry,
  RelationType,
  FactChange,
  FactChangeType,
  GraphQuery,
  GraphEdge,
  ExtractedRelationship,
  SqliteConfig,
} from './types.js';

// ── Singleton setters for late-binding ──

import type { KnowledgeGraphService } from './knowledge-graph.js';
import type { FactHistoryService } from './fact-history.js';

let _knowledgeGraph: KnowledgeGraphService | null = null;
let _factHistory: FactHistoryService | null = null;

export function setKnowledgeGraph(kg: KnowledgeGraphService): void {
  _knowledgeGraph = kg;
}

export function getKnowledgeGraph(): KnowledgeGraphService | null {
  return _knowledgeGraph;
}

export function setFactHistory(fh: FactHistoryService): void {
  _factHistory = fh;
}

export function getFactHistory(): FactHistoryService | null {
  return _factHistory;
}
