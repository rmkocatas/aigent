// ============================================================
// OpenClaw Deploy — Strategy Retrieval with Classification Filter
// ============================================================
//
// Retrieves strategies using classification-first filtering
// then semantic ranking. Reuses memory module's embedding client
// and cosine similarity.
// ============================================================

import { cosineSimilarity, tokenize } from '../memory/memory-searcher.js';
import { getEmbedding } from '../memory/embedding-client.js';
import type { StrategyEntry, StrategySearchResult } from './types.js';
import type { PromptClassification, OllamaConfig } from '../../../types/index.js';

export async function retrieveStrategies(
  userMessage: string,
  classification: PromptClassification,
  generalStrategies: StrategyEntry[],
  classificationStrategies: StrategyEntry[],
  ollamaConfig: OllamaConfig | null,
  embeddingModel: string,
  maxResults: number = 5,
): Promise<StrategySearchResult[]> {
  const candidates = [
    ...generalStrategies.map((s) => ({ entry: s, isGeneral: true })),
    ...classificationStrategies.map((s) => ({ entry: s, isGeneral: false })),
  ];

  if (candidates.length === 0) return [];

  // Get query embedding (reuses memory's embedding client)
  const queryEmbedding = ollamaConfig
    ? await getEmbedding(ollamaConfig, embeddingModel, userMessage)
    : null;

  const scored: StrategySearchResult[] = [];

  for (const { entry, isGeneral } of candidates) {
    let score = 0;

    if (queryEmbedding && entry.embedding) {
      // Semantic similarity
      score = Math.max(0, cosineSimilarity(queryEmbedding, entry.embedding));
    } else {
      // Fallback: Jaccard on tokens from principle + whenToApply
      const queryTokens = new Set(tokenize(userMessage));
      const stratTokens = new Set(tokenize(entry.principle + ' ' + entry.whenToApply));
      const intersection = [...queryTokens].filter((t) => stratTokens.has(t)).length;
      const union = new Set([...queryTokens, ...stratTokens]).size;
      score = union > 0 ? intersection / union : 0;
    }

    // Boost general strategies slightly (always-applicable)
    if (isGeneral) score *= 1.1;

    // Boost high success rate strategies
    score *= 0.5 + 0.5 * entry.successRate;

    // Strength factor
    score *= entry.strength;

    if (score > 0.05) {
      scored.push({ entry, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults);
}
