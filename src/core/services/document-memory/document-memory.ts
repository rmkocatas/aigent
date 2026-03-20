// ============================================================
// OpenClaw Deploy — Document Memory Engine
// ============================================================

import { readFile, writeFile, mkdir, stat, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { estimateTokens } from '../../gateway/token-estimator.js';
import { ActivityLogger } from './activity-logger.js';
import type { SqliteActivityStore } from '../memory-db/activity-store.js';
import type {
  DocumentMemoryConfig,
  ActivityLogEntry,
  ActivitySearchQuery,
} from './types.js';

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

const MEMORY_TEMPLATE = `# Long-Term Memory

## About You
<!-- Name, background, languages, occupation, interests -->

## Preferences
<!-- Communication style, timezone, tools they prefer, pet peeves -->

## Standing Orders
<!-- Permanent instructions from the user: "always do X", "never do Y" -->

## Key Knowledge
<!-- Important technical context, project details, domain expertise -->

## Important Dates
<!-- Birthdays, deadlines, recurring events -->

## Lessons Learned
<!-- Things that went wrong and what I learned. Pattern: what happened → what I should do instead -->

## Notes
<!-- Miscellaneous persistent notes -->
`;

const TASKS_TEMPLATE = `# Active Tasks

## In Progress
<!-- Tasks currently being worked on. Format: - [description] (started YYYY-MM-DD) -->

## Planned
<!-- Tasks queued for future work. Format: - [description] (added YYYY-MM-DD) -->

## Blocked
<!-- Tasks waiting on something. Format: - [description] — blocked by: [reason] -->

## Recently Completed
<!-- Last 5 completed tasks. Format: - [description] (completed YYYY-MM-DD) -->
`;

interface FileCache {
  content: string;
  mtime: number;
}

export class DocumentMemoryEngine {
  private soulContent: string | null = null;
  private memoryCache = new Map<string, FileCache>();
  private tasksCache = new Map<string, FileCache>();
  private activityLogger: ActivityLogger;

  constructor(
    private readonly config: DocumentMemoryConfig,
    private readonly baseDir: string,
    _anthropicApiKey: string | null,
    sqliteActivityStore?: SqliteActivityStore,
  ) {
    this.activityLogger = new ActivityLogger(
      join(baseDir, 'logs', 'activity'),
      config.activityRetentionDays,
      sqliteActivityStore,
    );
  }

  // ── Lifecycle ──────────────────────────────────────────────

  async start(): Promise<void> {
    await this.loadSoul();
    this.activityLogger.startCleanup();
    console.log('[doc-memory] Document memory engine started');
  }

  stop(): void {
    this.activityLogger.stopCleanup();
  }

  // ── Soul.md ────────────────────────────────────────────────

  private async loadSoul(): Promise<void> {
    const soulPath = join(this.baseDir, 'soul.md');
    try {
      this.soulContent = await readFile(soulPath, 'utf-8');
    } catch {
      this.soulContent = null;
      console.warn('[doc-memory] soul.md not found at', soulPath);
    }
  }

  async reloadSoul(): Promise<void> {
    await this.loadSoul();
  }

  // ── File Paths ─────────────────────────────────────────────

  private docsDir(userId: string): string {
    return join(this.baseDir, 'memory', 'docs', sanitizeId(userId));
  }

  private memoryPath(userId: string): string {
    // Prefer MEMORY.md (upstream convention) to avoid duplicate injection on case-insensitive mounts
    const dir = this.docsDir(userId);
    return join(dir, 'memory.md');
  }

  /**
   * Resolve the actual memory file path, preferring MEMORY.md over memory.md.
   * Falls back to the default (lowercase) if neither exists yet.
   */
  private async resolveMemoryPath(userId: string): Promise<string> {
    const dir = this.docsDir(userId);
    const upper = join(dir, 'MEMORY.md');
    try {
      await access(upper);
      return upper;
    } catch {
      // MEMORY.md doesn't exist — use lowercase (existing or will be created)
      return join(dir, 'memory.md');
    }
  }

  private tasksPath(userId: string): string {
    return join(this.docsDir(userId), 'tasks.md');
  }

  // ── Read with mtime caching ────────────────────────────────

  private async readCached(
    filePath: string,
    cache: Map<string, FileCache>,
    userId: string,
  ): Promise<string | null> {
    try {
      const st = await stat(filePath);
      const cached = cache.get(userId);
      if (cached && cached.mtime >= st.mtimeMs) {
        return cached.content;
      }
      const content = await readFile(filePath, 'utf-8');
      cache.set(userId, { content, mtime: st.mtimeMs });
      return content;
    } catch {
      return null;
    }
  }

  // ── Template creation ──────────────────────────────────────

  private async ensureTemplate(filePath: string, template: string): Promise<void> {
    try {
      await stat(filePath);
    } catch {
      // File doesn't exist — create it with template
      const now = new Date().toISOString().split('T')[0];
      const content = template + `\n---\n*Last updated: ${now}*\n`;
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, 'utf-8');
      console.log('[doc-memory] Created template:', filePath);
    }
  }

  // ── Context Injection ──────────────────────────────────────

  async getContextInjection(userId: string): Promise<string | null> {
    if (!this.config.autoInject) return null;

    // Resolve actual memory file path (prefer MEMORY.md over memory.md)
    const resolvedMemoryPath = await this.resolveMemoryPath(userId);

    // Ensure template files exist for this user
    await this.ensureTemplate(resolvedMemoryPath, MEMORY_TEMPLATE);
    await this.ensureTemplate(this.tasksPath(userId), TASKS_TEMPLATE);

    const sections: string[] = [];

    // 1. Soul.md — global identity
    if (this.soulContent) {
      const truncated = this.truncateToTokenBudget(
        this.soulContent,
        this.config.soulTokenBudget,
      );
      sections.push(`[Identity — soul.md]\n${truncated}`);
    }

    // 2. memory.md — per-user long-term memory
    const memDoc = await this.readCached(
      resolvedMemoryPath,
      this.memoryCache,
      userId,
    );
    if (memDoc) {
      const sanitized = sanitizeId(userId);
      const truncated = this.truncateToTokenBudget(
        memDoc,
        this.config.memoryTokenBudget,
      );
      sections.push(
        `[Long-Term Memory — memory.md | userId: ${sanitized}]\n${truncated}`,
      );
    }

    // 3. tasks.md — per-user active tasks
    const tasksDoc = await this.readCached(
      this.tasksPath(userId),
      this.tasksCache,
      userId,
    );
    if (tasksDoc) {
      const truncated = this.truncateToTokenBudget(
        tasksDoc,
        this.config.tasksTokenBudget,
      );
      sections.push(`[Active Tasks — tasks.md]\n${truncated}`);
    }

    if (sections.length === 0) return null;
    return sections.join('\n\n');
  }

  // ── Activity Logging ───────────────────────────────────────

  async logActivity(entry: ActivityLogEntry): Promise<void> {
    if (!this.config.activityLogging) return;
    await this.activityLogger.log(entry);
  }

  async searchActivity(
    userId: string,
    query: ActivitySearchQuery,
  ): Promise<ActivityLogEntry[]> {
    return this.activityLogger.search(userId, query);
  }

  // ── Token Budget Truncation ────────────────────────────────

  private truncateToTokenBudget(content: string, budget: number): string {
    const tokens = estimateTokens(content);
    if (tokens <= budget) return content;

    const lines = content.split('\n');
    let used = 0;
    const kept: string[] = [];

    for (const line of lines) {
      const lineTokens = estimateTokens(line);
      if (used + lineTokens > budget - 10) {
        // Reserve 10 tokens for the truncation notice
        kept.push(
          '...[truncated — full document available via project_read_file]',
        );
        break;
      }
      kept.push(line);
      used += lineTokens;
    }

    return kept.join('\n');
  }
}
