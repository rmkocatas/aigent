// ============================================================
// OpenClaw Deploy — Autonomous Task Store (File-Based)
// ============================================================

import { readFile, writeFile, readdir, mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { AutonomousTask } from './types.js';

export class AutonomousTaskStore {
  private dirReady = false;

  constructor(private readonly tasksDir: string) {}

  private async ensureDir(): Promise<void> {
    if (this.dirReady) return;
    await mkdir(this.tasksDir, { recursive: true });
    this.dirReady = true;
  }

  private filePath(taskId: string): string {
    return join(this.tasksDir, `task-${taskId}.json`);
  }

  async save(task: AutonomousTask): Promise<void> {
    try {
      await this.ensureDir();
      await writeFile(this.filePath(task.id), JSON.stringify(task, null, 2), 'utf-8');
    } catch {
      // Best-effort persistence — don't crash the task
    }
  }

  async load(taskId: string): Promise<AutonomousTask | null> {
    try {
      const raw = await readFile(this.filePath(taskId), 'utf-8');
      return JSON.parse(raw) as AutonomousTask;
    } catch {
      return null;
    }
  }

  async loadAll(): Promise<AutonomousTask[]> {
    await this.ensureDir();
    const files = await readdir(this.tasksDir);
    const tasks: AutonomousTask[] = [];
    for (const file of files) {
      if (file.startsWith('task-') && file.endsWith('.json')) {
        try {
          const raw = await readFile(join(this.tasksDir, file), 'utf-8');
          tasks.push(JSON.parse(raw));
        } catch {
          // Skip corrupt files
        }
      }
    }
    return tasks;
  }

  async getActiveTasks(): Promise<AutonomousTask[]> {
    const all = await this.loadAll();
    return all.filter(
      (t) =>
        t.status === 'pending' ||
        t.status === 'planning' ||
        t.status === 'executing' ||
        t.status === 'paused',
    );
  }

  async delete(taskId: string): Promise<void> {
    try {
      await unlink(this.filePath(taskId));
    } catch {
      // Ignore if already deleted
    }
  }
}
