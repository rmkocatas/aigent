// ============================================================
// OpenClaw Deploy — Dynamic Strategy Type Definitions
// ============================================================
//
// Inspired by SkillRL (arxiv 2602.08234): distill behavioral
// patterns from tool-using conversations into a hierarchical
// strategy library that co-evolves with the agent.
// ============================================================

// StrategyConfig lives in types/index.ts (part of GatewayRuntimeConfig)
export type { StrategyConfig, PromptClassification } from '../../../types/index.js';

/** Outcome signal inferred from tool call results */
export type OutcomeSignal = 'success' | 'failure' | 'mixed';

export interface StrategyEntry {
  id: string;
  userId: string;
  name: string;               // Short label, e.g. "Cross-source verification"
  principle: string;           // Behavioral principle describing the approach
  whenToApply: string;         // Condition description for applicability
  classification: string;      // PromptClassification | 'general'
  embedding: number[] | null;  // nomic-embed-text vector (768-dim)

  // Performance tracking
  useCount: number;
  successCount: number;
  failureCount: number;
  successRate: number;         // successCount / max(1, successCount + failureCount)
  strength: number;            // 0.0 - 1.0, decays for poor performance

  // Provenance
  toolsInvolved: string[];
  sourceConversationId: string;

  // Timestamps
  createdAt: string;
  lastUsedAt: string;
  updatedAt: string;
}

export interface StrategyStoreData {
  version: 1;
  scope: string;               // 'general' | PromptClassification
  entries: StrategyEntry[];
  lastConsolidation: string | null;
  stats: StrategyStats;
}

export interface StrategyStats {
  totalStrategies: number;
  totalExtractions: number;
  totalInjections: number;
  totalConsolidations: number;
}

export interface StrategyExtractionResult {
  strategies: ExtractedStrategy[];
  skipped: boolean;
  reason?: string;
}

export interface ExtractedStrategy {
  name: string;
  principle: string;
  whenToApply: string;
  classification: string;       // PromptClassification | 'general'
  toolsInvolved: string[];
  confidence: number;
}

export interface StrategySearchResult {
  entry: StrategyEntry;
  score: number;
}

export interface StrategyConsolidationReport {
  merged: number;
  pruned: number;
  duration_ms: number;
}
