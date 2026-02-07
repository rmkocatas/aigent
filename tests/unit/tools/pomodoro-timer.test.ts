import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  pomodoroStartHandler, pomodoroStatusHandler, pomodoroStopHandler,
} from '../../../src/core/tools/builtins/pomodoro-timer.js';
import type { ToolContext } from '../../../src/core/tools/registry.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let baseDir: string;
let ctx: ToolContext;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'openclaw-pomo-'));
  ctx = {
    workspaceDir: join(baseDir, 'workspace'),
    memoryDir: join(baseDir, 'memory'),
    conversationId: 'test-conv',
    userId: 'user1',
    maxExecutionMs: 5000,
  };
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(baseDir, { recursive: true, force: true });
});

describe('pomodoro_start tool', () => {
  it('starts a session with defaults', async () => {
    const r = await pomodoroStartHandler({}, ctx);
    expect(r).toContain('Pomodoro started');
    expect(r).toContain('25min');
    expect(r).toContain('5min');
  });

  it('starts with custom focus and break', async () => {
    const r = await pomodoroStartHandler({ focus_minutes: 50, break_minutes: 10 }, ctx);
    expect(r).toContain('50min');
    expect(r).toContain('10min');
  });

  it('includes task name', async () => {
    const r = await pomodoroStartHandler({ task_name: 'Write docs' }, ctx);
    expect(r).toContain('Write docs');
  });

  it('throws if session already active', async () => {
    await pomodoroStartHandler({}, ctx);
    await expect(pomodoroStartHandler({}, ctx)).rejects.toThrow('already have an active');
  });

  it('throws for invalid focus minutes', async () => {
    await expect(pomodoroStartHandler({ focus_minutes: 0 }, ctx)).rejects.toThrow('1-120');
  });

  it('throws for invalid break minutes', async () => {
    await expect(pomodoroStartHandler({ break_minutes: 61 }, ctx)).rejects.toThrow('1-60');
  });
});

describe('pomodoro_status tool', () => {
  it('reports no active session', async () => {
    const r = await pomodoroStatusHandler({}, ctx);
    expect(r).toContain('No active');
  });

  it('reports focus phase', async () => {
    await pomodoroStartHandler({ focus_minutes: 25 }, ctx);
    const r = await pomodoroStatusHandler({}, ctx);
    expect(r).toContain('Focus phase');
    expect(r).toContain('remaining');
  });

  it('reports done for completed session', async () => {
    await pomodoroStartHandler({ focus_minutes: 1, break_minutes: 1 }, ctx);
    // Mock Date.now to jump ahead
    const orig = Date.now;
    vi.spyOn(Date, 'now').mockReturnValue(orig() + 3 * 60_000);
    const r = await pomodoroStatusHandler({}, ctx);
    expect(r).toContain('complete');
  });
});

describe('pomodoro_stop tool', () => {
  it('stops active session', async () => {
    await pomodoroStartHandler({ task_name: 'Coding' }, ctx);
    const r = await pomodoroStopHandler({}, ctx);
    expect(r).toContain('stopped');
    expect(r).toContain('Coding');
  });

  it('reports no session to stop', async () => {
    const r = await pomodoroStopHandler({}, ctx);
    expect(r).toContain('No active');
  });

  it('allows starting new session after stop', async () => {
    await pomodoroStartHandler({}, ctx);
    await pomodoroStopHandler({}, ctx);
    const r = await pomodoroStartHandler({ task_name: 'New task' }, ctx);
    expect(r).toContain('started');
  });
});
