// ============================================================
// OpenClaw Deploy — Shared Agent State
// ============================================================
//
// Inter-agent coordination store. Autonomous subtasks write
// results to named keys, and dependent subtasks read them.
// Scoped per autonomous task ID.
// ============================================================

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export class SharedAgentState {
  /** taskId → (key → value) */
  private state = new Map<string, Map<string, string>>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly persistDir: string) {}

  // ── Read / Write ───────────────────────────────────────────

  get(taskId: string, key: string): string | undefined {
    return this.state.get(taskId)?.get(key);
  }

  set(taskId: string, key: string, value: string): void {
    let taskState = this.state.get(taskId);
    if (!taskState) {
      taskState = new Map();
      this.state.set(taskId, taskState);
    }
    taskState.set(key, value);
    this.scheduleSave(taskId);
  }

  getAll(taskId: string): Record<string, string> {
    const taskState = this.state.get(taskId);
    if (!taskState) return {};
    return Object.fromEntries(taskState);
  }

  keys(taskId: string): string[] {
    return [...(this.state.get(taskId)?.keys() ?? [])];
  }

  clear(taskId: string): void {
    this.state.delete(taskId);
  }

  // ── Persistence ────────────────────────────────────────────

  async load(taskId: string): Promise<void> {
    try {
      const filePath = join(this.persistDir, `${taskId}.json`);
      const raw = await readFile(filePath, 'utf-8');
      const data = JSON.parse(raw) as Record<string, string>;
      const map = new Map(Object.entries(data));
      this.state.set(taskId, map);
    } catch {
      // File doesn't exist or is invalid — start fresh
    }
  }

  private scheduleSave(taskId: string): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persistTask(taskId).catch((err) => {
        console.error(`[shared-state] Failed to persist task ${taskId}:`, err);
      });
    }, 2000);
  }

  private async persistTask(taskId: string): Promise<void> {
    const taskState = this.state.get(taskId);
    if (!taskState) return;
    await mkdir(this.persistDir, { recursive: true });
    const filePath = join(this.persistDir, `${taskId}.json`);
    const data = Object.fromEntries(taskState);
    await writeFile(filePath, JSON.stringify(data, null, 2));
  }

  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    for (const taskId of this.state.keys()) {
      await this.persistTask(taskId);
    }
  }
}
