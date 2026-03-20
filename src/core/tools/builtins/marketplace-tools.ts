// ============================================================
// OpenClaw Deploy — Marketplace Tools (MoltLaunch Integration)
// ============================================================

import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';
import type { MarketplaceManager } from '../../services/marketplace/marketplace-manager.js';

// ---------------------------------------------------------------------------
// Singleton injection
// ---------------------------------------------------------------------------

let marketplaceManager: MarketplaceManager | null = null;

export function setMarketplaceManager(mgr: MarketplaceManager): void {
  marketplaceManager = mgr;
}

function ensureManager(): MarketplaceManager {
  if (!marketplaceManager) throw new Error('Marketplace not configured. Enable marketplace in openclaw.json');
  return marketplaceManager;
}

// ---------------------------------------------------------------------------
// Tool: marketplace_browse_tasks
// ---------------------------------------------------------------------------

export const marketplaceBrowseTasksDefinition: ToolDefinition = {
  name: 'marketplace_browse_tasks',
  description: 'Browse available tasks on the MoltLaunch marketplace. Returns open tasks that MoltBot can bid on.',
  parameters: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description: 'Filter by category (e.g., "research", "coding", "writing", "data-analysis")',
      },
      limit: {
        type: 'string',
        description: 'Maximum number of tasks to return (default: 10)',
      },
    },
  },
  routing: {
    useWhen: ['User wants to see available marketplace tasks or find work'],
    avoidWhen: ['User is asking about their own tasks, not marketplace'],
  },
};

export const marketplaceBrowseTasksHandler: ToolHandler = async (input) => {
  const mgr = ensureManager();
  const category = input.category ? String(input.category) : undefined;
  const limit = input.limit ? parseInt(String(input.limit), 10) : 10;

  try {
    const tasks = await mgr.browseTasks({ category, limit });

    if (tasks.length === 0) {
      return 'No open tasks found' + (category ? ` in category "${category}"` : '') + '.';
    }

    const lines = tasks.map((t) =>
      `• **${t.title}** (ID: ${t.id})\n  Category: ${t.category} | Budget: ${t.budget} | Posted: ${t.createdAt.slice(0, 10)}\n  ${t.description.slice(0, 150)}${t.description.length > 150 ? '...' : ''}`,
    );

    return `Found ${tasks.length} open task(s):\n\n${lines.join('\n\n')}`;
  } catch (err) {
    return `Error browsing tasks: ${(err as Error).message}`;
  }
};

// ---------------------------------------------------------------------------
// Tool: marketplace_browse_bounties
// ---------------------------------------------------------------------------

export const marketplaceBrowseBountiesDefinition: ToolDefinition = {
  name: 'marketplace_browse_bounties',
  description: 'Browse open bounties on the MoltLaunch marketplace. Bounties have fixed rewards.',
  parameters: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description: 'Filter by category',
      },
      limit: {
        type: 'string',
        description: 'Maximum number of bounties to return (default: 10)',
      },
    },
  },
  routing: {
    useWhen: ['User wants to see marketplace bounties'],
  },
};

export const marketplaceBrowseBountiesHandler: ToolHandler = async (input) => {
  const mgr = ensureManager();
  const category = input.category ? String(input.category) : undefined;
  const limit = input.limit ? parseInt(String(input.limit), 10) : 10;

  try {
    const bounties = await mgr.browseBounties({ category, limit });

    if (bounties.length === 0) {
      return 'No open bounties found.';
    }

    const lines = bounties.map((b) =>
      `• **${b.title}** (ID: ${b.id})\n  Category: ${b.category} | Reward: ${b.rewardEth} ETH | Deadline: ${b.deadline ?? 'None'}\n  ${b.description.slice(0, 150)}${b.description.length > 150 ? '...' : ''}`,
    );

    return `Found ${bounties.length} open bounty/bounties:\n\n${lines.join('\n\n')}`;
  } catch (err) {
    return `Error browsing bounties: ${(err as Error).message}`;
  }
};

// ---------------------------------------------------------------------------
// Tool: marketplace_evaluate_task
// ---------------------------------------------------------------------------

export const marketplaceEvaluateTaskDefinition: ToolDefinition = {
  name: 'marketplace_evaluate_task',
  description: 'Evaluate a marketplace task for feasibility and estimate a price. Analyzes complexity, required skills, and past performance.',
  parameters: {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: 'Task ID to evaluate',
      },
      title: {
        type: 'string',
        description: 'Task title (for direct evaluation without fetching)',
      },
      description: {
        type: 'string',
        description: 'Task description (for direct evaluation)',
      },
      category: {
        type: 'string',
        description: 'Task category',
      },
      budget_eth: {
        type: 'string',
        description: 'Client budget in ETH',
      },
    },
    required: ['title', 'description'],
  },
  routing: {
    useWhen: ['User wants to know if a task is doable and how much to charge'],
  },
};

export const marketplaceEvaluateTaskHandler: ToolHandler = async (input) => {
  const mgr = ensureManager();

  const task = {
    id: String(input.task_id || 'eval'),
    title: String(input.title),
    description: String(input.description),
    category: String(input.category || 'general'),
    budget: input.budget_eth ? `${input.budget_eth} ETH` : 'Not specified',
    budgetEth: input.budget_eth ? parseFloat(String(input.budget_eth)) : 0,
    clientId: '',
    status: 'open' as const,
    createdAt: new Date().toISOString(),
    requirements: [],
    tags: [],
  };

  const evaluation = await mgr.evaluateTask(task);

  const ce = evaluation.priceEstimate.costEstimate;
  const lines = [
    `**Task Evaluation: "${task.title}"**`,
    '',
    `Feasible: ${evaluation.feasible ? '✅ Yes' : '❌ No'}`,
    `Profitable: ${evaluation.priceEstimate.profitable ? '✅ Yes' : '❌ No'}`,
    `Confidence: ${(evaluation.confidence * 100).toFixed(0)}%`,
    `Complexity: ${evaluation.priceEstimate.complexityScore.toFixed(2)}`,
    '',
    `**Cost Analysis:**`,
    `  Est. API calls: ${ce.estimatedApiCalls}`,
    `  Est. API cost: $${ce.estimatedCostUsd.toFixed(2)} (${ce.estimatedCostEth.toFixed(4)} ETH)`,
    `  Floor price (${mgr.getConfig().profitMargin}× margin): ${ce.floorPriceEth.toFixed(4)} ETH`,
    `  Suggested price: ${evaluation.priceEstimate.suggestedPriceEth} ETH`,
    `  Est. Duration: ~${evaluation.priceEstimate.estimatedDurationMinutes} minutes`,
    '',
    `Reasoning: ${evaluation.reasoning}`,
  ];

  if (evaluation.relevantFeedback.length > 0) {
    lines.push('', '**Relevant Past Feedback:**');
    for (const fb of evaluation.relevantFeedback) {
      lines.push(`  ${fb}`);
    }
  }

  return lines.join('\n');
};

// ---------------------------------------------------------------------------
// Tool: marketplace_quote_task
// ---------------------------------------------------------------------------

export const marketplaceQuoteTaskDefinition: ToolDefinition = {
  name: 'marketplace_quote_task',
  description: 'Submit a price quote for a marketplace task. Uses the pricing engine or a manual price.',
  parameters: {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: 'Task ID to quote',
      },
      price_eth: {
        type: 'string',
        description: 'Manual price in ETH (optional — auto-calculated if omitted)',
      },
    },
    required: ['task_id'],
  },
  routing: {
    useWhen: ['User wants to bid on or quote a marketplace task'],
  },
};

export const marketplaceQuoteTaskHandler: ToolHandler = async (input) => {
  const mgr = ensureManager();
  const taskId = String(input.task_id);
  const priceEth = input.price_eth ? parseFloat(String(input.price_eth)) : undefined;

  try {
    const quote = await mgr.quoteTask(taskId, priceEth);
    return `Quote submitted for task ${taskId}:\n  Price: ${quote.priceEth} ETH\n  Est. Duration: ~${quote.estimatedDurationMinutes} minutes\n  Waiting for client acceptance...`;
  } catch (err) {
    return `Error quoting task: ${(err as Error).message}`;
  }
};

// ---------------------------------------------------------------------------
// Tool: marketplace_accept_task
// ---------------------------------------------------------------------------

export const marketplaceAcceptTaskDefinition: ToolDefinition = {
  name: 'marketplace_accept_task',
  description: 'Accept a marketplace task and begin execution. The task will be run through the autonomous executor.',
  parameters: {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: 'Task ID to accept and execute',
      },
    },
    required: ['task_id'],
  },
  routing: {
    useWhen: ['User approves starting a marketplace task'],
  },
};

export const marketplaceAcceptTaskHandler: ToolHandler = async (input) => {
  const mgr = ensureManager();
  const taskId = String(input.task_id);

  try {
    await mgr.acceptTask(taskId);
    // Start execution asynchronously
    mgr.executeTask(taskId).catch((err) => {
      console.error(`[marketplace] Task ${taskId} execution error:`, err);
    });
    return `Task ${taskId} accepted! Execution starting in the background. Use marketplace_task_status to track progress.`;
  } catch (err) {
    return `Error accepting task: ${(err as Error).message}`;
  }
};

// ---------------------------------------------------------------------------
// Tool: marketplace_submit_task
// ---------------------------------------------------------------------------

export const marketplaceSubmitTaskDefinition: ToolDefinition = {
  name: 'marketplace_submit_task',
  description: 'Submit deliverables for a completed marketplace task.',
  parameters: {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: 'Task ID to submit',
      },
      summary: {
        type: 'string',
        description: 'Summary of completed work and deliverables',
      },
    },
    required: ['task_id', 'summary'],
  },
  routing: {
    useWhen: ['User wants to submit work for a marketplace task'],
  },
};

export const marketplaceSubmitTaskHandler: ToolHandler = async (input) => {
  const mgr = ensureManager();
  const taskId = String(input.task_id);
  const summary = String(input.summary);

  try {
    await mgr.submitTask(taskId, summary);
    return `Deliverables submitted for task ${taskId}. Waiting for client approval (or 24h auto-release).`;
  } catch (err) {
    return `Error submitting task: ${(err as Error).message}`;
  }
};

// ---------------------------------------------------------------------------
// Tool: marketplace_task_status
// ---------------------------------------------------------------------------

export const marketplaceTaskStatusDefinition: ToolDefinition = {
  name: 'marketplace_task_status',
  description: 'Check the status of active or completed marketplace tasks.',
  parameters: {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: 'Specific task ID to check (optional — shows all active if omitted)',
      },
    },
  },
  routing: {
    useWhen: ['User asks about marketplace task progress or status'],
  },
};

export const marketplaceTaskStatusHandler: ToolHandler = async (input) => {
  const mgr = ensureManager();

  if (input.task_id) {
    const task = await mgr.getTaskStatus(String(input.task_id));
    if (!task) return `Task ${input.task_id} not found.`;
    return `Task ${task.id}: "${task.title}"\n  Status: ${task.status}\n  Category: ${task.category}\n  Budget: ${task.budget}\n  Created: ${task.createdAt}`;
  }

  const tasks = await mgr.getAllTasks();
  if (tasks.length === 0) return 'No marketplace tasks tracked yet.';

  const active = tasks.filter((t) => !['completed', 'cancelled', 'failed'].includes(t.status));
  const completed = tasks.filter((t) => t.status === 'completed');
  const failed = tasks.filter((t) => t.status === 'failed');

  const lines: string[] = [];
  if (active.length > 0) {
    lines.push(`**Active (${active.length}):**`);
    for (const t of active) {
      lines.push(`  • ${t.title} (${t.id}) — ${t.status}`);
    }
  }
  if (completed.length > 0) {
    lines.push(`**Completed (${completed.length}):**`);
    for (const t of completed.slice(-5)) {
      lines.push(`  • ${t.title} (${t.id})`);
    }
  }
  if (failed.length > 0) {
    lines.push(`**Failed (${failed.length}):**`);
    for (const t of failed.slice(-3)) {
      lines.push(`  • ${t.title} (${t.id})`);
    }
  }

  return lines.join('\n');
};

// ---------------------------------------------------------------------------
// Tool: marketplace_send_message
// ---------------------------------------------------------------------------

export const marketplaceSendMessageDefinition: ToolDefinition = {
  name: 'marketplace_send_message',
  description: 'Send a message to the client of a marketplace task. Use for questions, clarifications, or updates.',
  parameters: {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: 'Task ID',
      },
      message: {
        type: 'string',
        description: 'Message to send to the client',
      },
    },
    required: ['task_id', 'message'],
  },
  routing: {
    useWhen: ['User wants to communicate with a marketplace task client'],
  },
};

export const marketplaceSendMessageHandler: ToolHandler = async (input) => {
  const mgr = ensureManager();
  try {
    await mgr.sendMessage(String(input.task_id), String(input.message));
    return `Message sent to client for task ${input.task_id}.`;
  } catch (err) {
    return `Error sending message: ${(err as Error).message}`;
  }
};

// ---------------------------------------------------------------------------
// Tool: marketplace_earnings
// ---------------------------------------------------------------------------

export const marketplaceEarningsDefinition: ToolDefinition = {
  name: 'marketplace_earnings',
  description: 'View MoltBot marketplace earnings. Shows ETH earned from completed tasks.',
  parameters: {
    type: 'object',
    properties: {
      period: {
        type: 'string',
        description: 'Time period: "today", "week", "month", or "all" (default: "all")',
        enum: ['today', 'week', 'month', 'all'],
      },
    },
  },
  routing: {
    useWhen: ['User asks about marketplace earnings, income, or revenue'],
  },
};

export const marketplaceEarningsHandler: ToolHandler = async (input) => {
  const mgr = ensureManager();
  const period = (input.period as 'today' | 'week' | 'month' | 'all') || 'all';

  const { records, totalEth, totalRevenueUsd, totalCostUsd, totalProfitUsd } = await mgr.getEarnings(period);

  if (records.length === 0) {
    return `No earnings recorded for period: ${period}.`;
  }

  const profitEmoji = totalProfitUsd >= 0 ? '📈' : '📉';

  const lines = [
    `**Marketplace Earnings (${period})**`,
    `Revenue: ${totalEth.toFixed(4)} ETH ($${totalRevenueUsd.toFixed(2)})`,
    `API Cost: $${totalCostUsd.toFixed(2)}`,
    `${profitEmoji} Net Profit: $${totalProfitUsd.toFixed(2)}`,
    `Tasks: ${records.length}`,
    '',
  ];

  for (const r of records.slice(-10)) {
    const profit = r.profitUsd ?? 0;
    const pSign = profit >= 0 ? '+' : '';
    lines.push(`  • ${r.title} — ${r.amountEth.toFixed(4)} ETH | cost $${(r.apiCostUsd ?? 0).toFixed(2)} | ${pSign}$${profit.toFixed(2)} (${r.completedAt.slice(0, 10)})`);
  }

  if (records.length > 10) {
    lines.push(`  ... and ${records.length - 10} more`);
  }

  const wallet = mgr.getWallet();
  if (wallet) {
    lines.push('', `Wallet: ${wallet.address}`);
  }

  return lines.join('\n');
};

// ---------------------------------------------------------------------------
// Tool: marketplace_agent_stats
// ---------------------------------------------------------------------------

export const marketplaceAgentStatsDefinition: ToolDefinition = {
  name: 'marketplace_agent_stats',
  description: 'View MoltBot agent statistics on the marketplace — rating, completion rate, total earnings.',
  parameters: {
    type: 'object',
    properties: {},
  },
  routing: {
    useWhen: ['User asks about marketplace performance, rating, or stats'],
  },
};

export const marketplaceAgentStatsHandler: ToolHandler = async () => {
  const mgr = ensureManager();
  const stats = await mgr.getAgentStats();
  const wallet = mgr.getWallet();
  const diag = mgr.getPricingDiagnostics();

  const lines = [
    '**MoltBot Marketplace Stats**',
    '',
    `Total Earnings: ${stats.totalEarningsEth.toFixed(4)} ETH`,
    `Tasks Completed: ${stats.tasksCompleted}`,
    `Tasks Failed: ${stats.tasksFailed}`,
    `Completion Rate: ${(stats.completionRate * 100).toFixed(1)}%`,
    `Average Rating: ${stats.averageRating > 0 ? `${stats.averageRating.toFixed(2)}/5` : 'No ratings yet'}`,
    '',
    '**Pricing Engine:**',
    `  Avg cost/API call: $${diag.avgCostPerCall.toFixed(4)}`,
    `  Calibration data: ${diag.calibrationDataPoints} past tasks`,
    `  Profit margin: ${diag.profitMargin}× (min price = ${diag.profitMargin}× estimated cost)`,
    `  ETH price: $${diag.ethPriceUsd}`,
    '',
    `Wallet: ${wallet?.address ?? 'Not registered'}`,
    `Agent ID: ${wallet?.agentId ?? 'N/A'}`,
    `On-chain: ${wallet?.onChainMinted ? '✅ Minted' : '⏳ Pending'}`,
    `WebSocket: ${mgr.isWsConnected() ? '🟢 Connected' : '🔴 Disconnected'}`,
  ];

  return lines.join('\n');
};
