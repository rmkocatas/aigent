// ============================================================
// OpenClaw Deploy — Layered Semantic Memory Engine
// ============================================================
//
// 4-layer memory architecture:
//   identity  (200 tok) — always injected, no decay
//   projects  (300 tok) — injected if relevant, 30-day inactivity prune
//   knowledge (200 tok) — injected if relevant, decay/merge/prune
//   episodes  (100 tok) — last conversation summary, FIFO
//
// Total injection budget: 800 tokens (same as before, but structured)
// ============================================================

import type { OllamaConfig } from '../../../types/index.js';
import type {
  MemoryConfig,
  MemoryEntry,
  MemoryLayer,
  SearchResult,
  SearchQuery,
  ConsolidationReport,
} from './types.js';
import { ALL_LAYERS } from './types.js';
import { MemoryStore } from './memory-store.js';
import { extractFacts } from './fact-extractor.js';
import { searchMemories } from './memory-searcher.js';
import { consolidateMemories } from './memory-consolidator.js';
import { getEmbedding } from './embedding-client.js';
import { estimateTokens } from '../../gateway/token-estimator.js';
import { randomUUID } from 'node:crypto';
import type { MemoryDatabase } from '../memory-db/database.js';
import { SqliteFactStore } from '../memory-db/fact-store.js';
import { FactHistoryService } from '../memory-db/fact-history.js';
import { KnowledgeGraphService } from '../memory-db/knowledge-graph.js';
import type { ExtractedRelationship } from '../memory-db/types.js';

/** Per-layer injection token budgets */
const LAYER_BUDGETS: Record<MemoryLayer, number> = {
  identity: 200,
  projects: 300,
  knowledge: 200,
  episodes: 100,
};

/** Keywords that indicate a project/task-related query */
const PROJECT_QUERY_PATTERNS = /\b(project|task|deploy|build|implement|refactor|progress|status|auto|autonomous|milestone|sprint)\b/i;

export class MemoryEngine {
  private store: MemoryStore | SqliteFactStore;
  private consolidationTimer: ReturnType<typeof setInterval> | null = null;
  readonly config: MemoryConfig;
  private factHistory: FactHistoryService | null = null;
  private knowledgeGraph: KnowledgeGraphService | null = null;

  constructor(
    config: MemoryConfig,
    private ollamaConfig: OllamaConfig | null,
    private anthropicApiKey: string | null,
    memoryDir: string,
    private openaiApiKey?: string | null,
    memoryDb?: MemoryDatabase,
  ) {
    this.config = config;
    if (memoryDb) {
      this.store = new SqliteFactStore(memoryDb);
      this.factHistory = new FactHistoryService(memoryDb);
      this.knowledgeGraph = new KnowledgeGraphService(memoryDb);
      console.log('[memory] Using SQLite-backed fact store');
    } else {
      this.store = new MemoryStore(memoryDir);
    }
  }

  /** Expose graph and history services for external wiring */
  getKnowledgeGraph(): KnowledgeGraphService | null { return this.knowledgeGraph; }
  getFactHistory(): FactHistoryService | null { return this.factHistory; }

  // ---- Lifecycle ----

  start(): void {
    if (this.config.consolidationIntervalMs > 0) {
      this.consolidationTimer = setInterval(
        () =>
          this.runConsolidationAll().catch((err) =>
            console.error('[memory] Consolidation error:', err),
          ),
        this.config.consolidationIntervalMs,
      );
      this.consolidationTimer.unref();
    }
    console.log('[memory] Layered semantic memory engine started');
  }

  stop(): void {
    if (this.consolidationTimer) {
      clearInterval(this.consolidationTimer);
      this.consolidationTimer = null;
    }
    this.store.flush().catch(() => {});
  }

  // ---- Extraction (called after response, async) ----

  async extractAndStore(
    userId: string,
    userMessage: string,
    assistantResponse: string,
    conversationId: string,
    turnIndex: number,
  ): Promise<void> {
    if (!this.config.autoExtract) return;

    try {
      const result = await extractFacts(
        userMessage,
        assistantResponse,
        this.config,
        this.ollamaConfig,
        this.anthropicApiKey,
        undefined,
        this.openaiApiKey,
      );

      if (result.skipped || result.facts.length === 0) return;

      // Map fact text → stored ID for relationship matching
      const factTextToId = new Map<string, string>();

      for (const fact of result.facts) {
        const layer = fact.layer ?? 'knowledge';

        // Check per-layer capacity
        const stats = await this.store.getLayerStats(userId, layer);
        if (stats.count >= stats.capacity) {
          continue; // skip this fact, layer is full
        }

        const embedding = this.ollamaConfig
          ? await getEmbedding(
              this.ollamaConfig,
              this.config.embeddingModel,
              fact.fact,
            )
          : null;

        const entry: MemoryEntry = {
          id: randomUUID().slice(0, 8),
          userId,
          fact: fact.fact,
          layer,
          embedding,
          metadata: {
            persons: fact.persons,
            topics: fact.topics,
            entities: fact.entities,
            dates: fact.dates,
            conversationId,
            turnIndex,
          },
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
          accessCount: 0,
          strength: Math.min(1.0, fact.confidence),
          source: { type: 'auto_extract' },
        };

        await this.store.addEntry(userId, entry);
        factTextToId.set(fact.fact, entry.id);

        // Log fact creation in history
        if (this.factHistory) {
          this.factHistory.logChange({
            factId: entry.id,
            userId,
            changeType: 'create',
            newFact: entry.fact,
            newStrength: entry.strength,
            context: `conversation:${conversationId}`,
          });
        }
      }

      await this.store.save(userId);

      // Store extracted relationships in the knowledge graph
      if (this.knowledgeGraph && result.relationships?.length) {
        const stored = this.knowledgeGraph.storeRelationships(
          userId,
          result.relationships as ExtractedRelationship[],
          factTextToId,
        );
        if (stored > 0) {
          console.log(`[memory] Stored ${stored} relationship(s) for ${userId}`);
        }
      }

      const layerCounts = result.facts.reduce(
        (acc, f) => {
          const l = f.layer ?? 'knowledge';
          acc[l] = (acc[l] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );
      const layerSummary = Object.entries(layerCounts)
        .map(([l, c]) => `${l}=${c}`)
        .join(', ');
      console.log(
        `[memory] Extracted ${result.facts.length} fact(s) for ${userId}: ${layerSummary}`,
      );
    } catch (err) {
      console.error('[memory] Extraction error:', err);
    }
  }

  // ---- Search ----

  async search(
    userId: string,
    queryText: string,
    maxResults?: number,
  ): Promise<SearchResult[]> {
    // Search across all layers
    const allEntries = await this.store.getEntries(userId);
    if (allEntries.length === 0) return [];

    const queryEmbedding = this.ollamaConfig
      ? await getEmbedding(
          this.ollamaConfig,
          this.config.embeddingModel,
          queryText,
        )
      : null;

    const query: SearchQuery = { text: queryText };

    const results = await searchMemories(query, allEntries, queryEmbedding, {
      ...this.config.searchDefaults,
      maxResults: maxResults ?? this.config.searchDefaults.maxResults,
    });

    // Update access timestamps
    const now = new Date().toISOString();
    for (const r of results) {
      r.entry.lastAccessedAt = now;
      r.entry.accessCount++;
    }

    await this.store.save(userId);
    return results;
  }

  // ---- Layer-Aware Context Injection ----

  async getContextInjection(
    userId: string,
    userMessage: string,
  ): Promise<string | null> {
    if (!this.config.autoInject) return null;

    const layers = await this.store.getLayerEntries(userId);
    const sections: string[] = [];

    // Layer 1: Identity — always injected (200 tok budget)
    if (layers.identity.length > 0) {
      const identitySection = this.buildLayerSection(
        'About this user',
        layers.identity,
        LAYER_BUDGETS.identity,
      );
      if (identitySection) sections.push(identitySection);
    }

    // Layer 2: Projects — injected if query seems project-related (300 tok budget)
    if (layers.projects.length > 0 && PROJECT_QUERY_PATTERNS.test(userMessage)) {
      const projectSection = await this.buildSearchedSection(
        'Active projects',
        layers.projects,
        userMessage,
        LAYER_BUDGETS.projects,
      );
      if (projectSection) sections.push(projectSection);
    }

    // Layer 3: Knowledge — semantic search for relevant facts (200 tok budget)
    if (layers.knowledge.length > 0) {
      const knowledgeSection = await this.buildSearchedSection(
        'Relevant memories',
        layers.knowledge,
        userMessage,
        LAYER_BUDGETS.knowledge,
      );
      if (knowledgeSection) sections.push(knowledgeSection);
    }

    // Layer 4: Episodes — inject most recent conversation summary (100 tok budget)
    if (layers.episodes.length > 0) {
      const sorted = [...layers.episodes].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      const episodeSection = this.buildLayerSection(
        'Last conversation',
        sorted.slice(0, 1),
        LAYER_BUDGETS.episodes,
      );
      if (episodeSection) sections.push(episodeSection);
    }

    if (sections.length === 0) return null;
    return sections.join('\n');
  }

  /** Build a section from a static list of entries (identity, episodes) */
  private buildLayerSection(
    header: string,
    entries: MemoryEntry[],
    budget: number,
  ): string | null {
    const headerLine = `[${header}]`;
    let usedTokens = estimateTokens(headerLine) + 2;
    const lines = [headerLine];

    for (const entry of entries) {
      const line = `- ${entry.fact}`;
      const lineTokens = estimateTokens(line);
      if (usedTokens + lineTokens > budget) break;
      lines.push(line);
      usedTokens += lineTokens;
    }

    if (lines.length <= 1) return null;
    return lines.join('\n');
  }

  /** Build a section by searching entries for relevance to the query */
  private async buildSearchedSection(
    header: string,
    entries: MemoryEntry[],
    queryText: string,
    budget: number,
  ): Promise<string | null> {
    if (entries.length === 0) return null;

    const queryEmbedding = this.ollamaConfig
      ? await getEmbedding(
          this.ollamaConfig,
          this.config.embeddingModel,
          queryText,
        )
      : null;

    const query: SearchQuery = { text: queryText };
    const results = await searchMemories(query, entries, queryEmbedding, {
      ...this.config.searchDefaults,
      maxResults: 15,
    });

    if (results.length === 0) return null;

    // Update access timestamps
    const now = new Date().toISOString();
    for (const r of results) {
      r.entry.lastAccessedAt = now;
      r.entry.accessCount++;
    }

    const headerLine = `[${header}]`;
    let usedTokens = estimateTokens(headerLine) + 2;
    const lines = [headerLine];

    for (const result of results) {
      const line = `- ${result.entry.fact}`;
      const lineTokens = estimateTokens(line);
      if (usedTokens + lineTokens > budget) break;
      lines.push(line);
      usedTokens += lineTokens;
    }

    if (lines.length <= 1) return null;
    return lines.join('\n');
  }

  // ---- Explicit Store ----

  async explicitStore(
    userId: string,
    fact: string,
    conversationId: string,
    layer?: MemoryLayer,
  ): Promise<string> {
    const targetLayer = layer ?? 'knowledge';
    const stats = await this.store.getLayerStats(userId, targetLayer);

    if (stats.count >= stats.capacity) {
      return `${targetLayer} memory limit reached (${stats.capacity}). Use memory_forget to remove old memories.`;
    }

    const embedding = this.ollamaConfig
      ? await getEmbedding(
          this.ollamaConfig,
          this.config.embeddingModel,
          fact,
        )
      : null;

    const entry: MemoryEntry = {
      id: randomUUID().slice(0, 8),
      userId,
      fact,
      layer: targetLayer,
      embedding,
      metadata: {
        persons: [],
        topics: [],
        entities: [],
        dates: [],
        conversationId,
        turnIndex: -1,
      },
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      accessCount: 0,
      strength: 1.0,
      source: { type: 'explicit_store' },
    };

    await this.store.addEntry(userId, entry);
    await this.store.save(userId);

    if (this.factHistory) {
      this.factHistory.logChange({
        factId: entry.id,
        userId,
        changeType: 'create',
        newFact: fact,
        newStrength: 1.0,
        context: 'explicit_store',
      });
    }

    return `Remembered in ${targetLayer}: "${fact}" (ID: ${entry.id})`;
  }

  // ---- Explicit Forget ----

  async explicitForget(userId: string, query: string): Promise<string> {
    // First try by ID
    const removed = await this.store.removeEntry(userId, query);
    if (removed) {
      await this.store.save(userId);
      if (this.factHistory) {
        this.factHistory.logChange({
          factId: query,
          userId,
          changeType: 'forget',
          context: 'explicit_forget_by_id',
        });
      }
      if (this.knowledgeGraph) {
        this.knowledgeGraph.deactivateForFact(query);
      }
      return `Forgot memory ${query}.`;
    }

    // Otherwise search and remove best match
    const results = await this.search(userId, query, 1);
    if (results.length === 0) return `No matching memory found for "${query}".`;

    const best = results[0];
    if (best.score < 0.3) {
      return `No confident match for "${query}". Top result (score ${best.score.toFixed(2)}): "${best.entry.fact}"`;
    }

    await this.store.removeEntry(userId, best.entry.id);
    await this.store.save(userId);

    if (this.factHistory) {
      this.factHistory.logChange({
        factId: best.entry.id,
        userId,
        changeType: 'forget',
        oldFact: best.entry.fact,
        oldStrength: best.entry.strength,
        context: `query:${query}`,
      });
    }
    // Deactivate graph relationships for forgotten fact
    if (this.knowledgeGraph) {
      this.knowledgeGraph.deactivateForFact(best.entry.id);
    }

    return `Forgot: "${best.entry.fact}" (ID: ${best.entry.id}, layer: ${best.entry.layer})`;
  }

  // ---- Episode Storage (for end-of-session summaries) ----

  async storeEpisode(
    userId: string,
    summary: string,
    conversationId: string,
    topics: string[],
  ): Promise<void> {
    const entry: MemoryEntry = {
      id: randomUUID().slice(0, 8),
      userId,
      fact: summary,
      layer: 'episodes',
      embedding: null, // episodes don't need embeddings
      metadata: {
        persons: [],
        topics,
        entities: [],
        dates: [new Date().toISOString().split('T')[0]],
        conversationId,
        turnIndex: -1,
      },
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      accessCount: 0,
      strength: 1.0,
      source: { type: 'auto_extract' },
    };

    await this.store.addEntry(userId, entry);
    await this.store.save(userId);
    console.log(`[memory] Stored episode for ${userId}: ${summary.slice(0, 80)}...`);
  }

  // ---- Consolidation ----

  private async runConsolidationAll(): Promise<void> {
    for (const userId of this.store.getLoadedUserIds()) {
      await this.runConsolidation(userId);
    }
  }

  async runConsolidation(userId: string): Promise<ConsolidationReport> {
    const totalReport: ConsolidationReport = {
      decayed: 0,
      merged: 0,
      pruned: 0,
      duration_ms: 0,
    };

    const now = new Date().toISOString();

    for (const layer of ALL_LAYERS) {
      const entries = await this.store.getEntries(userId, layer);
      if (entries.length === 0) continue;

      const { entries: consolidated, report } = await consolidateMemories(
        entries,
        this.config,
        layer,
      );

      await this.store.replaceEntries(userId, consolidated, layer);
      await this.store.setLastConsolidation(userId, layer, now);

      if (report.merged > 0 || report.pruned > 0) {
        await this.store.updateStats(userId, layer, {
          totalMerges: report.merged,
          totalPrunes: report.pruned,
        });
      }

      totalReport.decayed += report.decayed;
      totalReport.merged += report.merged;
      totalReport.pruned += report.pruned;
      totalReport.duration_ms += report.duration_ms;
    }

    await this.store.save(userId);

    if (totalReport.merged > 0 || totalReport.pruned > 0) {
      console.log(
        `[memory] Consolidation for ${userId}: merged=${totalReport.merged} pruned=${totalReport.pruned} decayed=${totalReport.decayed}`,
      );
    }

    return totalReport;
  }
}
