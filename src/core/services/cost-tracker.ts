// ============================================================
// OpenClaw Deploy — API Cost Tracker
// ============================================================
//
// Logs every API call with token counts and estimated cost.
// Stores in JSONL files: logs/costs/{yyyy-mm}.jsonl
// ============================================================

import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface ApiCallLog {
  timestamp: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  estimatedCost: number;
  classification: string;
  source: 'chat' | 'autonomous' | 'extraction' | 'compaction';
}

interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
}

const PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-6':             { inputPerMTok: 5.00,  outputPerMTok: 25.00, cacheReadPerMTok: 0.50 },
  'claude-sonnet-4-5-20250929':  { inputPerMTok: 3.00,  outputPerMTok: 15.00, cacheReadPerMTok: 0.30 },
  'claude-haiku-4-5-20251001':   { inputPerMTok: 1.00,  outputPerMTok: 5.00,  cacheReadPerMTok: 0.10 },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number, cachedTokens: number): number {
  const pricing = PRICING[model];
  if (!pricing) return 0; // Ollama = free
  const uncachedInput = Math.max(0, inputTokens - cachedTokens);
  return (
    (uncachedInput / 1_000_000) * pricing.inputPerMTok +
    (cachedTokens / 1_000_000) * pricing.cacheReadPerMTok +
    (outputTokens / 1_000_000) * pricing.outputPerMTok
  );
}

export class CostTracker {
  private logsDir: string;
  private buffer: ApiCallLog[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(baseDir: string) {
    this.logsDir = path.join(baseDir, 'logs', 'costs');
  }

  async logCall(
    provider: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
    cachedInputTokens: number,
    classification: string,
    source: 'chat' | 'autonomous' | 'extraction' | 'compaction' = 'chat',
  ): Promise<void> {
    // Clamp negative token values to zero — some providers occasionally report negative counts
    const clampedInput = Math.max(0, inputTokens);
    const clampedOutput = Math.max(0, outputTokens);
    const clampedCached = Math.max(0, cachedInputTokens);

    const entry: ApiCallLog = {
      timestamp: new Date().toISOString(),
      provider,
      model,
      inputTokens: clampedInput,
      outputTokens: clampedOutput,
      cachedInputTokens: clampedCached,
      estimatedCost: estimateCost(model, clampedInput, clampedOutput, clampedCached),
      classification,
      source,
    };

    this.buffer.push(entry);

    // Debounced flush — write every 5 seconds to avoid excessive I/O
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), 5_000);
    }
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.buffer.length === 0) return;

    const entries = this.buffer.splice(0);
    const now = new Date();
    const filename = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}.jsonl`;
    const filepath = path.join(this.logsDir, filename);

    try {
      await fs.mkdir(this.logsDir, { recursive: true });
      const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
      await fs.appendFile(filepath, lines, 'utf-8');
    } catch (err) {
      console.error('[cost-tracker] Failed to write cost log:', err);
      // Re-buffer on failure so data isn't lost
      this.buffer.unshift(...entries);
    }
  }

  /**
   * Get cost summary for a time range.
   */
  async getSummary(
    period: 'today' | 'week' | 'month' | 'all' = 'month',
  ): Promise<CostSummary> {
    const now = new Date();
    let cutoff: Date;

    switch (period) {
      case 'today':
        cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        cutoff = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'all':
        cutoff = new Date(0);
        break;
    }

    // Flush pending entries first
    await this.flush();

    const entries = await this.readEntries(cutoff);
    return this.computeSummary(entries, period);
  }

  private async readEntries(since: Date): Promise<ApiCallLog[]> {
    const entries: ApiCallLog[] = [];

    try {
      const files = await fs.readdir(this.logsDir);
      const jsonlFiles = files.filter((f) => f.endsWith('.jsonl')).sort();

      for (const file of jsonlFiles) {
        const content = await fs.readFile(path.join(this.logsDir, file), 'utf-8');
        for (const line of content.split('\n')) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line) as ApiCallLog;
            if (new Date(entry.timestamp) >= since) {
              entries.push(entry);
            }
          } catch {
            // Skip malformed lines
          }
        }
      }
    } catch {
      // No logs directory yet
    }

    return entries;
  }

  private computeSummary(entries: ApiCallLog[], period: string): CostSummary {
    const byModel: Record<string, { calls: number; inputTokens: number; outputTokens: number; cost: number }> = {};
    const bySource: Record<string, { calls: number; cost: number }> = {};
    const byClassification: Record<string, { calls: number; cost: number }> = {};

    let totalCost = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCachedTokens = 0;

    for (const e of entries) {
      totalCost += e.estimatedCost;
      totalInputTokens += e.inputTokens;
      totalOutputTokens += e.outputTokens;
      totalCachedTokens += e.cachedInputTokens;

      const modelKey = e.provider === 'ollama' ? `ollama/${e.model}` : e.model;
      if (!byModel[modelKey]) byModel[modelKey] = { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
      byModel[modelKey].calls++;
      byModel[modelKey].inputTokens += e.inputTokens;
      byModel[modelKey].outputTokens += e.outputTokens;
      byModel[modelKey].cost += e.estimatedCost;

      if (!bySource[e.source]) bySource[e.source] = { calls: 0, cost: 0 };
      bySource[e.source].calls++;
      bySource[e.source].cost += e.estimatedCost;

      if (!byClassification[e.classification]) byClassification[e.classification] = { calls: 0, cost: 0 };
      byClassification[e.classification].calls++;
      byClassification[e.classification].cost += e.estimatedCost;
    }

    return {
      period,
      totalCalls: entries.length,
      totalCost: Math.round(totalCost * 10000) / 10000,
      totalInputTokens,
      totalOutputTokens,
      totalCachedTokens,
      cacheHitRate: totalInputTokens > 0
        ? Math.round((totalCachedTokens / totalInputTokens) * 100)
        : 0,
      byModel,
      bySource,
      byClassification,
    };
  }
}

export interface CostSummary {
  period: string;
  totalCalls: number;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  cacheHitRate: number;
  byModel: Record<string, { calls: number; inputTokens: number; outputTokens: number; cost: number }>;
  bySource: Record<string, { calls: number; cost: number }>;
  byClassification: Record<string, { calls: number; cost: number }>;
}
