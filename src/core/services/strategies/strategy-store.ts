// ============================================================
// OpenClaw Deploy — File-Based Strategy Store
// ============================================================
//
// Each user gets a directory with up to 7 files:
//   strategies/{userId}/general.json
//   strategies/{userId}/simple.json
//   strategies/{userId}/complex.json
//   strategies/{userId}/coding.json
//   strategies/{userId}/tool_simple.json
//   strategies/{userId}/web_content.json
//   strategies/{userId}/default.json
// ============================================================

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { StrategyEntry, StrategyStoreData, StrategyStats } from './types.js';

const ALL_SCOPES = [
  'general', 'simple', 'complex', 'coding', 'tool_simple', 'web_content', 'default',
] as const;

type StrategyScope = (typeof ALL_SCOPES)[number];

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

function emptyStats(): StrategyStats {
  return {
    totalStrategies: 0,
    totalExtractions: 0,
    totalInjections: 0,
    totalConsolidations: 0,
  };
}

function emptyStore(scope: string): StrategyStoreData {
  return {
    version: 1,
    scope,
    entries: [],
    lastConsolidation: null,
    stats: emptyStats(),
  };
}

type ScopedStores = Record<StrategyScope, StrategyStoreData>;

export class StrategyStore {
  private stores = new Map<string, ScopedStores>();
  private dirty = new Set<string>();
  private baseDir: string;

  constructor(storageDir: string) {
    this.baseDir = storageDir;
  }

  private userDir(userId: string): string {
    return join(this.baseDir, sanitizeId(userId));
  }

  private scopePath(userId: string, scope: string): string {
    return join(this.userDir(userId), `${scope}.json`);
  }

  // ---- Load ----

  async load(userId: string): Promise<ScopedStores> {
    if (this.stores.has(userId)) return this.stores.get(userId)!;

    const result: Partial<ScopedStores> = {};
    for (const scope of ALL_SCOPES) {
      try {
        const raw = await readFile(this.scopePath(userId, scope), 'utf-8');
        result[scope] = JSON.parse(raw) as StrategyStoreData;
      } catch {
        result[scope] = emptyStore(scope);
      }
    }

    const stores = result as ScopedStores;
    this.stores.set(userId, stores);
    return stores;
  }

  // ---- Save ----

  async save(userId: string): Promise<void> {
    const stores = this.stores.get(userId);
    if (!stores) return;

    await mkdir(this.userDir(userId), { recursive: true });
    for (const scope of ALL_SCOPES) {
      await writeFile(
        this.scopePath(userId, scope),
        JSON.stringify(stores[scope], null, 2),
        'utf-8',
      );
    }
    this.dirty.delete(userId);
  }

  // ---- Entry operations ----

  async addEntry(
    userId: string,
    entry: StrategyEntry,
    maxCapacity: number,
  ): Promise<boolean> {
    const stores = await this.load(userId);
    const scope = this.resolveScope(entry.classification);

    if (stores[scope].entries.length >= maxCapacity) {
      return false; // at capacity
    }

    stores[scope].entries.push(entry);
    stores[scope].stats.totalStrategies = stores[scope].entries.length;
    this.dirty.add(userId);
    return true;
  }

  async getEntries(userId: string, scope?: string): Promise<StrategyEntry[]> {
    const stores = await this.load(userId);
    if (scope) {
      const resolved = this.resolveScope(scope);
      return stores[resolved].entries;
    }
    // Return all entries across all scopes
    return ALL_SCOPES.flatMap((s) => stores[s].entries);
  }

  async replaceEntries(
    userId: string,
    entries: StrategyEntry[],
    scope: string,
  ): Promise<void> {
    const stores = await this.load(userId);
    const resolved = this.resolveScope(scope);
    stores[resolved].entries = entries;
    stores[resolved].stats.totalStrategies = entries.length;
    this.dirty.add(userId);
  }

  async setLastConsolidation(userId: string, scope: string, timestamp: string): Promise<void> {
    const stores = await this.load(userId);
    const resolved = this.resolveScope(scope);
    stores[resolved].lastConsolidation = timestamp;
    this.dirty.add(userId);
  }

  async flush(): Promise<void> {
    for (const userId of this.dirty) {
      await this.save(userId);
    }
  }

  evict(userId: string): void {
    this.stores.delete(userId);
  }

  getLoadedUserIds(): string[] {
    return [...this.stores.keys()];
  }

  private resolveScope(classification: string): StrategyScope {
    if (ALL_SCOPES.includes(classification as StrategyScope)) {
      return classification as StrategyScope;
    }
    return 'general';
  }
}
