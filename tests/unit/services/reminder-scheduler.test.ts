import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ReminderScheduler } from '../../../src/core/services/reminder-scheduler.js';
import type { Reminder } from '../../../src/types/index.js';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let remindersDir: string;
let scheduler: ReminderScheduler;

beforeEach(async () => {
  const baseDir = await mkdtemp(join(tmpdir(), 'openclaw-rsched-'));
  remindersDir = join(baseDir, 'reminders');
  await mkdir(remindersDir, { recursive: true });
  scheduler = new ReminderScheduler(remindersDir);
});

afterEach(async () => {
  scheduler.stop();
  await rm(remindersDir, { recursive: true, force: true });
});

function createReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 'test-id-1',
    userId: 'telegram:12345',
    chatId: 12345,
    channel: 'telegram',
    message: 'Test reminder',
    triggerAt: new Date(Date.now() - 60_000).toISOString(), // 1 minute ago (due)
    createdAt: new Date(Date.now() - 120_000).toISOString(),
    fired: false,
    ...overrides,
  };
}

async function writeReminders(reminders: Reminder[]): Promise<void> {
  await writeFile(
    join(remindersDir, 'reminders.json'),
    JSON.stringify(reminders, null, 2),
    'utf-8',
  );
}

async function readReminders(): Promise<Reminder[]> {
  const content = await readFile(
    join(remindersDir, 'reminders.json'),
    'utf-8',
  );
  return JSON.parse(content);
}

describe('ReminderScheduler', () => {
  it('fires callback for due reminders', async () => {
    const dueReminder = createReminder();
    await writeReminders([dueReminder]);

    const fired: Reminder[] = [];
    scheduler.onReminder((r) => fired.push(r));

    await scheduler.checkReminders();

    expect(fired).toHaveLength(1);
    expect(fired[0].id).toBe('test-id-1');
    expect(fired[0].message).toBe('Test reminder');
  });

  it('does not fire callback for future reminders', async () => {
    const futureReminder = createReminder({
      triggerAt: new Date(Date.now() + 3_600_000).toISOString(), // 1 hour from now
    });
    await writeReminders([futureReminder]);

    const fired: Reminder[] = [];
    scheduler.onReminder((r) => fired.push(r));

    await scheduler.checkReminders();

    expect(fired).toHaveLength(0);
  });

  it('marks reminders as fired after processing', async () => {
    const dueReminder = createReminder();
    await writeReminders([dueReminder]);

    scheduler.onReminder(() => {});
    await scheduler.checkReminders();

    const reminders = await readReminders();
    expect(reminders).toHaveLength(1);
    expect(reminders[0].fired).toBe(true);
  });

  it('does not fire already-fired reminders', async () => {
    const firedReminder = createReminder({ fired: true });
    await writeReminders([firedReminder]);

    const fired: Reminder[] = [];
    scheduler.onReminder((r) => fired.push(r));

    await scheduler.checkReminders();

    expect(fired).toHaveLength(0);
  });

  it('cleans up fired reminders older than 24h', async () => {
    const oldFiredReminder = createReminder({
      id: 'old-fired',
      fired: true,
      triggerAt: new Date(Date.now() - 25 * 60 * 60_000).toISOString(), // 25 hours ago
    });
    const recentFiredReminder = createReminder({
      id: 'recent-fired',
      fired: true,
      triggerAt: new Date(Date.now() - 1 * 60 * 60_000).toISOString(), // 1 hour ago
    });
    const activeReminder = createReminder({
      id: 'active',
      fired: false,
      triggerAt: new Date(Date.now() + 3_600_000).toISOString(), // future
    });

    await writeReminders([oldFiredReminder, recentFiredReminder, activeReminder]);

    scheduler.onReminder(() => {});
    await scheduler.checkReminders();

    const reminders = await readReminders();
    const ids = reminders.map((r) => r.id);
    expect(ids).not.toContain('old-fired');
    expect(ids).toContain('recent-fired');
    expect(ids).toContain('active');
  });

  it('handles empty reminders file gracefully', async () => {
    const fired: Reminder[] = [];
    scheduler.onReminder((r) => fired.push(r));

    // No file exists — should not throw
    await scheduler.checkReminders();

    expect(fired).toHaveLength(0);
  });

  it('start and stop manage the interval', () => {
    vi.useFakeTimers();

    scheduler.onReminder(() => {});
    scheduler.start();

    // Starting again should be a no-op
    scheduler.start();

    scheduler.stop();

    // Stopping again should be a no-op
    scheduler.stop();

    vi.useRealTimers();
  });
});
