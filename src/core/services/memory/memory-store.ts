// ============================================================
// OpenClaw Deploy — Layered File-Based Memory Store
// ============================================================
//
// Each user gets a directory with 4 layer files:
//   memory/semantic/{userId}/identity.json
//   memory/semantic/{userId}/projects.json
//   memory/semantic/{userId}/knowledge.json
//   memory/semantic/{userId}/episodes.json
//
// Auto-migrates from the old flat {userId}.json format on first load.
// ============================================================

import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { MemoryEntry, MemoryStoreData, MemoryLayer } from './types.js';
import { ALL_LAYERS } from './types.js';

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

function emptyLayerStore(layer: MemoryLayer): MemoryStoreData {
  return {
    version: 2,
    layer,
    entries: [],
    lastConsolidation: null,
    stats: {
      totalFacts: 0,
      totalExtractions: 0,
      totalRecalls: 0,
      totalMerges: 0,
      totalPrunes: 0,
    },
  };
}

/** Per-layer capacity limits */
const LAYER_CAPACITY: Record<MemoryLayer, number> = {
  identity: 50,
  projects: 100,
  knowledge: 300,
  episodes: 20,
};

/** Classify an existing entry into a layer using keyword heuristics */
function classifyEntryLayer(entry: MemoryEntry): MemoryLayer {
  // If already classified, keep it
  if (entry.layer) return entry.layer;

  const factLower = entry.fact.toLowerCase();

  // Identity: preferences, personal info
  const identityPatterns = /\b(prefer|like|dislike|favorite|name is|timezone|lives? in|born|native|language|role is|works? as|occupation)\b/i;
  if (identityPatterns.test(factLower)) return 'identity';

  // Projects: task/project state
  const projectPatterns = /\b(project|task|milestone|progress|deploy|sprint|version|release|working on|building|implementing|refactor|migration)\b/i;
  if (projectPatterns.test(factLower)) return 'projects';

  // Default: knowledge
  return 'knowledge';
}

interface LayeredStores {
  identity: MemoryStoreData;
  projects: MemoryStoreData;
  knowledge: MemoryStoreData;
  episodes: MemoryStoreData;
}

export class MemoryStore {
  private stores = new Map<string, LayeredStores>();
  private dirty = new Set<string>();
  private baseDir: string;

  constructor(memoryDir: string) {
    this.baseDir = join(memoryDir, 'semantic');
  }

  private userDir(userId: string): string {
    return join(this.baseDir, sanitizeId(userId));
  }

  private layerPath(userId: string, layer: MemoryLayer): string {
    return join(this.userDir(userId), `${layer}.json`);
  }

  private legacyPath(userId: string): string {
    return join(this.baseDir, `${sanitizeId(userId)}.json`);
  }

  // ---- Load ----

  async load(userId: string): Promise<LayeredStores> {
    if (this.stores.has(userId)) return this.stores.get(userId)!;

    // Check if we need to migrate from legacy flat file
    const legacy = this.legacyPath(userId);
    try {
      await stat(legacy);
      // Legacy file exists — migrate
      const migrated = await this.migrateFromLegacy(userId);
      this.stores.set(userId, migrated);
      return migrated;
    } catch {
      // No legacy file — load from directory
    }

    const layered = await this.loadFromDirectory(userId);
    this.stores.set(userId, layered);
    return layered;
  }

  private async loadFromDirectory(userId: string): Promise<LayeredStores> {
    const result: Partial<LayeredStores> = {};
    for (const layer of ALL_LAYERS) {
      try {
        const raw = await readFile(this.layerPath(userId, layer), 'utf-8');
        result[layer] = JSON.parse(raw) as MemoryStoreData;
      } catch {
        result[layer] = emptyLayerStore(layer);
      }
    }
    return result as LayeredStores;
  }

  private async migrateFromLegacy(userId: string): Promise<LayeredStores> {
    console.log(`[memory] Migrating ${userId} from flat file to layered directory...`);

    const raw = await readFile(this.legacyPath(userId), 'utf-8');
    const oldData = JSON.parse(raw) as MemoryStoreData;

    const layered: LayeredStores = {
      identity: emptyLayerStore('identity'),
      projects: emptyLayerStore('projects'),
      knowledge: emptyLayerStore('knowledge'),
      episodes: emptyLayerStore('episodes'),
    };

    // Classify and distribute entries
    for (const entry of oldData.entries) {
      const layer = classifyEntryLayer(entry);
      entry.layer = layer;
      layered[layer].entries.push(entry);
    }

    // Update stats
    for (const layer of ALL_LAYERS) {
      layered[layer].stats = {
        ...oldData.stats,
        totalFacts: layered[layer].entries.length,
      };
      layered[layer].lastConsolidation = oldData.lastConsolidation;
    }

    // Save new directory structure
    await mkdir(this.userDir(userId), { recursive: true });
    for (const layer of ALL_LAYERS) {
      await writeFile(
        this.layerPath(userId, layer),
        JSON.stringify(layered[layer], null, 2),
        'utf-8',
      );
    }

    // Rename legacy file to .bak instead of deleting
    try {
      await rename(this.legacyPath(userId), this.legacyPath(userId) + '.bak');
    } catch {
      // Rename failed — not critical
    }

    const totalMigrated = oldData.entries.length;
    const distribution = ALL_LAYERS.map(
      (l) => `${l}=${layered[l].entries.length}`,
    ).join(', ');
    console.log(
      `[memory] Migrated ${totalMigrated} entries for ${userId}: ${distribution}`,
    );

    return layered;
  }

  // ---- Save ----

  async save(userId: string): Promise<void> {
    const stores = this.stores.get(userId);
    if (!stores) return;

    await mkdir(this.userDir(userId), { recursive: true });
    for (const layer of ALL_LAYERS) {
      await writeFile(
        this.layerPath(userId, layer),
        JSON.stringify(stores[layer], null, 2),
        'utf-8',
      );
    }
    this.dirty.delete(userId);
  }

  // ---- Entry operations ----

  async addEntry(userId: string, entry: MemoryEntry): Promise<void> {
    const stores = await this.load(userId);
    const layer = entry.layer || 'knowledge';
    entry.layer = layer;

    // Enforce per-layer capacity
    if (stores[layer].entries.length >= LAYER_CAPACITY[layer]) {
      return; // silently skip — caller should check capacity first
    }

    stores[layer].entries.push(entry);
    stores[layer].stats.totalFacts = stores[layer].entries.length;
    this.dirty.add(userId);
  }

  async getEntries(userId: string, layer?: MemoryLayer): Promise<MemoryEntry[]> {
    const stores = await this.load(userId);
    if (layer) {
      return stores[layer].entries;
    }
    // Return all entries across all layers
    return ALL_LAYERS.flatMap((l) => stores[l].entries);
  }

  async getLayerEntries(userId: string): Promise<Record<MemoryLayer, MemoryEntry[]>> {
    const stores = await this.load(userId);
    return {
      identity: stores.identity.entries,
      projects: stores.projects.entries,
      knowledge: stores.knowledge.entries,
      episodes: stores.episodes.entries,
    };
  }

  async removeEntry(userId: string, entryId: string): Promise<boolean> {
    const stores = await this.load(userId);
    for (const layer of ALL_LAYERS) {
      const idx = stores[layer].entries.findIndex((e) => e.id === entryId);
      if (idx !== -1) {
        stores[layer].entries.splice(idx, 1);
        stores[layer].stats.totalFacts = stores[layer].entries.length;
        this.dirty.add(userId);
        return true;
      }
    }
    return false;
  }

  async replaceEntries(
    userId: string,
    entries: MemoryEntry[],
    layer: MemoryLayer,
  ): Promise<void> {
    const stores = await this.load(userId);
    stores[layer].entries = entries;
    stores[layer].stats.totalFacts = entries.length;
    this.dirty.add(userId);
  }

  async getLayerStats(userId: string, layer: MemoryLayer): Promise<{
    count: number;
    capacity: number;
    lastConsolidation: string | null;
  }> {
    const stores = await this.load(userId);
    return {
      count: stores[layer].entries.length,
      capacity: LAYER_CAPACITY[layer],
      lastConsolidation: stores[layer].lastConsolidation,
    };
  }

  async setLastConsolidation(userId: string, layer: MemoryLayer, timestamp: string): Promise<void> {
    const stores = await this.load(userId);
    stores[layer].lastConsolidation = timestamp;
    this.dirty.add(userId);
  }

  async updateStats(
    userId: string,
    layer: MemoryLayer,
    update: Partial<{ totalMerges: number; totalPrunes: number; totalRecalls: number; totalExtractions: number }>,
  ): Promise<void> {
    const stores = await this.load(userId);
    const stats = stores[layer].stats;
    if (update.totalMerges) stats.totalMerges += update.totalMerges;
    if (update.totalPrunes) stats.totalPrunes += update.totalPrunes;
    if (update.totalRecalls) stats.totalRecalls += update.totalRecalls;
    if (update.totalExtractions) stats.totalExtractions += update.totalExtractions;
    this.dirty.add(userId);
  }

  getLayerCapacity(layer: MemoryLayer): number {
    return LAYER_CAPACITY[layer];
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
}
