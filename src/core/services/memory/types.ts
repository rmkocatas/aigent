// ============================================================
// OpenClaw Deploy — Semantic Memory Type Definitions
// ============================================================

// MemoryConfig is defined in types/index.ts (part of GatewayRuntimeConfig)
export type { MemoryConfig } from '../../../types/index.js';

export type MemoryLayer = 'identity' | 'projects' | 'knowledge' | 'episodes';

export const ALL_LAYERS: MemoryLayer[] = ['identity', 'projects', 'knowledge', 'episodes'];

export interface MemoryEntry {
  id: string;
  userId: string;
  fact: string;
  layer: MemoryLayer;
  embedding: number[] | null;
  metadata: MemoryMetadata;
  createdAt: string;
  lastAccessedAt: string;
  accessCount: number;
  strength: number; // 0.0 - 1.0, decays over time
  source: MemorySource;
}

export interface MemoryMetadata {
  persons: string[];
  topics: string[];
  entities: string[];
  dates: string[];
  conversationId: string;
  turnIndex: number;
}

export interface MemorySource {
  type: 'auto_extract' | 'explicit_store' | 'consolidation_merge';
  originalIds?: string[];
}

export interface MemoryStoreData {
  version: 1 | 2;
  layer?: MemoryLayer;
  entries: MemoryEntry[];
  lastConsolidation: string | null;
  stats: MemoryStats;
}

export interface MemoryStats {
  totalFacts: number;
  totalExtractions: number;
  totalRecalls: number;
  totalMerges: number;
  totalPrunes: number;
}

export interface ExtractedRelationship {
  sourceFact: string;
  targetFact: string;
  relationType: string;
  confidence: number;
}

export interface ExtractionResult {
  facts: ExtractedFact[];
  relationships?: ExtractedRelationship[];
  skipped: boolean;
  reason?: string;
}

export interface ExtractedFact {
  fact: string;
  persons: string[];
  topics: string[];
  entities: string[];
  dates: string[];
  confidence: number;
  layer?: MemoryLayer;
}

export interface SearchQuery {
  text: string;
  metadataFilters?: {
    persons?: string[];
    topics?: string[];
    entities?: string[];
    dateRange?: { from?: string; to?: string };
  };
}

export interface SearchResult {
  entry: MemoryEntry;
  score: number;
  scores: {
    semantic: number;
    lexical: number;
    symbolic: number;
  };
}

export interface SearchOptions {
  maxResults: number;
  semanticWeight: number;
  lexicalWeight: number;
  symbolicWeight: number;
}

export interface ConsolidationReport {
  decayed: number;
  merged: number;
  pruned: number;
  duration_ms: number;
}
