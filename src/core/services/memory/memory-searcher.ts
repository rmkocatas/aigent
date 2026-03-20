// ============================================================
// OpenClaw Deploy — Triple-Index Memory Search
// ============================================================
//
// Combines semantic (cosine similarity), lexical (BM25), and
// symbolic (metadata filtering) scoring with weighted fusion.
// Pure TypeScript — zero external dependencies.
// ============================================================

import type {
  MemoryEntry,
  SearchQuery,
  SearchResult,
  SearchOptions,
} from './types.js';

// ---------------------------------------------------------------------------
// Cosine Similarity (Semantic Index)
// ---------------------------------------------------------------------------

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

// ---------------------------------------------------------------------------
// BM25 (Lexical Index)
// ---------------------------------------------------------------------------

const K1 = 1.2;
const B = 0.75;

interface BM25Index {
  documentFrequency: Map<string, number>;
  totalDocuments: number;
  avgDocumentLength: number;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function buildBM25Index(entries: MemoryEntry[]): BM25Index {
  const df = new Map<string, number>();
  let totalLength = 0;

  for (const entry of entries) {
    const tokens = new Set(tokenize(entry.fact));
    totalLength += tokenize(entry.fact).length;
    for (const token of tokens) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }

  return {
    documentFrequency: df,
    totalDocuments: entries.length,
    avgDocumentLength:
      entries.length > 0 ? totalLength / entries.length : 0,
  };
}

function bm25Score(
  queryTokens: string[],
  docTokens: string[],
  index: BM25Index,
): number {
  const docLength = docTokens.length;
  const termFreqs = new Map<string, number>();

  for (const token of docTokens) {
    termFreqs.set(token, (termFreqs.get(token) ?? 0) + 1);
  }

  let score = 0;

  for (const queryTerm of queryTokens) {
    const tf = termFreqs.get(queryTerm) ?? 0;
    if (tf === 0) continue;

    const df = index.documentFrequency.get(queryTerm) ?? 0;
    const N = index.totalDocuments;

    const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
    const tfNorm =
      (tf * (K1 + 1)) /
      (tf + K1 * (1 - B + B * (docLength / index.avgDocumentLength)));

    score += idf * tfNorm;
  }

  return score;
}

// ---------------------------------------------------------------------------
// Symbolic (Metadata) Scoring
// ---------------------------------------------------------------------------

function symbolicScore(
  entry: MemoryEntry,
  filters?: SearchQuery['metadataFilters'],
): number {
  if (!filters) return 0;

  let matches = 0;
  let totalFilters = 0;

  if (filters.persons?.length) {
    totalFilters++;
    const entryLower = entry.metadata.persons.map((p) => p.toLowerCase());
    if (filters.persons.some((p) => entryLower.includes(p.toLowerCase()))) {
      matches++;
    }
  }

  if (filters.topics?.length) {
    totalFilters++;
    const entryLower = entry.metadata.topics.map((t) => t.toLowerCase());
    if (filters.topics.some((t) => entryLower.includes(t.toLowerCase()))) {
      matches++;
    }
  }

  if (filters.entities?.length) {
    totalFilters++;
    const entryLower = entry.metadata.entities.map((e) => e.toLowerCase());
    if (filters.entities.some((e) => entryLower.includes(e.toLowerCase()))) {
      matches++;
    }
  }

  if (filters.dateRange) {
    totalFilters++;
    const { from, to } = filters.dateRange;
    const matched = entry.metadata.dates.some((d) => {
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
    if (matched) matches++;
  }

  return totalFilters > 0 ? matches / totalFilters : 0;
}

// ---------------------------------------------------------------------------
// Fused Search
// ---------------------------------------------------------------------------

export async function searchMemories(
  query: SearchQuery,
  entries: MemoryEntry[],
  queryEmbedding: number[] | null,
  options: SearchOptions,
): Promise<SearchResult[]> {
  if (entries.length === 0) return [];

  const bm25Index = buildBM25Index(entries);
  const queryTokens = tokenize(query.text);

  // Pre-compute all BM25 scores for normalization
  const rawBm25Scores: number[] = [];
  for (const entry of entries) {
    const docTokens = tokenize(entry.fact);
    rawBm25Scores.push(bm25Score(queryTokens, docTokens, bm25Index));
  }
  const maxBm25 = Math.max(...rawBm25Scores, 1);

  const results: SearchResult[] = [];
  const now = Date.now();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    // Semantic score
    let semantic = 0;
    if (queryEmbedding && entry.embedding) {
      semantic = Math.max(0, cosineSimilarity(queryEmbedding, entry.embedding));
    }

    // Lexical score (normalized to [0, 1])
    const lexical = maxBm25 > 0 ? rawBm25Scores[i] / maxBm25 : 0;

    // Symbolic score
    const symbolic = symbolicScore(entry, query.metadataFilters);

    // Weighted combination
    let combined: number;
    if (queryEmbedding) {
      combined =
        semantic * options.semanticWeight +
        lexical * options.lexicalWeight +
        symbolic * options.symbolicWeight;
    } else {
      // No embeddings — redistribute semantic weight
      const adjustedLexical =
        options.lexicalWeight + options.semanticWeight * 0.7;
      const adjustedSymbolic =
        options.symbolicWeight + options.semanticWeight * 0.3;
      combined = lexical * adjustedLexical + symbolic * adjustedSymbolic;
    }

    // Recency boost
    const daysSinceAccess =
      (now - new Date(entry.lastAccessedAt).getTime()) / (1000 * 60 * 60 * 24);
    const recencyBoost = Math.max(0, 0.05 * Math.exp(-daysSinceAccess / 7));

    // Final score with strength factor
    const finalScore = combined * entry.strength + recencyBoost;

    if (finalScore > 0.01) {
      results.push({
        entry,
        score: finalScore,
        scores: { semantic, lexical, symbolic },
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, options.maxResults);
}
