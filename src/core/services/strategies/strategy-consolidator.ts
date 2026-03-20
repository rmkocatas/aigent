// ============================================================
// OpenClaw Deploy — Strategy Consolidation
// ============================================================
//
// Success-rate-based consolidation:
//   - Strength decay for low-performing strategies
//   - Strength boost for proven high-performers
//   - Merge near-duplicate strategies
//   - Prune entries below minimum strength
// ============================================================

import type { StrategyEntry, StrategyConfig, StrategyConsolidationReport } from './types.js';
import { cosineSimilarity, tokenize } from '../memory/memory-searcher.js';

export function consolidateStrategies(
  entries: StrategyEntry[],
  config: StrategyConfig,
): { entries: StrategyEntry[]; report: StrategyConsolidationReport } {
  const start = Date.now();
  let merged = 0;
  let pruned = 0;

  const now = Date.now();

  // 1. STRENGTH ADJUSTMENTS based on performance and usage
  for (const entry of entries) {
    // Accelerated decay for proven-bad strategies
    if (entry.useCount > 3 && entry.successRate < config.minSuccessRate) {
      entry.strength = Math.max(0, entry.strength - 0.15);
    }

    // Mild decay for unused strategies (>14 days since last use)
    const daysSinceUse = (now - new Date(entry.lastUsedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceUse > 14) {
      entry.strength = Math.max(0, entry.strength - 0.02 * (daysSinceUse / 14));
    }

    // Boost for high-success, frequently used strategies
    if (entry.useCount > 5 && entry.successRate > 0.8) {
      entry.strength = Math.min(1.0, entry.strength + 0.05);
    }
  }

  // 2. MERGE near-duplicate strategies
  const toRemove = new Set<string>();

  for (let i = 0; i < entries.length; i++) {
    if (toRemove.has(entries[i].id)) continue;

    for (let j = i + 1; j < entries.length; j++) {
      if (toRemove.has(entries[j].id)) continue;

      let shouldMerge = false;

      if (entries[i].embedding && entries[j].embedding) {
        shouldMerge = cosineSimilarity(entries[i].embedding!, entries[j].embedding!) >= config.mergeThreshold;
      } else {
        // Fallback: Jaccard on principle text
        const tokensI = new Set(tokenize(entries[i].principle));
        const tokensJ = new Set(tokenize(entries[j].principle));
        const intersection = [...tokensI].filter((t) => tokensJ.has(t)).length;
        const union = new Set([...tokensI, ...tokensJ]).size;
        shouldMerge = union > 0 && intersection / union > 0.85;
      }

      if (shouldMerge) {
        // Keep the one with better success rate
        const keeper = entries[i].successRate >= entries[j].successRate ? entries[i] : entries[j];
        const absorbed = keeper === entries[i] ? entries[j] : entries[i];

        keeper.useCount += absorbed.useCount;
        keeper.successCount += absorbed.successCount;
        keeper.failureCount += absorbed.failureCount;
        keeper.successRate = keeper.successCount / Math.max(1, keeper.successCount + keeper.failureCount);
        keeper.toolsInvolved = [...new Set([...keeper.toolsInvolved, ...absorbed.toolsInvolved])];
        keeper.strength = Math.min(1.0, keeper.strength + 0.1);
        keeper.updatedAt = new Date().toISOString();

        toRemove.add(absorbed.id);
        merged++;
      }
    }
  }

  let remaining = entries.filter((e) => !toRemove.has(e.id));

  // 3. PRUNE: Remove strategies below minimum strength
  const beforePrune = remaining.length;
  remaining = remaining.filter((e) => e.strength >= config.minStrength);
  pruned = beforePrune - remaining.length;

  return {
    entries: remaining,
    report: { merged, pruned, duration_ms: Date.now() - start },
  };
}
