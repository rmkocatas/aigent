// ============================================================
// OpenClaw Deploy — Memory Database Types
// ============================================================

import type { MemoryLayer } from '../memory/types.js';

/** Knowledge graph relationship between two facts */
export interface RelationshipEntry {
  id: string;
  userId: string;
  sourceFactId: string;
  targetFactId: string;
  relationType: RelationType;
  confidence: number;
  extractedAt: string;
  isActive: boolean;
}

export type RelationType =
  | 'works_at'
  | 'located_in'
  | 'prefers'
  | 'uses'
  | 'created'
  | 'related_to'
  | 'part_of'
  | 'knows';

export const ALL_RELATION_TYPES: RelationType[] = [
  'works_at', 'located_in', 'prefers', 'uses',
  'created', 'related_to', 'part_of', 'knows',
];

/** A single mutation event in a fact's lifecycle */
export interface FactChange {
  id: number;
  factId: string;
  userId: string;
  changeType: FactChangeType;
  oldFact: string | null;
  newFact: string | null;
  oldStrength: number | null;
  newStrength: number | null;
  mergedFromIds: string[] | null;
  changedAt: string;
  context: string | null;
}

export type FactChangeType =
  | 'create'
  | 'update'
  | 'merge'
  | 'prune'
  | 'decay'
  | 'forget';

/** Query options for the knowledge graph */
export interface GraphQuery {
  userId: string;
  factId?: string;
  relationType?: RelationType;
  /** Number of hops to traverse (1 or 2) */
  depth?: 1 | 2;
  limit?: number;
}

/** A relationship with resolved fact text */
export interface GraphEdge {
  relationId: string;
  relationType: RelationType;
  confidence: number;
  sourceFact: { id: string; fact: string; layer: MemoryLayer };
  targetFact: { id: string; fact: string; layer: MemoryLayer };
}

/** Relationship extracted by the fact-extractor LLM */
export interface ExtractedRelationship {
  sourceFact: string;
  targetFact: string;
  relationType: RelationType;
  confidence: number;
}

/** SQLite configuration */
export interface SqliteConfig {
  enabled: boolean;
  dbPath?: string;
}
