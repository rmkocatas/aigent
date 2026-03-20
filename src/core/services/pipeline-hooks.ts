// ============================================================
// OpenClaw Deploy — Pipeline Hooks (LLM I/O Observation)
// ============================================================

import type { TokenUsage } from '../../types/index.js';

export interface LlmCallContext {
  provider: string;
  model: string;
  classification: string;
  messageCount: number;
  toolCount: number;
  iteration: number;
}

export interface LlmCallResult {
  text: string;
  toolCalls: number;
  stopReason?: string;
  usage?: TokenUsage;
  durationMs: number;
}

export type BeforeHook = (ctx: LlmCallContext) => void;
export type AfterHook = (ctx: LlmCallContext, result: LlmCallResult) => void;

export class PipelineHooks {
  private beforeHooks: BeforeHook[] = [];
  private afterHooks: AfterHook[] = [];

  onBefore(hook: BeforeHook): void {
    this.beforeHooks.push(hook);
  }

  onAfter(hook: AfterHook): void {
    this.afterHooks.push(hook);
  }

  fireBefore(ctx: LlmCallContext): void {
    for (const h of this.beforeHooks) {
      try { h(ctx); } catch { /* hooks must not crash the pipeline */ }
    }
  }

  fireAfter(ctx: LlmCallContext, result: LlmCallResult): void {
    for (const h of this.afterHooks) {
      try { h(ctx, result); } catch { /* hooks must not crash the pipeline */ }
    }
  }
}
