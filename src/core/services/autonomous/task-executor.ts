// ============================================================
// OpenClaw Deploy — Autonomous Task Executor
// ============================================================

import { randomUUID } from 'node:crypto';
import type {
  AutonomousTask,
  Subtask,
  AutonomousConfig,
  ResourceBudget,
} from './types.js';
import type { ChatPipelineDeps } from '../../gateway/chat-pipeline.js';
import type { ApprovalManager } from '../approval-manager.js';
import { processChatMessage } from '../../gateway/chat-pipeline.js';
import { BudgetManager } from './budget-manager.js';
import { AuditLogger } from './audit-logger.js';
import { AutonomousTaskStore } from './task-store.js';
import { planTask } from './task-planner.js';
import { shouldRequireApproval, classifyToolSafety } from './safety-classifier.js';
import {
  DEFAULT_HAIKU_MODEL,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_OPUS_MODEL,
} from '../../gateway/provider-router.js';
import type { SharedAgentState } from '../mcp/shared-state.js';
import type { AgentRegistry } from '../agents/agent-registry.js';

const MAX_CONSECUTIVE_FAILURES = 3;

export interface TaskExecutorDeps {
  chatPipelineDeps: ChatPipelineDeps;
  approvalManager: ApprovalManager;
  taskStore: AutonomousTaskStore;
  auditLogger: AuditLogger;
  config: AutonomousConfig;
  sendProgress: (chatId: number | string, message: string, channel?: 'telegram' | 'discord' | 'webchat') => Promise<void>;
  /** Optional: post a completion report to a dedicated channel (e.g. Discord #reports) */
  sendReport?: (report: string) => Promise<void>;
  sendFile?: (chatId: number | string, file: { data: Buffer; filename: string; mimeType: string; caption?: string }) => Promise<void>;
  sharedState?: SharedAgentState;
  agentRegistry?: AgentRegistry;
}

export class AutonomousTaskExecutor {
  private activeTasks = new Map<string, AutonomousTask>();
  private killAll = false;
  private killedTasks = new Set<string>();
  private progressIntervals = new Map<string, ReturnType<typeof setInterval>>();

  constructor(private readonly deps: TaskExecutorDeps) {}

  // ── Kill Switch ──────────────────────────────────────────────

  killSwitch(): string[] {
    this.killAll = true;
    const killed: string[] = [];
    for (const [id, task] of this.activeTasks) {
      this.killedTasks.add(id);
      task.status = 'cancelled';
      const entry = this.deps.auditLogger.createEntry(
        'kill_switch_activated',
        'Global kill switch activated by user',
      );
      task.auditLog.push(entry);
      this.deps.auditLogger.persistEntry(id, entry);
      this.deps.auditLogger.logToConsole(id, entry);
      this.deps.taskStore.save(task);
      killed.push(id);
      this.clearProgressInterval(id);
    }
    this.activeTasks.clear();
    return killed;
  }

  resetKillSwitch(): void {
    this.killAll = false;
    this.killedTasks.clear();
  }

  killTask(taskId: string): boolean {
    // Support prefix matching (user passes first 8 chars)
    const fullId = this.resolveTaskId(taskId);
    if (!fullId) return false;

    const task = this.activeTasks.get(fullId);
    if (!task) return false;

    this.killedTasks.add(fullId);
    task.status = 'cancelled';
    const entry = this.deps.auditLogger.createEntry('task_cancelled', 'Task cancelled by user');
    task.auditLog.push(entry);
    this.deps.auditLogger.persistEntry(fullId, entry);
    this.deps.taskStore.save(task);
    this.activeTasks.delete(fullId);
    this.clearProgressInterval(fullId);
    return true;
  }

  isKillSwitchActive(): boolean {
    return this.killAll;
  }

  // ── Main entry point ─────────────────────────────────────────

  async executeGoal(
    goal: string,
    userId: string,
    chatId: number | string,
    channel: 'telegram' | 'webchat' | 'discord',
  ): Promise<AutonomousTask> {
    if (this.killAll) {
      throw new Error(
        'Autonomous operations are disabled (kill switch active). Use /auto_resume to re-enable.',
      );
    }

    const activeTasks = await this.deps.taskStore.getActiveTasks();
    if (activeTasks.length >= this.deps.config.maxConcurrentTasks) {
      throw new Error(
        `Maximum concurrent tasks reached (${this.deps.config.maxConcurrentTasks}). ` +
          'Wait for current tasks to finish or cancel them.',
      );
    }

    const taskId = randomUUID();
    const budget: ResourceBudget = {
      ...this.deps.config.defaultBudget,
      tokensUsed: 0,
      apiCallsUsed: 0,
      toolCallsUsed: 0,
      startedAt: Date.now(),
    };

    const task: AutonomousTask = {
      id: taskId,
      goal,
      userId,
      chatId,
      channel,
      status: 'planning',
      subtasks: [],
      budget,
      auditLog: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const createEntry = this.deps.auditLogger.createEntry('task_created', `Goal: ${goal}`);
    task.auditLog.push(createEntry);
    this.deps.auditLogger.persistEntry(taskId, createEntry);
    this.deps.auditLogger.logToConsole(taskId, createEntry);

    this.activeTasks.set(taskId, task);
    await this.deps.taskStore.save(task);

    // Execute asynchronously — don't block the Telegram message handler
    this.runTask(task).catch((err) => {
      console.error(`[autonomous] Task ${taskId} failed unexpectedly:`, err);
    });

    return task;
  }

  // ── Task execution lifecycle ─────────────────────────────────

  private async runTask(task: AutonomousTask): Promise<void> {
    const budgetMgr = new BudgetManager(task.budget);

    try {
      // ── Phase 1: Planning ──
      await this.sendProgress(
        task,
        `Starting autonomous task: "${task.goal}"\nPlanning subtasks...`,
      );

      if (this.isKilled(task.id)) return;

      const planResult = await planTask(
        task.goal,
        task.id,
        this.deps.chatPipelineDeps,
        this.deps.config,
      );

      if ('refused' in planResult) {
        task.status = 'failed';
        this.audit(task, 'task_failed', `Planning refused: ${planResult.reason}`);
        await this.sendProgress(task, `Task refused: ${planResult.reason}`);
        await this.finishTask(task);
        return;
      }

      budgetMgr.recordApiCall();
      budgetMgr.recordTokens(planResult.tokensUsed);
      task.plan = planResult.planSummary;
      task.subtasks = planResult.subtasks;
      task.status = 'executing';
      task.updatedAt = new Date().toISOString();

      this.audit(
        task,
        'planning_completed',
        `Plan: ${planResult.planSummary} (${planResult.subtasks.length} subtasks)`,
      );

      // Show plan to user
      const subtaskList = task.subtasks
        .map((s, i) => `  ${i + 1}. [${s.safetyTier}] ${s.description}`)
        .join('\n');
      await this.sendProgress(
        task,
        `Plan created (${task.subtasks.length} subtasks):\n${subtaskList}\n\nExecuting...`,
      );

      await this.deps.taskStore.save(task);

      // Start periodic progress reporting
      this.startProgressReporting(task);

      // ── Phase 2: Wave-based subtask execution ──
      // Group subtasks into waves by dependency. Independent subtasks in the
      // same wave run in parallel; waves execute sequentially.
      const waves = buildWaves(task.subtasks);
      let consecutiveFailures = 0;

      for (const wave of waves) {
        if (this.isKilled(task.id)) {
          task.status = 'cancelled';
          await this.sendProgress(task, 'Task cancelled by user.').catch(() => {});
          await this.finishTask(task);
          return;
        }

        // Budget check
        const budgetCheck = budgetMgr.isExceeded();
        if (budgetCheck.exceeded) {
          task.status = 'budget_exceeded';
          this.audit(task, 'budget_exceeded', budgetCheck.reason!);
          await this.sendProgress(task, `Task stopped: ${budgetCheck.reason}`);
          if (this.deps.sendReport) {
            const snap = budgetMgr.getSnapshot();
            const succeeded = task.subtasks.filter((s) => s.status === 'completed').length;
            const report = `**Task Budget Exceeded** (${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC)\n` +
              `**Goal:** ${task.goal}\n` +
              `**Result:** ${succeeded}/${task.subtasks.length} subtasks completed before budget limit\n` +
              `**Budget:** ${snap.tokensUsed} tokens, ${snap.apiCallsUsed} API calls, ${snap.toolCallsUsed} tool calls\n` +
              `**Reason:** ${budgetCheck.reason}`;
            await this.deps.sendReport(report).catch((err) =>
              console.error('[autonomous] Failed to send report:', (err as Error).message));
          }
          await this.finishTask(task);
          return;
        }

        // Budget warning
        const warning = budgetMgr.isWarningThreshold();
        if (warning.warning) {
          this.audit(task, 'budget_warning', `${warning.metric} at ${warning.pct}% of budget`);
        }

        // Pre-filter: block dangerous, request approval for sensitive
        const executableSubtasks: Subtask[] = [];
        for (const subtask of wave) {
          if (subtask.safetyTier === 'dangerous') {
            subtask.status = 'failed';
            subtask.error = 'Dangerous operations are blocked in autonomous mode';
            this.audit(task, 'subtask_failed', `Blocked: ${subtask.description} (dangerous tier)`, {
              subtaskId: subtask.id,
              safetyTier: 'dangerous',
            });
            await this.sendProgress(
              task,
              `Subtask ${subtask.index + 1} blocked (dangerous): ${subtask.description}`,
            );
            consecutiveFailures++;
            continue;
          }

          if (shouldRequireApproval(subtask.safetyTier, this.deps.config.autoApproveModerate)) {
            task.status = 'paused';
            this.audit(task, 'approval_requested', `Approval needed for: ${subtask.description}`, {
              subtaskId: subtask.id,
              safetyTier: subtask.safetyTier,
            });

            const approvalResult = await this.deps.approvalManager.requestApproval(
              task.userId,
              task.chatId,
              `Autonomous subtask (${subtask.safetyTier})`,
              `Task: "${task.goal}"\nSubtask ${subtask.index + 1}: ${subtask.description}\n\n` +
                `Will execute: ${subtask.prompt.slice(0, 200)}${subtask.prompt.length > 200 ? '...' : ''}`,
            );

            if (approvalResult !== 'approved') {
              subtask.status = 'cancelled';
              this.audit(
                task,
                approvalResult === 'denied' ? 'approval_denied' : 'approval_timeout',
                `Subtask ${subtask.index + 1} ${approvalResult}`,
                { subtaskId: subtask.id, approved: false },
              );
              consecutiveFailures++;
              task.status = 'executing';
              continue;
            }

            this.audit(task, 'approval_granted', `Subtask ${subtask.index + 1} approved`, {
              subtaskId: subtask.id,
              approved: true,
            });
            task.status = 'executing';
          }

          executableSubtasks.push(subtask);
        }

        // Circuit breaker check after pre-filtering
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          await this.tripCircuitBreaker(task);
          return;
        }

        if (executableSubtasks.length === 0) continue;

        // Announce subtask(s) starting
        if (executableSubtasks.length === 1) {
          const s = executableSubtasks[0];
          await this.sendProgress(task, `Subtask ${s.index + 1}/${task.subtasks.length}: ${s.description}`);
        } else {
          const labels = executableSubtasks.map((s) => `  ${s.index + 1}. ${s.description}`).join('\n');
          await this.sendProgress(task, `Running ${executableSubtasks.length} subtasks in parallel:\n${labels}`);
        }

        // Execute wave — single subtask runs directly, multiple run in parallel
        if (executableSubtasks.length === 1) {
          const success = await this.executeSubtask(task, executableSubtasks[0], budgetMgr);
          if (success) {
            consecutiveFailures = 0;
          } else {
            consecutiveFailures++;
          }
        } else {
          const waveIndices = executableSubtasks.map((s) => s.index + 1).join(', ');
          this.audit(task, 'subtask_started', `Parallel wave: subtasks [${waveIndices}]`);

          const results = await Promise.allSettled(
            executableSubtasks.map((subtask) => this.executeSubtask(task, subtask, budgetMgr)),
          );

          let waveSuccesses = 0;
          for (const result of results) {
            if (result.status === 'fulfilled' && result.value) {
              waveSuccesses++;
            }
          }

          if (waveSuccesses > 0) {
            consecutiveFailures = 0;
          } else {
            consecutiveFailures += results.length;
          }
        }

        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          await this.tripCircuitBreaker(task);
          return;
        }

        await this.deps.taskStore.save(task);
      }

      // ── Phase 3: Completion ──
      task.status = 'completed';
      task.completedAt = new Date().toISOString();

      // Generate summary
      task.finalSummary = await this.generateSummary(task, budgetMgr);

      const succeeded = task.subtasks.filter((s) => s.status === 'completed').length;
      this.audit(
        task,
        'task_completed',
        `Task completed. ${succeeded}/${task.subtasks.length} subtasks succeeded.`,
      );

      const snap = budgetMgr.getSnapshot();
      const completionMsg = `Autonomous task completed!\n\n${task.finalSummary}\n\n` +
        `Budget used: ${snap.tokensUsed} tokens, ${snap.apiCallsUsed} API calls, ${snap.toolCallsUsed} tool calls`;
      await this.sendProgress(task, completionMsg);

      // Post completion report to dedicated channel (e.g. Discord #reports)
      if (this.deps.sendReport) {
        const report = `**Task Completed** (${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC)\n` +
          `**Goal:** ${task.goal}\n` +
          `**Result:** ${succeeded}/${task.subtasks.length} subtasks succeeded\n` +
          `**Budget:** ${snap.tokensUsed} tokens, ${snap.apiCallsUsed} API calls, ${snap.toolCallsUsed} tool calls\n\n` +
          `${task.finalSummary}`;
        await this.deps.sendReport(report).catch((err) =>
          console.error('[autonomous] Failed to send report:', (err as Error).message));
      }
    } catch (err) {
      task.status = 'failed';
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.audit(task, 'task_failed', errorMsg);
      await this.sendProgress(task, `Autonomous task failed: ${errorMsg}`).catch(() => {});

      // Report failures too
      if (this.deps.sendReport) {
        const report = `**Task Failed** (${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC)\n` +
          `**Goal:** ${task.goal}\n` +
          `**Error:** ${errorMsg}`;
        await this.deps.sendReport(report).catch(() => {});
      }
    }

    await this.finishTask(task);
  }

  // ── Subtask execution ────────────────────────────────────────

  private async executeSubtask(
    task: AutonomousTask,
    subtask: Subtask,
    budgetMgr: BudgetManager,
  ): Promise<boolean> {
    subtask.status = 'executing';
    subtask.startedAt = new Date().toISOString();

    this.audit(task, 'subtask_started', `Subtask ${subtask.index + 1}: ${subtask.description}`, {
      subtaskId: subtask.id,
      safetyTier: subtask.safetyTier,
    });

    try {
      // Build context-aware prompt with results from dependencies
      const contextParts: string[] = [];

      // Inject shared state from declared dependencies (parallel-aware)
      if (subtask.dependsOn && subtask.dependsOn.length > 0 && this.deps.sharedState) {
        for (const depIdx of subtask.dependsOn) {
          const depSubtask = task.subtasks[depIdx];
          if (!depSubtask || depSubtask.status !== 'completed') continue;
          const key = depSubtask.outputKey;
          const value = key
            ? this.deps.sharedState.get(task.id, key)
            : depSubtask.result?.slice(0, 2000);
          if (value) {
            const label = key ?? `step_${depIdx + 1}`;
            contextParts.push(`[${label}]: ${value}`);
          }
        }
      }

      // Fallback: include sequential previous results if no explicit dependencies
      if (contextParts.length === 0) {
        const previousResults = task.subtasks
          .filter((s) => s.index < subtask.index && s.status === 'completed' && s.result)
          .map((s) => `Step ${s.index + 1} result: ${s.result!.slice(0, 1000)}`)
          .join('\n');
        if (previousResults) contextParts.push(previousResults);
      }

      const toolInstruction = 'IMPORTANT: You MUST use your available tools to accomplish this task. Do NOT just describe what you would do — actually do it using tools like project_write_file, run_code, web_search, etc. Take action, not just plan.';
      const contextualPrompt = contextParts.length > 0
        ? `${toolInstruction}\n\nContext from previous steps:\n${contextParts.join('\n')}\n\nNow: ${subtask.prompt}`
        : `${toolInstruction}\n\n${subtask.prompt}`;

      // Resolve agent profile (if assigned by the planner)
      const profile = subtask.agentProfile && this.deps.agentRegistry
        ? this.deps.agentRegistry.get(subtask.agentProfile)
        : undefined;

      // Build routing rules — use profile overrides or defaults
      const routingMap = profile?.routingOverride ?? {
        simple: DEFAULT_HAIKU_MODEL,
        default: DEFAULT_ANTHROPIC_MODEL,
        tool_simple: DEFAULT_ANTHROPIC_MODEL,
        coding: DEFAULT_ANTHROPIC_MODEL,
        complex: DEFAULT_ANTHROPIC_MODEL,
        web_content: DEFAULT_ANTHROPIC_MODEL,
      };
      const autonomousRoutingRules = Object.entries(routingMap).map(
        ([condition, model]) => ({
          condition: condition as 'simple' | 'default' | 'tool_simple' | 'coding' | 'complex' | 'web_content',
          provider: 'anthropic' as const,
          model,
        }),
      );

      // Build system prompt with optional profile suffix
      const baseSystemPrompt = this.deps.chatPipelineDeps.config.systemPrompt;
      const systemPrompt = profile?.systemPromptSuffix
        ? `${baseSystemPrompt}\n\n${profile.systemPromptSuffix}`
        : baseSystemPrompt;

      // Build tool config — restrict to profile's tools if specified
      const toolsConfig = profile && profile.allowedTools.length > 0
        ? {
            ...this.deps.chatPipelineDeps.config.tools,
            allow: profile.allowedTools,
          }
        : this.deps.chatPipelineDeps.config.tools;

      const autonomousDeps: ChatPipelineDeps = {
        ...this.deps.chatPipelineDeps,
        config: {
          ...this.deps.chatPipelineDeps.config,
          systemPrompt,
          tools: toolsConfig,
          routing: {
            mode: 'hybrid',
            primary: 'anthropic',
            rules: autonomousRoutingRules,
          },
        },
      };

      if (profile) {
        this.audit(task, 'subtask_started', `Agent profile: ${profile.id} (${profile.name})`, {
          subtaskId: subtask.id,
        });
      }

      const result = await processChatMessage(
        {
          message: contextualPrompt,
          conversationId: `autonomous-${task.id}-subtask-${subtask.index}`,
          source: 'api',
        },
        autonomousDeps,
        {
          onToolUse: (toolName) => {
            subtask.toolsUsed.push(toolName);
            budgetMgr.recordToolCall();
            this.audit(task, 'tool_executed', `Tool: ${toolName}`, {
              subtaskId: subtask.id,
              toolName,
              safetyTier: classifyToolSafety(toolName, this.deps.config.safetyTierOverrides),
            });
          },
        },
      );

      budgetMgr.recordApiCall();
      const estimatedTokens = Math.ceil((contextualPrompt.length + result.response.length) / 4);
      budgetMgr.recordTokens(estimatedTokens);
      subtask.tokensUsed = estimatedTokens;

      subtask.status = 'completed';
      subtask.result = result.response;
      subtask.completedAt = new Date().toISOString();

      const completed = task.subtasks.filter((s) => s.status === 'completed').length;
      await this.sendProgress(task, `Subtask ${subtask.index + 1} completed (${completed}/${task.subtasks.length})`);

      // Capture and deliver generated files (PDFs, presentations, etc.)
      if (result.generatedFiles?.length) {
        subtask.generatedFiles = result.generatedFiles;
        for (const file of result.generatedFiles) {
          if (this.deps.sendFile) {
            await this.deps.sendFile(task.chatId, file).catch((err) => {
              console.error(`[autonomous] Failed to deliver file "${file.filename}":`, (err as Error).message);
            });
          }
        }
      }

      // Write result to shared state if outputKey is set
      if (subtask.outputKey && this.deps.sharedState) {
        this.deps.sharedState.set(task.id, subtask.outputKey, result.response.slice(0, 6000));
      }

      this.audit(
        task,
        'subtask_completed',
        `Subtask ${subtask.index + 1} completed (${subtask.toolsUsed.length} tools used)`,
        { subtaskId: subtask.id, tokensUsed: estimatedTokens },
      );

      // Nested decomposition: if the result signals complexity and depth allows,
      // re-plan the subtask's result into child subtasks
      const maxDepth = this.deps.config.maxSpawnDepth ?? 1;
      if (
        subtask.depth < maxDepth &&
        result.response.includes('[NEEDS_DECOMPOSITION]') &&
        !budgetMgr.isExceeded().exceeded
      ) {
        this.audit(task, 'subtask_started', `Decomposing subtask ${subtask.index + 1} at depth ${subtask.depth + 1}`);
        try {
          const childPlan = await planTask(
            `Continue the following task:\n${subtask.description}\n\nContext so far:\n${result.response.replace('[NEEDS_DECOMPOSITION]', '').trim()}`,
            task.id,
            this.deps.chatPipelineDeps,
            this.deps.config,
          );

          if (!('refused' in childPlan) && childPlan.subtasks.length > 0) {
            // Set depth on child subtasks
            for (const child of childPlan.subtasks) {
              child.depth = subtask.depth + 1;
            }
            subtask.children = childPlan.subtasks;
            budgetMgr.recordApiCall();
            budgetMgr.recordTokens(childPlan.tokensUsed);

            // Execute child subtasks sequentially
            for (const child of childPlan.subtasks) {
              if (this.isKilled(task.id) || budgetMgr.isExceeded().exceeded) break;
              await this.executeSubtask(task, child, budgetMgr);
            }

            // Aggregate child results back into parent subtask
            const childResults = childPlan.subtasks
              .filter((c) => c.status === 'completed' && c.result)
              .map((c, i) => `Child ${i + 1}: ${c.result!.slice(0, 500)}`)
              .join('\n');
            if (childResults) {
              subtask.result = `${subtask.result}\n\n[Child subtask results]\n${childResults}`;
            }
          }
        } catch (err) {
          // Decomposition failure is non-fatal — the parent subtask already succeeded
          this.audit(task, 'error', `Decomposition failed: ${(err as Error).message}`, { subtaskId: subtask.id });
        }
      }

      return true;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      subtask.status = 'failed';
      subtask.error = errorMsg;
      subtask.completedAt = new Date().toISOString();

      this.audit(task, 'subtask_failed', `Subtask ${subtask.index + 1} failed: ${errorMsg}`, {
        subtaskId: subtask.id,
      });

      await this.sendProgress(task, `Subtask ${subtask.index + 1} failed: ${errorMsg}`);
      return false;
    }
  }

  // ── Summary generation ───────────────────────────────────────

  private async generateSummary(
    task: AutonomousTask,
    budgetMgr: BudgetManager,
  ): Promise<string> {
    try {
      const subtaskResults = task.subtasks
        .map(
          (s, i) =>
            `${i + 1}. ${s.description}: ${s.status}${s.result ? ' - ' + s.result.slice(0, 500) : ''}${s.error ? ' - Error: ' + s.error : ''}`,
        )
        .join('\n');

      const summaryResult = await processChatMessage(
        {
          message:
            `Summarize what was accomplished for this autonomous task.\n\n` +
            `Goal: ${task.goal}\n\nSubtask results:\n${subtaskResults}\n\n` +
            `Provide a concise but thorough summary covering:\n` +
            `1. What was accomplished (key outcomes)\n` +
            `2. All files created or modified (list file paths)\n` +
            `3. Any failures or issues encountered\n` +
            `4. Next steps or manual actions the user should take (if any)`,
          conversationId: `autonomous-summary-${task.id}`,
          source: 'api',
        },
        {
          ...this.deps.chatPipelineDeps,
          config: {
            ...this.deps.chatPipelineDeps.config,
            // Use Haiku for summary generation — cheap, no tools needed
            routing: {
              mode: 'hybrid',
              primary: 'anthropic',
              rules: [
                { condition: 'simple', provider: 'anthropic', model: DEFAULT_ANTHROPIC_MODEL },
                { condition: 'complex', provider: 'anthropic', model: DEFAULT_ANTHROPIC_MODEL },
                { condition: 'coding', provider: 'anthropic', model: DEFAULT_ANTHROPIC_MODEL },
                { condition: 'default', provider: 'anthropic', model: DEFAULT_ANTHROPIC_MODEL },
              ],
            },
          },
          // No tools for the summary call
          toolRegistry: undefined,
        },
      );

      budgetMgr.recordApiCall();
      return summaryResult.response;
    } catch {
      // Fallback: simple text summary
      return task.subtasks
        .map((s, i) => `${i + 1}. ${s.description}: ${s.status}`)
        .join('\n');
    }
  }

  // ── Circuit breaker ──────────────────────────────────────────

  private async tripCircuitBreaker(task: AutonomousTask): Promise<void> {
    task.status = 'failed';
    this.audit(
      task,
      'circuit_breaker_tripped',
      `${MAX_CONSECUTIVE_FAILURES} consecutive subtask failures`,
    );
    await this.sendProgress(
      task,
      `Task stopped: ${MAX_CONSECUTIVE_FAILURES} consecutive failures (circuit breaker)`,
    );
    if (this.deps.sendReport) {
      const succeeded = task.subtasks.filter((s) => s.status === 'completed').length;
      const report = `**Task Failed — Circuit Breaker** (${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC)\n` +
        `**Goal:** ${task.goal}\n` +
        `**Result:** ${succeeded}/${task.subtasks.length} subtasks completed before ${MAX_CONSECUTIVE_FAILURES} consecutive failures`;
      await this.deps.sendReport(report).catch((err) =>
        console.error('[autonomous] Failed to send report:', (err as Error).message));
    }
    await this.finishTask(task);
  }

  // ── Progress reporting ───────────────────────────────────────

  private startProgressReporting(task: AutonomousTask): void {
    const interval = setInterval(async () => {
      if (this.isKilled(task.id) || !this.activeTasks.has(task.id)) {
        clearInterval(interval);
        this.progressIntervals.delete(task.id);
        return;
      }

      const completed = task.subtasks.filter((s) => s.status === 'completed').length;
      const running = task.subtasks.filter((s) => s.status === 'executing');
      const total = task.subtasks.length;
      if (total > 0) {
        const parts: string[] = [`Progress: ${completed}/${total} subtasks completed`];
        for (const s of running) {
          const recentTools = s.toolsUsed.slice(-3).join(', ');
          const toolInfo = recentTools ? ` (tools: ${recentTools})` : '';
          parts.push(`  ${s.index + 1}. ${s.description.slice(0, 50)}${toolInfo}`);
        }
        await this.sendProgress(task, parts.join('\n')).catch(() => {});
      }
    }, this.deps.config.progressIntervalMs);

    this.progressIntervals.set(task.id, interval);
  }

  // ── Helpers ──────────────────────────────────────────────────

  private isKilled(taskId: string): boolean {
    return this.killAll || this.killedTasks.has(taskId);
  }

  private resolveTaskId(prefix: string): string | undefined {
    // Exact match
    if (this.activeTasks.has(prefix)) return prefix;
    // Prefix match
    for (const id of this.activeTasks.keys()) {
      if (id.startsWith(prefix)) return id;
    }
    return undefined;
  }

  private async sendProgress(task: AutonomousTask, message: string): Promise<void> {
    await this.deps.sendProgress(task.chatId, message, task.channel);
  }

  private audit(
    task: AutonomousTask,
    event: Parameters<AuditLogger['createEntry']>[0],
    details: string,
    extra?: Parameters<AuditLogger['createEntry']>[2],
  ): void {
    const entry = this.deps.auditLogger.createEntry(event, details, extra);
    task.auditLog.push(entry);
    this.deps.auditLogger.persistEntry(task.id, entry);
    this.deps.auditLogger.logToConsole(task.id, entry);
  }

  private async finishTask(task: AutonomousTask): Promise<void> {
    task.updatedAt = new Date().toISOString();
    await this.deps.taskStore.save(task);
    this.activeTasks.delete(task.id);
    this.clearProgressInterval(task.id);
  }

  private clearProgressInterval(taskId: string): void {
    const interval = this.progressIntervals.get(taskId);
    if (interval) {
      clearInterval(interval);
      this.progressIntervals.delete(taskId);
    }
  }

  // ── Query methods ────────────────────────────────────────────

  getActiveTask(taskId: string): AutonomousTask | undefined {
    return this.activeTasks.get(taskId);
  }

  getActiveTaskIds(): string[] {
    return [...this.activeTasks.keys()];
  }
}

// ── Wave builder (topological sort by dependencies) ──────────

function buildWaves(subtasks: Subtask[]): Subtask[][] {
  const waves: Subtask[][] = [];
  const completed = new Set<number>();
  const remaining = new Set(subtasks.map((_, i) => i));

  while (remaining.size > 0) {
    const wave: Subtask[] = [];
    for (const idx of remaining) {
      const deps = subtasks[idx].dependsOn ?? [];
      if (deps.every((d) => completed.has(d))) {
        wave.push(subtasks[idx]);
      }
    }

    if (wave.length === 0) {
      // Circular dependency — force all remaining into one sequential wave
      for (const idx of remaining) {
        wave.push(subtasks[idx]);
      }
      remaining.clear();
    }

    waves.push(wave);
    for (const s of wave) {
      completed.add(s.index);
      remaining.delete(s.index);
    }
  }

  return waves;
}
