import { randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Conversation, ChatMessage } from '../../types/index.js';

function sanitizeConversationId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
}

export class SessionStore {
  private conversations = new Map<string, Conversation>();
  private readonly idleTimeoutMs: number;
  private readonly maxConcurrent: number;
  private readonly persistDir: string | null;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private dirReady = false;

  constructor(
    idleTimeoutMinutes = 30,
    maxConcurrent = 4,
    persistDir?: string | null,
  ) {
    this.idleTimeoutMs = idleTimeoutMinutes * 60 * 1000;
    this.maxConcurrent = maxConcurrent;
    this.persistDir = persistDir ?? null;
  }

  start(): void {
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    this.cleanupInterval.unref();
  }

  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  async getOrCreate(conversationId?: string): Promise<Conversation> {
    if (conversationId && this.conversations.has(conversationId)) {
      const conv = this.conversations.get(conversationId)!;
      conv.lastActivity = new Date().toISOString();
      return conv;
    }

    // Try loading from disk
    if (conversationId && this.persistDir) {
      const loaded = await this.loadFromDisk(conversationId);
      if (loaded) {
        if (this.conversations.size >= this.maxConcurrent) {
          this.evictOldest();
        }
        loaded.lastActivity = new Date().toISOString();
        this.conversations.set(conversationId, loaded);
        return loaded;
      }
    }

    if (this.conversations.size >= this.maxConcurrent) {
      this.evictOldest();
    }

    const id = conversationId ?? randomUUID();
    const conv: Conversation = {
      id,
      messages: [],
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
    };
    this.conversations.set(id, conv);
    this.saveToDisk(conv).catch(() => {});
    return conv;
  }

  addMessage(conversationId: string, message: ChatMessage): void {
    const conv = this.conversations.get(conversationId);
    if (conv) {
      conv.messages.push(message);
      conv.lastActivity = new Date().toISOString();
      this.saveToDisk(conv).catch(() => {});
    }
  }

  getConversation(id: string): Conversation | undefined {
    return this.conversations.get(id);
  }

  reset(conversationId: string): boolean {
    const conv = this.conversations.get(conversationId);
    if (conv) {
      conv.messages = [];
      conv.lastActivity = new Date().toISOString();
      this.saveToDisk(conv).catch(() => {});
      return true;
    }
    // Also delete from disk if not in memory
    if (this.persistDir) {
      this.deleteFromDisk(conversationId).catch(() => {});
    }
    return false;
  }

  get activeCount(): number {
    return this.conversations.size;
  }

  // ---- Persistence helpers ----

  private async ensureDir(): Promise<void> {
    if (!this.persistDir || this.dirReady) return;
    try {
      await mkdir(this.persistDir, { recursive: true });
      this.dirReady = true;
    } catch {
      // directory may already exist
      this.dirReady = true;
    }
  }

  private filePath(id: string): string {
    return join(this.persistDir!, `${sanitizeConversationId(id)}.json`);
  }

  private async loadFromDisk(id: string): Promise<Conversation | null> {
    if (!this.persistDir) return null;
    try {
      const raw = await readFile(this.filePath(id), 'utf-8');
      const data = JSON.parse(raw) as Conversation;
      // Validate basic structure
      if (data && data.id && Array.isArray(data.messages)) {
        return data;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async saveToDisk(conv: Conversation): Promise<void> {
    if (!this.persistDir) return;
    await this.ensureDir();
    // Write atomically: never include secrets in session data
    const data = JSON.stringify({
      id: conv.id,
      messages: conv.messages,
      createdAt: conv.createdAt,
      lastActivity: conv.lastActivity,
    });
    await writeFile(this.filePath(conv.id), data, 'utf-8');
  }

  private async deleteFromDisk(id: string): Promise<void> {
    if (!this.persistDir) return;
    try {
      await unlink(this.filePath(id));
    } catch {
      // File may not exist
    }
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, conv] of this.conversations) {
      if (now - new Date(conv.lastActivity).getTime() > this.idleTimeoutMs) {
        this.conversations.delete(id);
        this.deleteFromDisk(id).catch(() => {});
      }
    }
  }

  private evictOldest(): void {
    let oldestId: string | null = null;
    let oldestTime = Infinity;
    for (const [id, conv] of this.conversations) {
      const time = new Date(conv.lastActivity).getTime();
      if (time < oldestTime) {
        oldestTime = time;
        oldestId = id;
      }
    }
    if (oldestId) {
      this.conversations.delete(oldestId);
      // Don't delete from disk on eviction — it can be loaded back later
    }
  }
}
