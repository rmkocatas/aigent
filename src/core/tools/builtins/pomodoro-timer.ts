// ============================================================
// OpenClaw Deploy — Pomodoro Timer Tool
// ============================================================

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

interface PomodoroSession {
  id: string;
  userId: string;
  taskName: string;
  startedAt: string;
  focusMinutes: number;
  breakMinutes: number;
  active: boolean;
}

function getSessionsPath(memoryDir: string): string {
  return join(dirname(memoryDir), 'pomodoro', 'sessions.json');
}

async function loadSessions(memoryDir: string): Promise<PomodoroSession[]> {
  try {
    const content = await readFile(getSessionsPath(memoryDir), 'utf-8');
    return JSON.parse(content) as PomodoroSession[];
  } catch {
    return [];
  }
}

async function saveSessions(memoryDir: string, sessions: PomodoroSession[]): Promise<void> {
  const filePath = getSessionsPath(memoryDir);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(sessions, null, 2), 'utf-8');
}

function getActiveSession(sessions: PomodoroSession[], userId: string): PomodoroSession | undefined {
  return sessions.find((s) => s.userId === userId && s.active);
}

function getSessionState(session: PomodoroSession): { phase: 'focus' | 'break' | 'done'; elapsed: number; remaining: number } {
  const startMs = new Date(session.startedAt).getTime();
  const nowMs = Date.now();
  const elapsedMs = nowMs - startMs;
  const elapsedMin = elapsedMs / 60_000;
  const totalMin = session.focusMinutes + session.breakMinutes;

  if (elapsedMin < session.focusMinutes) {
    return { phase: 'focus', elapsed: elapsedMin, remaining: session.focusMinutes - elapsedMin };
  } else if (elapsedMin < totalMin) {
    return { phase: 'break', elapsed: elapsedMin - session.focusMinutes, remaining: totalMin - elapsedMin };
  }
  return { phase: 'done', elapsed: elapsedMin, remaining: 0 };
}

// ---- pomodoro_start ----

export const pomodoroStartDefinition: ToolDefinition = {
  name: 'pomodoro_start',
  description: 'Start a Pomodoro focus session with a configurable focus and break period.',
  parameters: {
    type: 'object',
    properties: {
      focus_minutes: { type: 'number', description: 'Focus period in minutes (default 25).' },
      break_minutes: { type: 'number', description: 'Break period in minutes (default 5).' },
      task_name: { type: 'string', description: 'Name of the task to focus on.' },
    },
  },
  routing: {
    useWhen: ['User wants to start a focus session or pomodoro timer'],
    avoidWhen: ['User is asking about pomodoro technique conceptually'],
  },
};

export const pomodoroStartHandler: ToolHandler = async (input, context) => {
  const focusMin = (input.focus_minutes as number) ?? 25;
  const breakMin = (input.break_minutes as number) ?? 5;
  const taskName = (input.task_name as string) ?? 'Focus session';

  if (focusMin < 1 || focusMin > 120) throw new Error('Focus must be 1-120 minutes');
  if (breakMin < 1 || breakMin > 60) throw new Error('Break must be 1-60 minutes');

  const sessions = await loadSessions(context.memoryDir);
  const existing = getActiveSession(sessions, context.userId);

  if (existing) {
    throw new Error('You already have an active Pomodoro session. Use pomodoro_stop to end it first.');
  }

  const session: PomodoroSession = {
    id: randomUUID().slice(0, 8),
    userId: context.userId,
    taskName,
    startedAt: new Date().toISOString(),
    focusMinutes: focusMin,
    breakMinutes: breakMin,
    active: true,
  };

  sessions.push(session);
  await saveSessions(context.memoryDir, sessions);

  return `Pomodoro started! Focus: ${focusMin}min, Break: ${breakMin}min. Task: "${taskName}"`;
};

// ---- pomodoro_status ----

export const pomodoroStatusDefinition: ToolDefinition = {
  name: 'pomodoro_status',
  description: 'Check the status of your current Pomodoro session.',
  parameters: {
    type: 'object',
    properties: {},
  },
  routing: {
    useWhen: ['User asks about their current focus session or time remaining'],
  },
};

export const pomodoroStatusHandler: ToolHandler = async (_input, context) => {
  const sessions = await loadSessions(context.memoryDir);
  const session = getActiveSession(sessions, context.userId);

  if (!session) return 'No active Pomodoro session.';

  const state = getSessionState(session);

  if (state.phase === 'done') {
    // Auto-complete
    session.active = false;
    await saveSessions(context.memoryDir, sessions);
    return `Pomodoro complete! "${session.taskName}" — both focus and break periods are finished.`;
  }

  const phaseLabel = state.phase === 'focus' ? 'Focus' : 'Break';
  const remaining = Math.ceil(state.remaining);
  return `${phaseLabel} phase — ${remaining} minute(s) remaining. Task: "${session.taskName}"`;
};

// ---- pomodoro_stop ----

export const pomodoroStopDefinition: ToolDefinition = {
  name: 'pomodoro_stop',
  description: 'Stop the current Pomodoro session.',
  parameters: {
    type: 'object',
    properties: {},
  },
  routing: {
    useWhen: ['User wants to stop or end their current focus session'],
  },
};

export const pomodoroStopHandler: ToolHandler = async (_input, context) => {
  const sessions = await loadSessions(context.memoryDir);
  const session = getActiveSession(sessions, context.userId);

  if (!session) return 'No active Pomodoro session to stop.';

  session.active = false;
  await saveSessions(context.memoryDir, sessions);

  const state = getSessionState(session);
  const elapsed = Math.floor(state.elapsed);
  return `Pomodoro stopped. "${session.taskName}" — ran for ${elapsed} minute(s).`;
};
