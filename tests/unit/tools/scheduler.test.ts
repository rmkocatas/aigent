import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  scheduleReminderHandler,
  listRemindersHandler,
  cancelReminderHandler,
} from '../../../src/core/tools/builtins/scheduler.js';
import type { ToolContext } from '../../../src/core/tools/registry.js';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let baseDir: string;
let memoryDir: string;
let context: ToolContext;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'openclaw-sched-'));
  memoryDir = join(baseDir, 'memory');
  context = {
    workspaceDir: join(baseDir, 'workspace'),
    memoryDir,
    conversationId: 'chat-123',
    userId: 'telegram:12345',
    maxExecutionMs: 5000,
  };
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

describe('schedule_reminder tool', () => {
  it('creates a reminder file and returns confirmation', async () => {
    const result = await scheduleReminderHandler(
      { message: 'Take a break', delay_minutes: 30 },
      context,
    );
    expect(result).toContain('Reminder scheduled');
    expect(result).toContain('ID:');

    // Verify file was created
    const filePath = join(baseDir, 'reminders', 'reminders.json');
    const content = JSON.parse(await readFile(filePath, 'utf-8'));
    expect(content).toHaveLength(1);
    expect(content[0].message).toBe('Take a break');
    expect(content[0].fired).toBe(false);
    expect(content[0].userId).toBe('telegram:12345');
  });

  it('rejects message longer than 1000 characters', async () => {
    const longMessage = 'x'.repeat(1001);
    await expect(
      scheduleReminderHandler(
        { message: longMessage, delay_minutes: 10 },
        context,
      ),
    ).rejects.toThrow('Message too long');
  });

  it('rejects delay_minutes less than 1', async () => {
    await expect(
      scheduleReminderHandler(
        { message: 'test', delay_minutes: 0 },
        context,
      ),
    ).rejects.toThrow('delay_minutes must be between');
  });

  it('rejects delay_minutes greater than 525600', async () => {
    await expect(
      scheduleReminderHandler(
        { message: 'test', delay_minutes: 525601 },
        context,
      ),
    ).rejects.toThrow('delay_minutes must be between');
  });

  it('rejects when user has 50 active reminders', async () => {
    // Create 50 reminders
    for (let i = 0; i < 50; i++) {
      await scheduleReminderHandler(
        { message: `reminder ${i}`, delay_minutes: 60 },
        context,
      );
    }

    // 51st should fail
    await expect(
      scheduleReminderHandler(
        { message: 'one too many', delay_minutes: 60 },
        context,
      ),
    ).rejects.toThrow('Too many active reminders');
  });

  it('rejects missing message', async () => {
    await expect(
      scheduleReminderHandler({ delay_minutes: 10 }, context),
    ).rejects.toThrow('Missing or invalid message');
  });
});

describe('list_reminders tool', () => {
  it('returns "no active reminders" when empty', async () => {
    const result = await listRemindersHandler({}, context);
    expect(result).toBe('No active reminders.');
  });

  it('returns formatted list of active reminders', async () => {
    await scheduleReminderHandler(
      { message: 'First reminder', delay_minutes: 10 },
      context,
    );
    await scheduleReminderHandler(
      { message: 'Second reminder', delay_minutes: 20 },
      context,
    );

    const result = await listRemindersHandler({}, context);
    expect(result).toContain('Active reminders (2)');
    expect(result).toContain('First reminder');
    expect(result).toContain('Second reminder');
  });

  it('only shows reminders for the current user', async () => {
    await scheduleReminderHandler(
      { message: 'My reminder', delay_minutes: 10 },
      context,
    );

    const otherContext = { ...context, userId: 'telegram:99999' };
    await scheduleReminderHandler(
      { message: 'Other user reminder', delay_minutes: 10 },
      otherContext,
    );

    const result = await listRemindersHandler({}, context);
    expect(result).toContain('Active reminders (1)');
    expect(result).toContain('My reminder');
    expect(result).not.toContain('Other user reminder');
  });
});

describe('cancel_reminder tool', () => {
  it('cancels an existing reminder', async () => {
    const scheduleResult = await scheduleReminderHandler(
      { message: 'Cancel me', delay_minutes: 10 },
      context,
    );

    // Extract ID from result
    const idMatch = scheduleResult.match(/ID: ([0-9a-f-]+)/);
    expect(idMatch).not.toBeNull();
    const reminderId = idMatch![1];

    const cancelResult = await cancelReminderHandler(
      { reminder_id: reminderId },
      context,
    );
    expect(cancelResult).toContain('cancelled');

    // Verify it's gone
    const listResult = await listRemindersHandler({}, context);
    expect(listResult).toBe('No active reminders.');
  });

  it('rejects canceling a non-existent reminder', async () => {
    await expect(
      cancelReminderHandler(
        { reminder_id: 'non-existent-id' },
        context,
      ),
    ).rejects.toThrow('Reminder not found');
  });

  it('rejects canceling another user\'s reminder', async () => {
    const scheduleResult = await scheduleReminderHandler(
      { message: 'Not yours', delay_minutes: 10 },
      context,
    );

    const idMatch = scheduleResult.match(/ID: ([0-9a-f-]+)/);
    const reminderId = idMatch![1];

    const otherContext = { ...context, userId: 'telegram:99999' };
    await expect(
      cancelReminderHandler(
        { reminder_id: reminderId },
        otherContext,
      ),
    ).rejects.toThrow("Cannot cancel another user's reminder");
  });

  it('rejects missing reminder_id', async () => {
    await expect(
      cancelReminderHandler({}, context),
    ).rejects.toThrow('Missing reminder_id');
  });
});
