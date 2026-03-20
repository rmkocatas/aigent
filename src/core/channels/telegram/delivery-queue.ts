// ============================================================
// OpenClaw Deploy — Write-Ahead Delivery Queue (Telegram)
// ============================================================
//
// Lightweight JSONL-based outbox for text messages.  Before
// sending, messages are persisted to disk.  After successful
// delivery they are marked delivered.  On startup, any pending
// messages are replayed so nothing is lost if the process dies
// mid-send.
//
// Scope: text messages only — media payloads are too large for
// JSONL and already have retry logic via withRetry().
// ============================================================

import { readFile, appendFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface QueuedMessage {
  id: string;
  chatId: number;
  text: string;
  parseMode?: string;
  status: 'pending' | 'delivered' | 'failed';
  createdAt: string;
  attempts: number;
  lastError?: string;
  lastAttemptAt?: string; // ISO timestamp of last retry attempt
}

const MAX_RETRY_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 5_000;  // 5 seconds
const BACKOFF_MAX_MS = 5 * 60_000; // 5 minutes

function getBackoffMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * Math.pow(2, attempts - 1), BACKOFF_MAX_MS);
}

export class DeliveryQueue {
  private readonly queuePath: string;

  constructor(baseDir: string) {
    this.queuePath = join(baseDir, 'queue', 'telegram-outbox.jsonl');
  }

  async enqueue(chatId: number, text: string, parseMode?: string): Promise<string> {
    const entry: QueuedMessage = {
      id: randomUUID(),
      chatId,
      text,
      parseMode,
      status: 'pending',
      createdAt: new Date().toISOString(),
      attempts: 0,
    };
    await mkdir(dirname(this.queuePath), { recursive: true });
    await appendFile(this.queuePath, JSON.stringify(entry) + '\n', 'utf-8');
    return entry.id;
  }

  async getPending(): Promise<QueuedMessage[]> {
    const now = Date.now();
    const entries = await this.readAll();
    return entries.filter((e) => {
      if (e.status !== 'pending' || e.attempts >= MAX_RETRY_ATTEMPTS) return false;
      if (!e.lastAttemptAt || e.attempts === 0) return true;
      const eligible = new Date(e.lastAttemptAt).getTime() + getBackoffMs(e.attempts);
      return now >= eligible;
    });
  }

  async markDelivered(id: string): Promise<void> {
    await this.updateEntry(id, { status: 'delivered' });
  }

  async markFailed(id: string, error: string, attempts: number): Promise<void> {
    await this.updateEntry(id, {
      status: attempts >= MAX_RETRY_ATTEMPTS ? 'failed' : 'pending',
      attempts,
      lastError: error,
      lastAttemptAt: new Date().toISOString(),
    });
  }

  /** Remove delivered messages older than 1 hour and failed messages older than 24 hours */
  async cleanup(): Promise<void> {
    const entries = await this.readAll();
    const now = Date.now();
    const filtered = entries.filter((e) => {
      const age = now - new Date(e.createdAt).getTime();
      if (e.status === 'delivered') return age < 60 * 60_000; // 1 hour
      if (e.status === 'failed') return age < 24 * 60 * 60_000; // 24 hours
      return true; // keep pending
    });
    if (filtered.length < entries.length) {
      await this.writeAll(filtered);
    }
  }

  private async readAll(): Promise<QueuedMessage[]> {
    try {
      const content = await readFile(this.queuePath, 'utf-8');
      return content
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as QueuedMessage);
    } catch {
      return [];
    }
  }

  private async writeAll(entries: QueuedMessage[]): Promise<void> {
    await mkdir(dirname(this.queuePath), { recursive: true });
    const content = entries.length
      ? entries.map((e) => JSON.stringify(e)).join('\n') + '\n'
      : '';
    await writeFile(this.queuePath, content, 'utf-8');
  }

  private async updateEntry(id: string, updates: Partial<QueuedMessage>): Promise<void> {
    const entries = await this.readAll();
    const entry = entries.find((e) => e.id === id);
    if (entry) {
      Object.assign(entry, updates);
      await this.writeAll(entries);
    }
  }
}
