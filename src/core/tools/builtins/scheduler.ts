// ============================================================
// OpenClaw Deploy — Scheduler Tools (Reminders)
// ============================================================

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ToolDefinition } from '../../../types/index.js';
import type { Reminder } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

const MAX_ACTIVE_REMINDERS = 50;
const MAX_MESSAGE_LENGTH = 1000;
const MIN_DELAY_MINUTES = 1;
const MAX_DELAY_MINUTES = 525600; // 1 year

// ---------------------------------------------------------------------------
// Minimal cron parser (5-field: minute hour day month weekday)
// No external dependency — handles *, ranges (1-5), lists (1,3,5), steps (*/15)
// ---------------------------------------------------------------------------

function parseCronField(field: string, min: number, max: number): number[] {
  const values: Set<number> = new Set();

  for (const part of field.split(',')) {
    if (part === '*') {
      for (let i = min; i <= max; i++) values.add(i);
    } else if (part.includes('/')) {
      const [range, stepStr] = part.split('/');
      const step = parseInt(stepStr, 10);
      let start = min;
      let end = max;
      if (range !== '*') {
        if (range.includes('-')) {
          [start, end] = range.split('-').map(Number);
        } else {
          start = parseInt(range, 10);
        }
      }
      for (let i = start; i <= end; i += step) values.add(i);
    } else if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number);
      for (let i = a; i <= b; i++) values.add(i);
    } else {
      values.add(parseInt(part, 10));
    }
  }

  return [...values].sort((a, b) => a - b);
}

/** Get the next matching Date for a 5-field cron expression (from now). */
export function getNextCronTime(cron: string, from?: Date): Date {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('Invalid cron: need 5 fields');

  const minutes = parseCronField(parts[0], 0, 59);
  const hours = parseCronField(parts[1], 0, 23);
  const days = parseCronField(parts[2], 1, 31);
  const months = parseCronField(parts[3], 1, 12);
  const weekdays = parseCronField(parts[4], 0, 6); // 0 = Sunday

  const now = from ?? new Date();
  // Start searching from next minute
  const candidate = new Date(now);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  // Search up to 1 year ahead
  const limit = new Date(now.getTime() + 366 * 24 * 60 * 60_000);

  while (candidate < limit) {
    if (
      months.includes(candidate.getMonth() + 1) &&
      days.includes(candidate.getDate()) &&
      weekdays.includes(candidate.getDay()) &&
      hours.includes(candidate.getHours()) &&
      minutes.includes(candidate.getMinutes())
    ) {
      return candidate;
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  throw new Error('No matching cron time found within the next year');
}

function getRemindersPath(memoryDir: string): string {
  return join(dirname(memoryDir), 'reminders', 'reminders.json');
}

async function loadReminders(memoryDir: string): Promise<Reminder[]> {
  const filePath = getRemindersPath(memoryDir);
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as Reminder[];
  } catch {
    return [];
  }
}

async function saveReminders(memoryDir: string, reminders: Reminder[]): Promise<void> {
  const filePath = getRemindersPath(memoryDir);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(reminders, null, 2), 'utf-8');
}

// --- schedule_reminder ---

export const scheduleReminderDefinition: ToolDefinition = {
  name: 'schedule_reminder',
  description: 'Schedule a one-time or recurring reminder. Use delay_minutes for one-time, or cron for recurring (e.g. "0 9 * * 1-5" = weekdays 9am).',
  parameters: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'The reminder message',
      },
      delay_minutes: {
        type: 'number',
        description: 'Minutes from now for one-time reminders (1 to 525600). Omit if using cron.',
      },
      cron: {
        type: 'string',
        description: 'Cron expression for recurring reminders (5 fields: minute hour day month weekday). Examples: "0 9 * * *" = daily 9am, "0 9 * * 1-5" = weekdays 9am, "30 18 * * 5" = Fridays 6:30pm.',
      },
    },
    required: ['message'],
  },
  routing: {
    useWhen: ['User asks to be reminded about something', 'User wants to set a timer or alarm', 'User wants a recurring or daily reminder'],
    avoidWhen: ['User is asking about existing reminders (use list_reminders instead)'],
  },
};

export const scheduleReminderHandler: ToolHandler = async (input, context) => {
  const message = input.message as string;
  const delayMinutes = input.delay_minutes as number | undefined;
  const cronExpression = input.cron as string | undefined;

  if (!message || typeof message !== 'string') {
    throw new Error('Missing or invalid message');
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Message too long (max ${MAX_MESSAGE_LENGTH} characters)`);
  }

  const hasCron = cronExpression && typeof cronExpression === 'string';
  const hasDelay = typeof delayMinutes === 'number' && Number.isFinite(delayMinutes);

  if (!hasCron && !hasDelay) {
    throw new Error('Must provide either delay_minutes or cron expression');
  }

  if (hasDelay && (delayMinutes! < MIN_DELAY_MINUTES || delayMinutes! > MAX_DELAY_MINUTES)) {
    throw new Error(`delay_minutes must be between ${MIN_DELAY_MINUTES} and ${MAX_DELAY_MINUTES}`);
  }

  if (hasCron) {
    // Validate cron expression: 5 fields separated by spaces
    const parts = cronExpression!.trim().split(/\s+/);
    if (parts.length !== 5) {
      throw new Error('Cron expression must have exactly 5 fields: minute hour day month weekday');
    }
  }

  const reminders = await loadReminders(context.memoryDir);

  const activeCount = reminders.filter(
    (r) => r.userId === context.userId && !r.fired,
  ).length;
  if (activeCount >= MAX_ACTIVE_REMINDERS) {
    throw new Error(`Too many active reminders (max ${MAX_ACTIVE_REMINDERS})`);
  }

  const now = new Date();
  let triggerAt: Date;

  if (hasCron) {
    triggerAt = getNextCronTime(cronExpression!);
  } else {
    triggerAt = new Date(now.getTime() + delayMinutes! * 60_000);
  }

  const reminder: Reminder = {
    id: randomUUID(),
    userId: context.userId,
    chatId: context.conversationId,
    channel: 'telegram',
    message,
    triggerAt: triggerAt.toISOString(),
    createdAt: now.toISOString(),
    fired: false,
    ...(hasCron ? { cronExpression: cronExpression!, recurring: true } : {}),
  };

  reminders.push(reminder);
  await saveReminders(context.memoryDir, reminders);

  if (hasCron) {
    return `Recurring reminder scheduled (ID: ${reminder.id}). Cron: ${cronExpression}. Next fire: ${triggerAt.toISOString()}.`;
  }
  return `Reminder scheduled (ID: ${reminder.id}). Will fire at ${triggerAt.toISOString()}.`;
};

// --- list_reminders ---

export const listRemindersDefinition: ToolDefinition = {
  name: 'list_reminders',
  description: 'List all active reminders for the current user',
  parameters: {
    type: 'object',
    properties: {},
  },
  routing: {
    useWhen: ['User asks to see or list their reminders'],
    avoidWhen: ['User wants to set a new reminder (use schedule_reminder instead)'],
  },
};

export const listRemindersHandler: ToolHandler = async (_input, context) => {
  const reminders = await loadReminders(context.memoryDir);
  const active = reminders.filter(
    (r) => r.userId === context.userId && !r.fired,
  );

  if (active.length === 0) {
    return 'No active reminders.';
  }

  const lines = active.map((r) => {
    const triggerDate = new Date(r.triggerAt);
    const cronLabel = r.recurring ? ` (recurring: ${r.cronExpression})` : '';
    return `- [${r.id}] "${r.message}" — next: ${triggerDate.toISOString()}${cronLabel}`;
  });

  return `Active reminders (${active.length}):\n${lines.join('\n')}`;
};

// --- cancel_reminder ---

export const cancelReminderDefinition: ToolDefinition = {
  name: 'cancel_reminder',
  description: 'Cancel a scheduled reminder by its ID',
  parameters: {
    type: 'object',
    properties: {
      reminder_id: {
        type: 'string',
        description: 'The reminder ID to cancel',
      },
    },
    required: ['reminder_id'],
  },
  routing: {
    useWhen: ['User wants to cancel or remove a specific reminder'],
    avoidWhen: ['User just wants to view reminders (use list_reminders instead)'],
  },
};

export const cancelReminderHandler: ToolHandler = async (input, context) => {
  const reminderId = input.reminder_id as string;
  if (!reminderId || typeof reminderId !== 'string') {
    throw new Error('Missing reminder_id');
  }

  const reminders = await loadReminders(context.memoryDir);
  const index = reminders.findIndex((r) => r.id === reminderId);

  if (index === -1) {
    throw new Error(`Reminder not found: ${reminderId}`);
  }

  const reminder = reminders[index];
  if (reminder.userId !== context.userId) {
    throw new Error('Cannot cancel another user\'s reminder');
  }

  reminders.splice(index, 1);
  await saveReminders(context.memoryDir, reminders);

  return `Reminder ${reminderId} cancelled.`;
};
