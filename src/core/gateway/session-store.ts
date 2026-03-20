import { randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Conversation, ChatMessage, CompactionSummary } from '../../types/index.js';

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
  private resolveIdFn: ((id: string) => string) | null = null;

  constructor(
    idleTimeoutMinutes = 30,
    maxConcurrent = 4,
    persistDir?: string | null,
  ) {
    this.idleTimeoutMs = idleTimeoutMinutes * 60 * 1000;
    this.maxConcurrent = maxConcurrent;
    this.persistDir = persistDir ?? null;
  }

  /** Set an ID resolver (e.g. from ChannelLinker) for cross-channel session aliasing. */
  setResolveId(fn: (id: string) => string): void {
    this.resolveIdFn = fn;
  }

  private resolve(id: string): string {
    return this.resolveIdFn ? this.resolveIdFn(id) : id;
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
    const resolved = conversationId ? this.resolve(conversationId) : undefined;

    if (resolved && this.conversations.has(resolved)) {
      const conv = this.conversations.get(resolved)!;
      conv.lastActivity = new Date().toISOString();
      return conv;
    }

    // Try loading from disk
    if (resolved && this.persistDir) {
      const loaded = await this.loadFromDisk(resolved);
      if (loaded) {
        if (this.conversations.size >= this.maxConcurrent) {
          this.evictOldest();
        }
        loaded.lastActivity = new Date().toISOString();
        this.conversations.set(resolved, loaded);
        return loaded;
      }
    }

    if (this.conversations.size >= this.maxConcurrent) {
      this.evictOldest();
    }

    const id = resolved ?? randomUUID();
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
    const resolved = this.resolve(conversationId);
    const conv = this.conversations.get(resolved);
    if (conv) {
      conv.messages.push(message);
      conv.lastActivity = new Date().toISOString();
      this.saveToDisk(conv).catch(() => {});
    }
  }

  setCompactionSummary(conversationId: string, summary: CompactionSummary): void {
    const resolved = this.resolve(conversationId);
    const conv = this.conversations.get(resolved);
    if (conv) {
      conv.compactionSummary = summary;
      this.saveToDisk(conv).catch(() => {});
    }
  }

  getConversation(id: string): Conversation | undefined {
    return this.conversations.get(this.resolve(id));
  }

  reset(conversationId: string): boolean {
    const resolved = this.resolve(conversationId);
    const conv = this.conversations.get(resolved);
    if (conv) {
      conv.messages = [];
      conv.compactionSummary = undefined;
      conv.provider = undefined; // Clear stale model metadata (v2026.3.11)
      conv.lastActivity = new Date().toISOString();
      this.saveToDisk(conv).catch(() => {});
      return true;
    }
    // Also delete from disk if not in memory
    if (this.persistDir) {
      this.deleteFromDisk(resolved).catch(() => {});
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
      ...(conv.compactionSummary ? { compactionSummary: conv.compactionSummary } : {}),
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
