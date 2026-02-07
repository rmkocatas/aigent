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
  description: 'Schedule a reminder that will be sent to the user at a specified time',
  parameters: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'The reminder message',
      },
      delay_minutes: {
        type: 'number',
        description: 'Minutes from now (1 to 525600)',
      },
    },
    required: ['message', 'delay_minutes'],
  },
};

export const scheduleReminderHandler: ToolHandler = async (input, context) => {
  const message = input.message as string;
  const delayMinutes = input.delay_minutes as number;

  if (!message || typeof message !== 'string') {
    throw new Error('Missing or invalid message');
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Message too long (max ${MAX_MESSAGE_LENGTH} characters)`);
  }
  if (typeof delayMinutes !== 'number' || !Number.isFinite(delayMinutes)) {
    throw new Error('Missing or invalid delay_minutes');
  }
  if (delayMinutes < MIN_DELAY_MINUTES || delayMinutes > MAX_DELAY_MINUTES) {
    throw new Error(`delay_minutes must be between ${MIN_DELAY_MINUTES} and ${MAX_DELAY_MINUTES}`);
  }

  const reminders = await loadReminders(context.memoryDir);

  const activeCount = reminders.filter(
    (r) => r.userId === context.userId && !r.fired,
  ).length;
  if (activeCount >= MAX_ACTIVE_REMINDERS) {
    throw new Error(`Too many active reminders (max ${MAX_ACTIVE_REMINDERS})`);
  }

  const now = new Date();
  const triggerAt = new Date(now.getTime() + delayMinutes * 60_000);

  const reminder: Reminder = {
    id: randomUUID(),
    userId: context.userId,
    chatId: context.conversationId,
    channel: 'telegram',
    message,
    triggerAt: triggerAt.toISOString(),
    createdAt: now.toISOString(),
    fired: false,
  };

  reminders.push(reminder);
  await saveReminders(context.memoryDir, reminders);

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
    return `- [${r.id}] "${r.message}" — fires at ${triggerDate.toISOString()}`;
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
