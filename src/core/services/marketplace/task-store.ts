// ============================================================
// OpenClaw Deploy — Marketplace Task Store
// ============================================================

import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { MarketplaceTask, EarningsRecord, FeedbackEntry, WalletInfo } from './types.js';

export class MarketplaceTaskStore {
  private readonly dir: string;
  private tasks: Map<string, MarketplaceTask> = new Map();

  constructor(baseDir: string) {
    this.dir = join(baseDir, 'marketplace');
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await this.loadTasks();
  }

  // ── Tasks ──────────────────────────────────────────────────────────

  private async loadTasks(): Promise<void> {
    try {
      const raw = await readFile(join(this.dir, 'tasks.json'), 'utf-8');
      const arr = JSON.parse(raw) as MarketplaceTask[];
      this.tasks.clear();
      for (const t of arr) this.tasks.set(t.id, t);
    } catch {
      // No tasks file yet
    }
  }

  private async saveTasks(): Promise<void> {
    const arr = [...this.tasks.values()];
    await writeFile(join(this.dir, 'tasks.json'), JSON.stringify(arr, null, 2), 'utf-8');
  }

  async getTask(id: string): Promise<MarketplaceTask | undefined> {
    return this.tasks.get(id);
  }

  async getAllTasks(): Promise<MarketplaceTask[]> {
    return [...this.tasks.values()];
  }

  async getTasksByStatus(status: MarketplaceTask['status']): Promise<MarketplaceTask[]> {
    return [...this.tasks.values()].filter((t) => t.status === status);
  }

  async upsertTask(task: MarketplaceTask): Promise<void> {
    this.tasks.set(task.id, task);
    await this.saveTasks();
  }

  async updateTaskStatus(id: string, status: MarketplaceTask['status']): Promise<void> {
    const task = this.tasks.get(id);
    if (task) {
      task.status = status;
      await this.saveTasks();
    }
  }

  getActiveCount(): number {
    return [...this.tasks.values()].filter(
      (t) => t.status === 'accepted' || t.status === 'in_progress' || t.status === 'quoted',
    ).length;
  }

  // ── Earnings (JSONL append-only) ───────────────────────────────────

  async logEarning(record: EarningsRecord): Promise<void> {
    const line = JSON.stringify(record) + '\n';
    await appendFile(join(this.dir, 'earnings.jsonl'), line, 'utf-8');
  }

  async getEarnings(period?: 'today' | 'week' | 'month' | 'all'): Promise<EarningsRecord[]> {
    let lines: string[];
    try {
      const raw = await readFile(join(this.dir, 'earnings.jsonl'), 'utf-8');
      lines = raw.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }

    const records = lines.map((l) => JSON.parse(l) as EarningsRecord);

    if (!period || period === 'all') return records;

    const now = Date.now();
    const cutoffs: Record<string, number> = {
      today: now - 24 * 60 * 60 * 1000,
      week: now - 7 * 24 * 60 * 60 * 1000,
      month: now - 30 * 24 * 60 * 60 * 1000,
    };
    const cutoff = cutoffs[period] ?? 0;
    return records.filter((r) => new Date(r.completedAt).getTime() >= cutoff);
  }

  // ── Feedback (JSONL append-only) ───────────────────────────────────

  async logFeedback(entry: FeedbackEntry): Promise<void> {
    const line = JSON.stringify(entry) + '\n';
    await appendFile(join(this.dir, 'feedback.jsonl'), line, 'utf-8');
  }

  async getFeedback(): Promise<FeedbackEntry[]> {
    try {
      const raw = await readFile(join(this.dir, 'feedback.jsonl'), 'utf-8');
      return raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  }

  // ── Wallet Info ────────────────────────────────────────────────────

  async getWallet(): Promise<WalletInfo | null> {
    try {
      const raw = await readFile(join(this.dir, 'wallet.json'), 'utf-8');
      return JSON.parse(raw) as WalletInfo;
    } catch {
      return null;
    }
  }

  async saveWallet(wallet: WalletInfo): Promise<void> {
    await writeFile(join(this.dir, 'wallet.json'), JSON.stringify(wallet, null, 2), 'utf-8');
  }

  // ── Stats ──────────────────────────────────────────────────────────

  async getStats(): Promise<{
    totalEarningsEth: number;
    tasksCompleted: number;
    tasksFailed: number;
    averageRating: number;
    completionRate: number;
  }> {
    const earnings = await this.getEarnings('all');
    const feedback = await this.getFeedback();
    const allTasks = [...this.tasks.values()];
    const completed = allTasks.filter((t) => t.status === 'completed').length;
    const failed = allTasks.filter((t) => t.status === 'failed').length;
    const total = completed + failed;

    return {
      totalEarningsEth: earnings.reduce((sum, e) => sum + e.amountEth, 0),
      tasksCompleted: completed,
      tasksFailed: failed,
      averageRating: feedback.length > 0
        ? feedback.reduce((sum, f) => sum + f.rating, 0) / feedback.length
        : 0,
      completionRate: total > 0 ? completed / total : 1,
    };
  }
}
