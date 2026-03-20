// ============================================================
// OpenClaw Deploy — Autonomous Resource Budget Manager
// ============================================================

import type { ResourceBudget } from './types.js';

export class BudgetManager {
  constructor(private budget: ResourceBudget) {}

  recordTokens(count: number): void {
    this.budget.tokensUsed += count;
  }

  recordApiCall(): void {
    this.budget.apiCallsUsed++;
  }

  recordToolCall(): void {
    this.budget.toolCallsUsed++;
  }

  isExceeded(): { exceeded: boolean; reason?: string } {
    if (this.budget.tokensUsed >= this.budget.maxTokens) {
      return {
        exceeded: true,
        reason: `Token budget exceeded (${this.budget.tokensUsed}/${this.budget.maxTokens})`,
      };
    }
    if (this.budget.apiCallsUsed >= this.budget.maxApiCalls) {
      return {
        exceeded: true,
        reason: `API call budget exceeded (${this.budget.apiCallsUsed}/${this.budget.maxApiCalls})`,
      };
    }
    if (this.budget.toolCallsUsed >= this.budget.maxToolCalls) {
      return {
        exceeded: true,
        reason: `Tool call budget exceeded (${this.budget.toolCallsUsed}/${this.budget.maxToolCalls})`,
      };
    }
    const elapsed = Date.now() - this.budget.startedAt;
    if (elapsed >= this.budget.maxDurationMs) {
      return {
        exceeded: true,
        reason: `Time budget exceeded (${Math.round(elapsed / 1000)}s/${Math.round(this.budget.maxDurationMs / 1000)}s)`,
      };
    }
    return { exceeded: false };
  }

  isWarningThreshold(): { warning: boolean; metric?: string; pct?: number } {
    const checks = [
      { metric: 'tokens', used: this.budget.tokensUsed, max: this.budget.maxTokens },
      { metric: 'apiCalls', used: this.budget.apiCallsUsed, max: this.budget.maxApiCalls },
      { metric: 'toolCalls', used: this.budget.toolCallsUsed, max: this.budget.maxToolCalls },
      { metric: 'duration', used: Date.now() - this.budget.startedAt, max: this.budget.maxDurationMs },
    ];
    for (const check of checks) {
      const pct = (check.used / check.max) * 100;
      if (pct >= 80 && pct < 100) {
        return { warning: true, metric: check.metric, pct: Math.round(pct) };
      }
    }
    return { warning: false };
  }

  getSnapshot(): ResourceBudget {
    return { ...this.budget };
  }
}
