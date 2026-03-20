// ============================================================
// OpenClaw Deploy — Cost Summary Tool
// ============================================================

import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';
import type { CostTracker } from '../../services/cost-tracker.js';

let costTrackerRef: CostTracker | null = null;

export function setCostTracker(tracker: CostTracker): void {
  costTrackerRef = tracker;
}

export const costSummaryDefinition: ToolDefinition = {
  name: 'cost_summary',
  description: 'Show API cost breakdown by model, source, and classification for a time period.',
  parameters: {
    type: 'object',
    properties: {
      period: {
        type: 'string',
        description: 'Time period to summarize',
        enum: ['today', 'week', 'month', 'all'],
      },
    },
    required: [],
  },
  routing: {
    useWhen: ['user asks about costs, spending, API usage, or token usage'],
    avoidWhen: [],
  },
};

export const costSummaryHandler: ToolHandler = async (input) => {
  if (!costTrackerRef) {
    return 'Cost tracking is not enabled.';
  }

  const period = (input.period as string) || 'month';
  if (!['today', 'week', 'month', 'all'].includes(period)) {
    return `Invalid period: ${period}. Use today, week, month, or all.`;
  }

  const summary = await costTrackerRef.getSummary(period as 'today' | 'week' | 'month' | 'all');

  const lines: string[] = [];
  lines.push(`📊 Cost Summary (${summary.period})`);
  lines.push(`Total calls: ${summary.totalCalls}`);
  lines.push(`Total cost: $${summary.totalCost.toFixed(4)}`);
  lines.push(`Input tokens: ${summary.totalInputTokens.toLocaleString()}`);
  lines.push(`Output tokens: ${summary.totalOutputTokens.toLocaleString()}`);
  lines.push(`Cache hit rate: ${summary.cacheHitRate}%`);

  if (Object.keys(summary.byModel).length > 0) {
    lines.push('\nBy Model:');
    for (const [model, data] of Object.entries(summary.byModel)) {
      lines.push(`  ${model}: ${data.calls} calls, $${data.cost.toFixed(4)}`);
    }
  }

  if (Object.keys(summary.byClassification).length > 0) {
    lines.push('\nBy Classification:');
    for (const [cls, data] of Object.entries(summary.byClassification)) {
      lines.push(`  ${cls}: ${data.calls} calls, $${data.cost.toFixed(4)}`);
    }
  }

  if (Object.keys(summary.bySource).length > 0) {
    lines.push('\nBy Source:');
    for (const [src, data] of Object.entries(summary.bySource)) {
      lines.push(`  ${src}: ${data.calls} calls, $${data.cost.toFixed(4)}`);
    }
  }

  return lines.join('\n');
};
