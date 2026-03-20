// ============================================================
// OpenClaw Deploy — Marketplace Pricing Engine (Cost-Aware)
// ============================================================
//
// Estimates API cost for a task, then sets a floor price that
// guarantees profitability. The final price is:
//   max(basePriceEth, estimatedCostEth × profitMargin, heuristicPrice)

import type { MarketplaceConfig, MarketplaceTask } from './types.js';

const CATEGORY_MULTIPLIERS: Record<string, number> = {
  coding: 2.0,
  'data-analysis': 1.8,
  'web-scraping': 1.5,
  research: 1.0,
  writing: 0.8,
  'pdf-reports': 1.2,
  translation: 0.9,
  summarization: 0.7,
  general: 1.0,
};

const COMPLEXITY_KEYWORDS: Record<string, number> = {
  // High complexity
  'full-stack': 0.4,
  'machine learning': 0.4,
  'smart contract': 0.5,
  'api integration': 0.3,
  'database': 0.3,
  'deployment': 0.3,
  'multi-step': 0.2,
  'scrape': 0.2,
  'automate': 0.2,
  'analyze': 0.15,
  'compare': 0.1,
  // Low complexity
  'summary': -0.2,
  'list': -0.2,
  'simple': -0.3,
  'quick': -0.2,
};

// ── API cost estimation model ────────────────────────────────────────
//
// Based on real-world autonomous task execution patterns:
//   - Each LLM call averages ~4000 input + ~1500 output tokens
//   - Opus (complex tasks): ~$0.035/call
//   - Sonnet (medium tasks): ~$0.02/call
//   - Planning call: 1× Opus
//   - Per-subtask: 2-4 LLM calls average
//
// Estimated calls = planningCalls + (estimatedSubtasks × callsPerSubtask)

interface CostEstimate {
  estimatedApiCalls: number;
  estimatedCostUsd: number;
  estimatedCostEth: number;
  floorPriceEth: number;
}

/**
 * Estimate how many LLM calls a task will require based on complexity.
 */
function estimateApiCalls(complexityScore: number, categoryMul: number): number {
  // Planning: 1-2 calls
  const planningCalls = complexityScore > 1.2 ? 2 : 1;
  // Subtask count scales with complexity
  const estimatedSubtasks = Math.ceil(complexityScore * 2 * categoryMul);
  // Each subtask: 2-4 LLM calls (more for coding/complex categories)
  const callsPerSubtask = categoryMul > 1.5 ? 4 : categoryMul > 1.0 ? 3 : 2;

  return planningCalls + estimatedSubtasks * callsPerSubtask;
}

/**
 * Average cost per LLM call in USD.
 * Uses a blended rate: most autonomous work goes through Opus/Sonnet.
 */
const AVG_COST_PER_CALL_USD = 0.03; // Blended Opus+Sonnet average

export interface PriceEstimate {
  suggestedPriceEth: number;
  estimatedDurationMinutes: number;
  complexityScore: number;
  costEstimate: CostEstimate;
  profitable: boolean;
}

export class PricingEngine {
  private readonly config: MarketplaceConfig;
  /** Running average cost per API call, updated from actual task data */
  private avgCostPerCall: number = AVG_COST_PER_CALL_USD;
  /** History of actual costs for calibration: { calls, costUsd }[] */
  private costHistory: Array<{ calls: number; costUsd: number }> = [];

  constructor(config: MarketplaceConfig) {
    this.config = config;
  }

  /**
   * Feed actual task execution data to calibrate cost estimates.
   * Call this after each completed task with the real API cost.
   */
  recordActualCost(apiCalls: number, costUsd: number): void {
    if (apiCalls <= 0 || costUsd <= 0) return;
    this.costHistory.push({ calls: apiCalls, costUsd });
    // Keep last 50 data points
    if (this.costHistory.length > 50) this.costHistory.shift();
    // Recalculate average
    const totalCalls = this.costHistory.reduce((s, h) => s + h.calls, 0);
    const totalCost = this.costHistory.reduce((s, h) => s + h.costUsd, 0);
    if (totalCalls > 0) {
      this.avgCostPerCall = totalCost / totalCalls;
    }
  }

  estimatePrice(task: MarketplaceTask): PriceEstimate {
    const categoryMul = CATEGORY_MULTIPLIERS[task.category] ?? 1.0;

    // Compute complexity score from description keywords
    const descLower = (task.description + ' ' + task.title).toLowerCase();
    let complexityBonus = 0;
    for (const [keyword, weight] of Object.entries(COMPLEXITY_KEYWORDS)) {
      if (descLower.includes(keyword)) complexityBonus += weight;
    }

    // Requirements count adds complexity
    const reqCount = task.requirements?.length ?? 0;
    complexityBonus += reqCount * 0.05;

    // Description length proxy for complexity
    if (task.description.length > 1000) complexityBonus += 0.2;
    if (task.description.length > 2000) complexityBonus += 0.2;

    const complexityScore = Math.max(0.1, Math.min(2.0, 1.0 + complexityBonus));

    // ── Cost estimation ──────────────────────────────────────────────
    const estimatedApiCalls = estimateApiCalls(complexityScore, categoryMul);
    const estimatedCostUsd = estimatedApiCalls * this.avgCostPerCall;
    const ethPrice = this.config.ethPriceUsd || 2500; // Fallback if not set
    const estimatedCostEth = estimatedCostUsd / ethPrice;
    // Floor price = cost × profit margin
    const floorPriceEth = estimatedCostEth * this.config.profitMargin;

    const costEstimate: CostEstimate = {
      estimatedApiCalls,
      estimatedCostUsd,
      estimatedCostEth,
      floorPriceEth,
    };

    // ── Heuristic price (original method) ────────────────────────────
    let heuristicPrice = this.config.basePriceEth * categoryMul * complexityScore;

    // ── Final price: max of all floors ───────────────────────────────
    let price = Math.max(this.config.basePriceEth, floorPriceEth, heuristicPrice);
    price = Math.min(price, this.config.maxPriceEth);

    // Don't bid more than the client's budget (but flag if unprofitable)
    let profitable = true;
    if (task.budgetEth > 0) {
      if (task.budgetEth < floorPriceEth) {
        // Client budget can't cover our costs — still quote at budget but flag unprofitable
        profitable = false;
      }
      price = Math.min(price, task.budgetEth * 0.95); // 5% undercut
    }

    // If the clamped price is below cost floor, it's unprofitable
    if (price < floorPriceEth) {
      profitable = false;
    }

    // Round to 4 decimal places
    price = Math.round(price * 10000) / 10000;

    // Estimate duration: 5 min base + complexity scaling
    const estimatedDurationMinutes = Math.round(5 + complexityScore * 10 * categoryMul);

    return {
      suggestedPriceEth: price,
      estimatedDurationMinutes,
      complexityScore,
      costEstimate,
      profitable,
    };
  }

  /** Get the current calibrated cost-per-call for diagnostics. */
  getAvgCostPerCall(): number {
    return this.avgCostPerCall;
  }

  /** Get the number of calibration data points. */
  getCalibrationCount(): number {
    return this.costHistory.length;
  }
}
