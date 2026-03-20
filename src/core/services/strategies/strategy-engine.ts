// ============================================================
// OpenClaw Deploy — Dynamic Strategy Engine
// ============================================================
//
// Orchestrates strategy extraction, retrieval, injection, and
// consolidation. Follows the MemoryEngine pattern exactly.
//
// Inspired by SkillRL (arxiv 2602.08234): behavioral patterns
// distilled from tool-using conversations, organized in a
// classification-aligned hierarchy (general + per-classification).
// ============================================================

import type { OllamaConfig, PromptClassification } from '../../../types/index.js';
import type {
  StrategyConfig,
  StrategyEntry,
  StrategySearchResult,
  OutcomeSignal,
  StrategyConsolidationReport,
} from './types.js';
import { StrategyStore } from './strategy-store.js';
import { extractStrategies } from './strategy-extractor.js';
import { retrieveStrategies } from './strategy-retriever.js';
import { consolidateStrategies } from './strategy-consolidator.js';
import { getEmbedding } from '../memory/embedding-client.js';
import { estimateTokens } from '../../gateway/token-estimator.js';
import { randomUUID } from 'node:crypto';

const ALL_CLASSIFICATIONS: PromptClassification[] = [
  'simple', 'complex', 'coding', 'tool_simple', 'web_content', 'default',
];

export class StrategyEngine {
  private store: StrategyStore;
  private consolidationTimer: ReturnType<typeof setInterval> | null = null;
  readonly config: StrategyConfig;

  constructor(
    config: StrategyConfig,
    private ollamaConfig: OllamaConfig | null,
    private anthropicApiKey: string | null,
    private openaiApiKey?: string | null,
  ) {
    this.config = config;
    this.store = new StrategyStore(config.storageDir);
  }

  // ---- Lifecycle ----

  start(): void {
    if (this.config.consolidationIntervalMs > 0) {
      this.consolidationTimer = setInterval(
        () =>
          this.runConsolidationAll().catch((err) =>
            console.error('[strategy] Consolidation error:', err),
          ),
        this.config.consolidationIntervalMs,
      );
      this.consolidationTimer.unref();
    }
    console.log('[strategy] Dynamic strategy engine started');
  }

  stop(): void {
    if (this.consolidationTimer) {
      clearInterval(this.consolidationTimer);
      this.consolidationTimer = null;
    }
    this.store.flush().catch(() => {});
  }

  // ---- Extraction (called after tool-using conversations, async fire-and-forget) ----

  async extractAndStore(
    userId: string,
    userMessage: string,
    assistantResponse: string,
    toolCalls: Array<{ name: string; isError: boolean }>,
    classification: PromptClassification,
    outcome: OutcomeSignal,
    conversationId: string,
  ): Promise<void> {
    if (!this.config.autoExtract) return;
    if (toolCalls.length === 0) return;

    try {
      const result = await extractStrategies(
        userMessage,
        assistantResponse,
        toolCalls,
        classification,
        outcome,
        this.config,
        this.ollamaConfig,
        this.anthropicApiKey,
        this.openaiApiKey,
      );

      if (result.skipped || result.strategies.length === 0) return;

      for (const strategy of result.strategies) {
        const cap = strategy.classification === 'general'
          ? this.config.maxGeneralStrategies
          : this.config.maxPerClassification;

        const embedding = this.ollamaConfig
          ? await getEmbedding(
              this.ollamaConfig,
              'nomic-embed-text',
              strategy.principle + ' ' + strategy.whenToApply,
            )
          : null;

        const entry: StrategyEntry = {
          id: randomUUID().slice(0, 8),
          userId,
          name: strategy.name,
          principle: strategy.principle,
          whenToApply: strategy.whenToApply,
          classification: strategy.classification,
          embedding,
          useCount: 0,
          successCount: outcome === 'success' ? 1 : 0,
          failureCount: outcome === 'failure' ? 1 : 0,
          successRate: outcome === 'success' ? 1.0 : outcome === 'failure' ? 0.0 : 0.5,
          strength: Math.min(1.0, strategy.confidence),
          toolsInvolved: strategy.toolsInvolved,
          sourceConversationId: conversationId,
          createdAt: new Date().toISOString(),
          lastUsedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        await this.store.addEntry(userId, entry, cap);
      }

      await this.store.save(userId);
      console.log(
        `[strategy] Extracted ${result.strategies.length} strategy(ies) for ${userId}`,
      );
    } catch (err) {
      console.error('[strategy] Extraction error:', err);
    }
  }

  // ---- Context Injection (called before LLM call) ----

  async getContextInjection(
    userId: string,
    userMessage: string,
    classification: PromptClassification,
  ): Promise<string | null> {
    if (!this.config.autoInject) return null;

    const generalStrategies = await this.store.getEntries(userId, 'general');
    const classificationStrategies = await this.store.getEntries(userId, classification);

    if (generalStrategies.length === 0 && classificationStrategies.length === 0) return null;

    const results = await retrieveStrategies(
      userMessage,
      classification,
      generalStrategies,
      classificationStrategies,
      this.ollamaConfig,
      'nomic-embed-text',
    );

    if (results.length === 0) return null;

    // Build injection within token budget
    const header = '[Learned strategies]';
    let usedTokens = estimateTokens(header) + 2;
    const lines = [header];

    for (const result of results) {
      const line = `- ${result.entry.name}: ${result.entry.principle}`;
      const lineTokens = estimateTokens(line);
      if (usedTokens + lineTokens > this.config.injectionTokenBudget) break;
      lines.push(line);
      usedTokens += lineTokens;

      // Track usage
      result.entry.useCount++;
      result.entry.lastUsedAt = new Date().toISOString();
    }

    if (lines.length <= 1) return null;

    // Save usage updates (fire-and-forget)
    this.store.save(userId).catch(() => {});

    return lines.join('\n');
  }

  // ---- Outcome Tracking ----

  async recordOutcome(
    userId: string,
    injectedStrategyIds: string[],
    outcome: OutcomeSignal,
  ): Promise<void> {
    if (injectedStrategyIds.length === 0) return;

    const allEntries = await this.store.getEntries(userId);
    const injectedSet = new Set(injectedStrategyIds);

    for (const entry of allEntries) {
      if (injectedSet.has(entry.id)) {
        if (outcome === 'success') entry.successCount++;
        else if (outcome === 'failure') entry.failureCount++;
        entry.successRate = entry.successCount / Math.max(1, entry.successCount + entry.failureCount);
        entry.updatedAt = new Date().toISOString();
      }
    }

    await this.store.save(userId);
  }

  // ---- Consolidation ----

  private async runConsolidationAll(): Promise<void> {
    for (const userId of this.store.getLoadedUserIds()) {
      await this.runConsolidation(userId);
    }
  }

  async runConsolidation(userId: string): Promise<StrategyConsolidationReport> {
    const totalReport: StrategyConsolidationReport = { merged: 0, pruned: 0, duration_ms: 0 };
    const now = new Date().toISOString();

    // Consolidate general strategies
    const general = await this.store.getEntries(userId, 'general');
    if (general.length > 0) {
      const { entries, report } = consolidateStrategies(general, this.config);
      await this.store.replaceEntries(userId, entries, 'general');
      await this.store.setLastConsolidation(userId, 'general', now);
      totalReport.merged += report.merged;
      totalReport.pruned += report.pruned;
    }

    // Consolidate each classification bucket
    for (const cls of ALL_CLASSIFICATIONS) {
      const bucket = await this.store.getEntries(userId, cls);
      if (bucket.length === 0) continue;

      const { entries, report } = consolidateStrategies(bucket, this.config);
      await this.store.replaceEntries(userId, entries, cls);
      await this.store.setLastConsolidation(userId, cls, now);
      totalReport.merged += report.merged;
      totalReport.pruned += report.pruned;
    }

    await this.store.save(userId);

    if (totalReport.merged > 0 || totalReport.pruned > 0) {
      console.log(
        `[strategy] Consolidation for ${userId}: merged=${totalReport.merged} pruned=${totalReport.pruned}`,
      );
    }

    return totalReport;
  }
}
