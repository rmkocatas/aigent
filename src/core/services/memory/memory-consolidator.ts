// ============================================================
// OpenClaw Deploy — Layer-Aware Memory Consolidation
// ============================================================
//
// Per-layer retention policies:
//   identity:  No decay, no merge (manual management only)
//   projects:  Prune entries inactive for 30+ days, no merge
//   knowledge: Decay + merge near-duplicates + prune weak (original behavior)
//   episodes:  FIFO — keep newest N entries (default 20)
// ============================================================

import type { MemoryEntry, MemoryConfig, ConsolidationReport, MemoryLayer } from './types.js';
import { cosineSimilarity, tokenize } from './memory-searcher.js';

const PROJECT_INACTIVITY_DAYS = 30;
const MAX_EPISODES = 20;

export async function consolidateMemories(
  entries: MemoryEntry[],
  config: MemoryConfig,
  layer?: MemoryLayer,
): Promise<{ entries: MemoryEntry[]; report: ConsolidationReport }> {
  const effectiveLayer = layer ?? 'knowledge';

  switch (effectiveLayer) {
    case 'identity':
      return consolidateIdentity(entries);
    case 'projects':
      return consolidateProjects(entries);
    case 'knowledge':
      return consolidateKnowledge(entries, config);
    case 'episodes':
      return consolidateEpisodes(entries);
    default:
      return consolidateKnowledge(entries, config);
  }
}

/** Identity: no decay, no merge — just return as-is */
function consolidateIdentity(
  entries: MemoryEntry[],
): { entries: MemoryEntry[]; report: ConsolidationReport } {
  return {
    entries,
    report: { decayed: 0, merged: 0, pruned: 0, duration_ms: 0 },
  };
}

/** Projects: prune entries not accessed in 30+ days */
function consolidateProjects(
  entries: MemoryEntry[],
): { entries: MemoryEntry[]; report: ConsolidationReport } {
  const start = Date.now();
  const now = Date.now();
  const cutoff = PROJECT_INACTIVITY_DAYS * 24 * 60 * 60 * 1000;

  const remaining = entries.filter((e) => {
    const daysSinceAccess = now - new Date(e.lastAccessedAt).getTime();
    return daysSinceAccess < cutoff;
  });

  const pruned = entries.length - remaining.length;

  return {
    entries: remaining,
    report: { decayed: 0, merged: 0, pruned, duration_ms: Date.now() - start },
  };
}

/** Knowledge: full decay + merge + prune pipeline (original behavior) */
function consolidateKnowledge(
  entries: MemoryEntry[],
  config: MemoryConfig,
): { entries: MemoryEntry[]; report: ConsolidationReport } {
  const start = Date.now();
  let decayed = 0;
  let merged = 0;
  let pruned = 0;

  const now = Date.now();

  // 1. DECAY: Reduce strength based on time since last access
  for (const entry of entries) {
    const daysSinceAccess =
      (now - new Date(entry.lastAccessedAt).getTime()) / (1000 * 60 * 60 * 24);
    const decay = config.decayRate * daysSinceAccess;
    const newStrength = Math.max(0, entry.strength - decay);
    if (newStrength !== entry.strength) {
      entry.strength = newStrength;
      decayed++;
    }
    // Boost frequently accessed memories
    if (entry.accessCount > 3) {
      entry.strength = Math.min(1.0, entry.strength + 0.05);
    }
  }

  // 2. MERGE: Combine very similar memories
  const toRemove = new Set<string>();

  for (let i = 0; i < entries.length; i++) {
    if (toRemove.has(entries[i].id)) continue;

    for (let j = i + 1; j < entries.length; j++) {
      if (toRemove.has(entries[j].id)) continue;

      let shouldMerge = false;

      // Check similarity using embeddings if available
      if (entries[i].embedding && entries[j].embedding) {
        const sim = cosineSimilarity(entries[i].embedding!, entries[j].embedding!);
        shouldMerge = sim >= config.mergeThreshold;
      } else {
        // Fallback: Jaccard similarity on tokens
        const tokensI = new Set(tokenize(entries[i].fact));
        const tokensJ = new Set(tokenize(entries[j].fact));
        const intersection = [...tokensI].filter((t) => tokensJ.has(t)).length;
        const union = new Set([...tokensI, ...tokensJ]).size;
        const jaccard = union > 0 ? intersection / union : 0;
        shouldMerge = jaccard > 0.85;
      }

      if (shouldMerge) {
        // Keep the stronger/newer one, merge metadata
        const keeper =
          entries[i].strength >= entries[j].strength ? entries[i] : entries[j];
        const absorbed = keeper === entries[i] ? entries[j] : entries[i];

        keeper.metadata.persons = [
          ...new Set([...keeper.metadata.persons, ...absorbed.metadata.persons]),
        ];
        keeper.metadata.topics = [
          ...new Set([...keeper.metadata.topics, ...absorbed.metadata.topics]),
        ];
        keeper.metadata.entities = [
          ...new Set([...keeper.metadata.entities, ...absorbed.metadata.entities]),
        ];
        keeper.metadata.dates = [
          ...new Set([...keeper.metadata.dates, ...absorbed.metadata.dates]),
        ];

        keeper.strength = Math.min(1.0, keeper.strength + 0.1);
        keeper.accessCount += absorbed.accessCount;
        keeper.source = {
          type: 'consolidation_merge',
          originalIds: [
            ...(keeper.source.originalIds ?? [keeper.id]),
            ...(absorbed.source.originalIds ?? [absorbed.id]),
          ],
        };

        toRemove.add(absorbed.id);
        merged++;
      }
    }
  }

  let remaining = entries.filter((e) => !toRemove.has(e.id));

  // 3. PRUNE: Remove memories below minimum strength
  const beforePrune = remaining.length;
  remaining = remaining.filter((e) => e.strength >= config.minStrength);
  pruned = beforePrune - remaining.length;

  return {
    entries: remaining,
    report: {
      decayed,
      merged,
      pruned,
      duration_ms: Date.now() - start,
    },
  };
}

/** Episodes: FIFO — keep only the newest MAX_EPISODES entries */
function consolidateEpisodes(
  entries: MemoryEntry[],
): { entries: MemoryEntry[]; report: ConsolidationReport } {
  const start = Date.now();

  if (entries.length <= MAX_EPISODES) {
    return {
      entries,
      report: { decayed: 0, merged: 0, pruned: 0, duration_ms: 0 },
    };
  }

  // Sort by createdAt descending, keep newest
  const sorted = [...entries].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const remaining = sorted.slice(0, MAX_EPISODES);
  const pruned = entries.length - remaining.length;

  return {
    entries: remaining,
    report: { decayed: 0, merged: 0, pruned, duration_ms: Date.now() - start },
  };
}
