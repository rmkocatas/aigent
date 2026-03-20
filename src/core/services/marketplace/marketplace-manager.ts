// ============================================================
// OpenClaw Deploy — Marketplace Manager (Main Orchestrator)
// ============================================================

import type { MarketplaceConfig, MarketplaceTask, MarketplaceBounty, EarningsRecord, FeedbackEntry, WalletInfo, TaskQuote, WsTaskEvent } from './types.js';
import type { CostTracker } from '../cost-tracker.js';
import { MarketplaceClient } from './marketplace-client.js';
import { MarketplaceWsListener } from './ws-listener.js';
import { MarketplaceTaskStore } from './task-store.js';
import { PricingEngine } from './pricing-engine.js';
import type { PriceEstimate } from './pricing-engine.js';
import { SelfImprovementEngine } from './self-improvement.js';

export interface MarketplaceManagerDeps {
  config: MarketplaceConfig;
  baseDir: string;
  /** Credential vault read function */
  getCredential: (site: string) => Promise<{ password: string } | null>;
  /** Credential vault store function */
  storeCredential: (site: string, url: string, email: string, password: string, notes: string) => Promise<void>;
  /** Execute an autonomous task (via AutonomousTaskExecutor.executeGoal) */
  executeGoal: (goal: string, userId: string, chatId: string | number, channel: 'telegram' | 'webchat' | 'discord') => Promise<any>;
  /** Send notification to user (Telegram or Discord) */
  sendNotification: (message: string) => Promise<void>;
  /** Cost tracker for measuring actual API spend */
  costTracker: CostTracker;
}

export class MarketplaceManager {
  private readonly config: MarketplaceConfig;
  private readonly client: MarketplaceClient;
  private readonly store: MarketplaceTaskStore;
  private readonly pricing: PricingEngine;
  private readonly selfImprovement: SelfImprovementEngine;
  private readonly costTracker: CostTracker;
  private wsListener: MarketplaceWsListener | null = null;
  private readonly deps: MarketplaceManagerDeps;
  private wallet: WalletInfo | null = null;
  private studyTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  constructor(deps: MarketplaceManagerDeps) {
    this.deps = deps;
    this.config = deps.config;
    this.client = new MarketplaceClient();
    this.store = new MarketplaceTaskStore(deps.baseDir);
    this.pricing = new PricingEngine(deps.config);
    this.selfImprovement = new SelfImprovementEngine();
    this.costTracker = deps.costTracker;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    await this.store.init();
    await this.ensureRegistered();

    // Load feedback for self-improvement index
    const feedback = await this.store.getFeedback();
    this.selfImprovement.loadFeedback(feedback);

    // Calibrate pricing from historical earnings data
    await this.calibratePricing();

    // Start WebSocket listener (if registered)
    if (this.wallet) {
      await this.startWsListener();
    }

    // Start study session timer
    if (this.config.studyIntervalHours > 0) {
      this.studyTimer = setInterval(
        () => this.runStudySession().catch((e) => console.error('[marketplace] Study session error:', e)),
        this.config.studyIntervalHours * 60 * 60 * 1000,
      );
    }

    console.log('[marketplace] Manager started');
  }

  async stop(): Promise<void> {
    if (this.studyTimer) {
      clearInterval(this.studyTimer);
      this.studyTimer = null;
    }
    if (this.wsListener) {
      this.wsListener.stop();
      this.wsListener = null;
    }
    this.started = false;
    console.log('[marketplace] Manager stopped');
  }

  // ── Cost Calibration ───────────────────────────────────────────────

  /**
   * Load past earnings records that have apiCostUsd data and feed them
   * into the pricing engine so its per-call cost estimate stays accurate.
   */
  private async calibratePricing(): Promise<void> {
    const earnings = await this.store.getEarnings('all');
    let calibrated = 0;
    for (const e of earnings) {
      if (e.apiCostUsd > 0) {
        // Approximate API calls from duration (rough: 1 call every ~15s for autonomous)
        const approxCalls = Math.max(1, Math.round(e.durationMs / 15_000));
        this.pricing.recordActualCost(approxCalls, e.apiCostUsd);
        calibrated++;
      }
    }
    if (calibrated > 0) {
      console.log(`[marketplace] Pricing calibrated from ${calibrated} past tasks (avg $${this.pricing.getAvgCostPerCall().toFixed(4)}/call)`);
    }
  }

  // ── Registration ───────────────────────────────────────────────────

  async ensureRegistered(): Promise<WalletInfo> {
    // Check if we already have a wallet
    this.wallet = await this.store.getWallet();
    if (this.wallet) {
      // Re-set client credentials
      const cred = await this.deps.getCredential('moltlaunch-wallet');
      if (cred) {
        this.client.setCredentials(cred.password, this.wallet.agentId);
      }
      return this.wallet;
    }

    // Generate new wallet via viem
    console.log('[marketplace] Generating new wallet...');
    const { generatePrivateKey, privateKeyToAccount } = await import('viem/accounts');
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const walletAddress = account.address;

    // Store private key in credential vault (AES-256-GCM encrypted)
    await this.deps.storeCredential(
      'moltlaunch-wallet',
      'https://moltlaunch.com',
      'agent-wallet',
      privateKey,
      `MoltLaunch agent wallet. Address: ${walletAddress}. NEVER expose this key.`,
    );

    // Register with MoltLaunch API
    let agentId: string;
    try {
      const result = await this.client.register({
        privateKey,
        walletAddress,
        name: 'MoltBot',
        description: this.config.agentDescription,
        skills: this.config.advertisedSkills,
      });
      agentId = result.agentId;
    } catch (err) {
      // If registration fails (e.g., API down), save wallet locally and retry later
      agentId = `pending-${walletAddress.slice(0, 10)}`;
      console.error('[marketplace] Registration failed, will retry:', (err as Error).message);
    }

    this.wallet = {
      address: walletAddress,
      agentId,
      registeredAt: new Date().toISOString(),
      onChainMinted: false,
    };
    await this.store.saveWallet(this.wallet);
    this.client.setCredentials(privateKey, agentId);

    // Notify user about wallet
    await this.deps.sendNotification(
      `🔑 MoltLaunch wallet generated!\n\n` +
      `Address: \`${walletAddress}\`\n` +
      `Agent ID: \`${agentId}\`\n\n` +
      `⚠️ Send ~$1 of Base ETH to this address for on-chain identity mint (ERC-8004).`,
    );

    return this.wallet;
  }

  // ── WebSocket ──────────────────────────────────────────────────────

  private async startWsListener(): Promise<void> {
    if (!this.wallet) return;

    const cred = await this.deps.getCredential('moltlaunch-wallet');
    if (!cred) return;

    // Create a signature for WS auth
    const { privateKeyToAccount } = await import('viem/accounts');
    const account = privateKeyToAccount(cred.password as `0x${string}`);
    const signature = await account.signMessage({ message: `ws-auth:${this.wallet.agentId}` });

    this.wsListener = new MarketplaceWsListener({
      agentId: this.wallet.agentId,
      signature,
      reconnectMs: this.config.wsReconnectMs,
    });

    this.wsListener.setEventHandler((event) => this.handleWsEvent(event));
    this.wsListener.start();
  }

  private async handleWsEvent(event: WsTaskEvent): Promise<void> {
    console.log(`[marketplace-ws] Event: ${event.type} task=${event.taskId}`);

    switch (event.type) {
      case 'task_posted': {
        const task = event.data as unknown as MarketplaceTask;
        await this.onNewTask(task);
        break;
      }
      case 'quote_accepted': {
        await this.onQuoteAccepted(event.taskId);
        break;
      }
      case 'payment_released': {
        const amountEth = (event.data as any).amountEth ?? 0;
        await this.onPaymentReleased(event.taskId, amountEth);
        break;
      }
      case 'feedback_received': {
        const fb = event.data as unknown as FeedbackEntry;
        await this.onFeedbackReceived(fb);
        break;
      }
      case 'task_cancelled': {
        await this.store.updateTaskStatus(event.taskId, 'cancelled');
        break;
      }
    }
  }

  // ── Task Discovery & Evaluation ────────────────────────────────────

  async browseTasks(params?: { category?: string; limit?: number }): Promise<MarketplaceTask[]> {
    return this.client.browseTasks(params);
  }

  async browseBounties(params?: { category?: string; limit?: number }): Promise<MarketplaceBounty[]> {
    return this.client.browseBounties(params);
  }

  async evaluateTask(task: MarketplaceTask): Promise<{
    feasible: boolean;
    confidence: number;
    priceEstimate: PriceEstimate;
    relevantFeedback: string[];
    reasoning: string;
  }> {
    const priceEstimate = this.pricing.estimatePrice(task);

    // Check capacity
    if (this.store.getActiveCount() >= this.config.maxConcurrentTasks) {
      return {
        feasible: false,
        confidence: 1,
        priceEstimate,
        relevantFeedback: [],
        reasoning: 'At maximum concurrent task capacity.',
      };
    }

    // Reject unprofitable tasks
    if (!priceEstimate.profitable) {
      const ce = priceEstimate.costEstimate;
      return {
        feasible: false,
        confidence: 0.9,
        priceEstimate,
        relevantFeedback: [],
        reasoning: `Unprofitable: estimated cost $${ce.estimatedCostUsd.toFixed(2)} (${ce.estimatedApiCalls} API calls) exceeds what the client budget allows after ${this.config.profitMargin}× margin.`,
      };
    }

    // Search for relevant past feedback
    const pastFeedback = this.selfImprovement.searchRelevantFeedback(
      `${task.category} ${task.title} ${task.description.slice(0, 200)}`,
      3,
    );
    const relevantFeedback = pastFeedback.map(
      (f) => `[${f.rating}/5] ${f.comment}${f.lessonLearned ? ` → ${f.lessonLearned}` : ''}`,
    );

    // Check if skills match
    const hasMatchingSkill = this.config.advertisedSkills.some(
      (skill) => task.category.includes(skill) || task.tags?.some((t) => t.includes(skill)),
    );

    // Confidence based on past performance in this category
    const recommendations = this.selfImprovement.getRecommendations(task.category);
    const lowRatingHistory = recommendations.length > 3;

    const feasible = hasMatchingSkill || priceEstimate.complexityScore < 1.5;
    const confidence = hasMatchingSkill
      ? (lowRatingHistory ? 0.6 : 0.85)
      : 0.5;

    const ce = priceEstimate.costEstimate;
    const reasoning = [
      feasible ? 'Task appears feasible.' : 'Task may be outside current capabilities.',
      hasMatchingSkill ? `Matching skill: ${task.category}` : 'No direct skill match, but may still be capable.',
      `Complexity: ${priceEstimate.complexityScore.toFixed(2)}`,
      `Est. API cost: $${ce.estimatedCostUsd.toFixed(2)} (${ce.estimatedApiCalls} calls)`,
      `Floor price: ${ce.floorPriceEth.toFixed(4)} ETH (${this.config.profitMargin}× margin)`,
      `Suggested price: ${priceEstimate.suggestedPriceEth} ETH`,
      lowRatingHistory ? '⚠️ Past performance in this category has room for improvement.' : '',
    ].filter(Boolean).join(' ');

    return { feasible, confidence, priceEstimate, relevantFeedback, reasoning };
  }

  // ── Task Lifecycle ─────────────────────────────────────────────────

  async quoteTask(taskId: string, priceEth?: number): Promise<TaskQuote> {
    const task = await this.client.getTaskDetails(taskId);
    const estimate = this.pricing.estimatePrice(task);
    const price = priceEth ?? estimate.suggestedPriceEth;

    const quote: TaskQuote = {
      taskId,
      priceEth: price,
      estimatedDurationMinutes: estimate.estimatedDurationMinutes,
      approach: `MoltBot will complete this using its ${this.config.advertisedSkills.join(', ')} capabilities.`,
    };

    await this.client.quoteTask(taskId, quote);
    task.status = 'quoted';
    await this.store.upsertTask(task);

    return quote;
  }

  async acceptTask(taskId: string): Promise<void> {
    await this.client.acceptTask(taskId);
    await this.store.updateTaskStatus(taskId, 'accepted');
  }

  async executeTask(taskId: string): Promise<void> {
    const task = await this.store.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    await this.store.updateTaskStatus(taskId, 'in_progress');

    const startTime = Date.now();

    // Snapshot cost tracker BEFORE execution to measure actual API spend
    const costBefore = await this.costTracker.getSummary('today');
    const costBeforeUsd = costBefore.totalCost;

    // Get improvement recommendations
    const recommendations = this.selfImprovement.getRecommendations(task.category);
    const recText = recommendations.length > 0
      ? `\n\nLessons from past tasks in "${task.category}":\n${recommendations.map((r) => `- ${r}`).join('\n')}`
      : '';

    // Build goal for autonomous executor
    const goal = [
      `MARKETPLACE TASK (${task.id}):`,
      `Title: ${task.title}`,
      `Description: ${task.description}`,
      task.requirements?.length ? `Requirements:\n${task.requirements.map((r) => `- ${r}`).join('\n')}` : '',
      task.deliverables?.length ? `Expected deliverables:\n${task.deliverables.map((d) => `- ${d}`).join('\n')}` : '',
      '',
      'Complete this task thoroughly. Provide a detailed summary of what was accomplished.',
      recText,
    ].filter(Boolean).join('\n');

    try {
      const result = await this.deps.executeGoal(
        goal,
        `marketplace-${taskId}`,
        this.config.reportTargetId,
        this.config.reportChannel,
      );

      // Measure actual API cost
      const costAfter = await this.costTracker.getSummary('today');
      const apiCostUsd = Math.max(0, costAfter.totalCost - costBeforeUsd);
      const durationMs = Date.now() - startTime;

      // Calibrate pricing engine with real data
      const apiCalls = Math.max(1, costAfter.totalCalls - costBefore.totalCalls);
      this.pricing.recordActualCost(apiCalls, apiCostUsd);

      // Submit deliverables
      const summary = typeof result?.response === 'string' ? result.response : 'Task completed successfully.';
      await this.client.submitTask(taskId, { summary });
      await this.store.updateTaskStatus(taskId, 'submitted');

      // Store the API cost on the task for later profitability analysis
      // (actual earnings will be recorded when payment is released)
      const costRecord = { taskId, apiCostUsd, apiCalls, durationMs };
      this.taskCostCache.set(taskId, costRecord);

      const ethPrice = this.config.ethPriceUsd || 2500;
      const apiCostEth = apiCostUsd / ethPrice;
      await this.deps.sendNotification(
        `✅ Marketplace task submitted: "${task.title}"\n` +
        `Duration: ${Math.round(durationMs / 60000)}min | API cost: $${apiCostUsd.toFixed(2)} (${apiCostEth.toFixed(4)} ETH) | ${apiCalls} API calls`,
      );
    } catch (err) {
      // Still measure cost on failure
      const costAfter = await this.costTracker.getSummary('today');
      const apiCostUsd = Math.max(0, costAfter.totalCost - costBeforeUsd);

      await this.store.updateTaskStatus(taskId, 'failed');
      await this.deps.sendNotification(
        `❌ Marketplace task failed: "${task.title}"\nError: ${(err as Error).message}\nAPI cost wasted: $${apiCostUsd.toFixed(2)}`,
      );
    }
  }

  /** Temporary cache: taskId → actual API cost, until payment is released */
  private taskCostCache = new Map<string, { taskId: string; apiCostUsd: number; apiCalls: number; durationMs: number }>();

  async submitTask(taskId: string, summary: string): Promise<void> {
    await this.client.submitTask(taskId, { summary });
    await this.store.updateTaskStatus(taskId, 'submitted');
  }

  async sendMessage(taskId: string, message: string): Promise<void> {
    await this.client.sendMessage(taskId, message);
  }

  // ── Event Handlers ─────────────────────────────────────────────────

  private async onNewTask(task: MarketplaceTask): Promise<void> {
    await this.store.upsertTask(task);
    const evaluation = await this.evaluateTask(task);

    if (!evaluation.feasible) {
      console.log(`[marketplace] Skipping task ${task.id}: ${evaluation.reasoning}`);
      return;
    }

    const ce = evaluation.priceEstimate.costEstimate;

    if (this.config.automationMode === 'full_auto') {
      // Auto-quote and wait for acceptance
      await this.quoteTask(task.id);
      await this.deps.sendNotification(
        `🤖 Auto-quoted marketplace task: "${task.title}" at ${evaluation.priceEstimate.suggestedPriceEth} ETH\n` +
        `Est. cost: $${ce.estimatedCostUsd.toFixed(2)} | Margin: ${((evaluation.priceEstimate.suggestedPriceEth / ce.floorPriceEth - 1) * 100).toFixed(0)}% above floor`,
      );
    } else {
      // Supervised mode: notify user
      const needsApproval = evaluation.priceEstimate.suggestedPriceEth >= this.config.approvalThresholdEth;

      await this.deps.sendNotification(
        `📋 New marketplace task available:\n` +
        `**${task.title}**\n` +
        `Category: ${task.category} | Budget: ${task.budget}\n` +
        `Suggested price: ${evaluation.priceEstimate.suggestedPriceEth} ETH\n` +
        `Est. API cost: $${ce.estimatedCostUsd.toFixed(2)} (${ce.estimatedApiCalls} calls)\n` +
        `Floor price: ${ce.floorPriceEth.toFixed(4)} ETH | Profitable: ${evaluation.priceEstimate.profitable ? '✅' : '❌'}\n` +
        `Confidence: ${(evaluation.confidence * 100).toFixed(0)}%\n` +
        `${evaluation.reasoning}\n\n` +
        (needsApproval
          ? `⚠️ Above approval threshold. Reply "approve ${task.id}" to quote.`
          : `Auto-quoting in supervised mode...`),
      );

      if (!needsApproval) {
        await this.quoteTask(task.id);
      }
    }
  }

  private async onQuoteAccepted(taskId: string): Promise<void> {
    await this.store.updateTaskStatus(taskId, 'accepted');
    const task = await this.store.getTask(taskId);

    await this.deps.sendNotification(
      `🎉 Quote accepted for "${task?.title ?? taskId}"! Starting execution...`,
    );

    // Execute the task
    await this.executeTask(taskId);
  }

  private async onPaymentReleased(taskId: string, amountEth: number): Promise<void> {
    const task = await this.store.getTask(taskId);
    await this.store.updateTaskStatus(taskId, 'completed');

    // Retrieve actual cost from cache
    const costData = this.taskCostCache.get(taskId);
    const apiCostUsd = costData?.apiCostUsd ?? 0;
    const durationMs = costData?.durationMs ?? 0;
    this.taskCostCache.delete(taskId);

    const ethPrice = this.config.ethPriceUsd || 2500;
    const revenueUsd = amountEth * ethPrice;
    const profitUsd = revenueUsd - apiCostUsd;

    const earning: EarningsRecord = {
      taskId,
      title: task?.title ?? 'Unknown',
      amountEth,
      apiCostUsd,
      profitUsd,
      clientId: task?.clientId ?? 'unknown',
      completedAt: new Date().toISOString(),
      category: task?.category ?? 'general',
      durationMs,
    };
    await this.store.logEarning(earning);

    const profitEmoji = profitUsd >= 0 ? '📈' : '📉';
    await this.deps.sendNotification(
      `💰 Payment received: ${amountEth} ETH ($${revenueUsd.toFixed(2)}) for "${task?.title ?? taskId}"\n` +
      `API cost: $${apiCostUsd.toFixed(2)} | ${profitEmoji} Profit: $${profitUsd.toFixed(2)}`,
    );
  }

  private async onFeedbackReceived(fb: FeedbackEntry): Promise<void> {
    await this.store.logFeedback(fb);
    // Refresh the self-improvement index
    const allFeedback = await this.store.getFeedback();
    this.selfImprovement.loadFeedback(allFeedback);

    if (fb.rating < 3) {
      await this.deps.sendNotification(
        `⚠️ Low rating (${fb.rating}/5) on task ${fb.taskId}: "${fb.comment}"`,
      );
    }
  }

  // ── Self-Improvement ───────────────────────────────────────────────

  async runStudySession(): Promise<string> {
    const feedback = await this.store.getFeedback();
    this.selfImprovement.loadFeedback(feedback);
    return this.selfImprovement.generateStudySummary();
  }

  // ── Public Accessors ───────────────────────────────────────────────

  async getEarnings(period?: 'today' | 'week' | 'month' | 'all'): Promise<{
    records: EarningsRecord[];
    totalEth: number;
    totalRevenueUsd: number;
    totalCostUsd: number;
    totalProfitUsd: number;
  }> {
    const records = await this.store.getEarnings(period);
    const ethPrice = this.config.ethPriceUsd || 2500;
    const totalEth = records.reduce((sum, r) => sum + r.amountEth, 0);
    const totalCostUsd = records.reduce((sum, r) => sum + (r.apiCostUsd ?? 0), 0);
    const totalRevenueUsd = totalEth * ethPrice;
    const totalProfitUsd = totalRevenueUsd - totalCostUsd;
    return { records, totalEth, totalRevenueUsd, totalCostUsd, totalProfitUsd };
  }

  async getAgentStats(): Promise<ReturnType<MarketplaceTaskStore['getStats']>> {
    return this.store.getStats();
  }

  async getActiveTasks(): Promise<MarketplaceTask[]> {
    return this.store.getTasksByStatus('in_progress');
  }

  async getTaskStatus(taskId: string): Promise<MarketplaceTask | undefined> {
    return this.store.getTask(taskId);
  }

  getWallet(): WalletInfo | null {
    return this.wallet;
  }

  isWsConnected(): boolean {
    return this.wsListener?.isConnected() ?? false;
  }

  getConfig(): MarketplaceConfig {
    return this.config;
  }

  async getAllTasks(): Promise<MarketplaceTask[]> {
    return this.store.getAllTasks();
  }

  async getFeedback(): Promise<FeedbackEntry[]> {
    return this.store.getFeedback();
  }

  /** Handle approval command from user (supervised mode) */
  async approveTask(taskId: string): Promise<string> {
    const task = await this.store.getTask(taskId);
    if (!task) return `Task ${taskId} not found.`;
    if (task.status !== 'open') return `Task ${taskId} is ${task.status}, not open.`;

    const quote = await this.quoteTask(taskId);
    return `Quoted ${quote.priceEth} ETH for "${task.title}". Waiting for client acceptance.`;
  }

  /** Get pricing engine diagnostics */
  getPricingDiagnostics(): {
    avgCostPerCall: number;
    calibrationDataPoints: number;
    profitMargin: number;
    ethPriceUsd: number;
  } {
    return {
      avgCostPerCall: this.pricing.getAvgCostPerCall(),
      calibrationDataPoints: this.pricing.getCalibrationCount(),
      profitMargin: this.config.profitMargin,
      ethPriceUsd: this.config.ethPriceUsd,
    };
  }
}
