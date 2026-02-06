// ============================================================
// OpenClaw Deploy — Training Data Collector (JSONL Persistence)
// ============================================================

import { mkdir, readFile, writeFile, appendFile, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { LlmProvider, TrainingEntry, TrainingStats } from '../../types/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GetEntriesOptions {
  provider?: LlmProvider;
  category?: string;
  limit?: number;
  offset?: number;
}

interface AlpacaEntry {
  instruction: string;
  output: string;
}

// ---------------------------------------------------------------------------
// TrainingDataStore
// ---------------------------------------------------------------------------

export class TrainingDataStore {
  private readonly dataDir: string;
  private readonly dataFilePath: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.dataFilePath = join(dataDir, 'data.jsonl');
  }

  /** Initialize data directory and files. */
  async init(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });

    try {
      await stat(this.dataFilePath);
    } catch {
      await writeFile(this.dataFilePath, '', 'utf-8');
    }
  }

  /** Append a training entry to the JSONL file. */
  async addEntry(
    entry: Omit<TrainingEntry, 'id' | 'timestamp'>,
  ): Promise<TrainingEntry> {
    const full: TrainingEntry = {
      ...entry,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };

    const line = JSON.stringify(full) + '\n';
    await appendFile(this.dataFilePath, line, 'utf-8');
    return full;
  }

  /** Read entries with optional filtering. */
  async getEntries(options?: GetEntriesOptions): Promise<TrainingEntry[]> {
    const all = await this.readAllEntries();

    let filtered = all;

    if (options?.provider) {
      filtered = filtered.filter((e) => e.provider === options.provider);
    }
    if (options?.category) {
      filtered = filtered.filter((e) => e.category === options.category);
    }

    const offset = options?.offset ?? 0;
    const sliced = filtered.slice(offset);

    if (options?.limit !== undefined) {
      return sliced.slice(0, options.limit);
    }

    return sliced;
  }

  /** Get statistics about collected data. */
  async getStats(): Promise<TrainingStats> {
    const entries = await this.readAllEntries();

    let fileSizeBytes = 0;
    try {
      const info = await stat(this.dataFilePath);
      fileSizeBytes = info.size;
    } catch {
      // File may not exist yet.
    }

    const sorted = entries.length > 0
      ? entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      : [];

    return {
      totalEntries: entries.length,
      dataFileSizeMB: Math.round((fileSizeBytes / (1024 * 1024)) * 100) / 100,
      oldestEntry: sorted.length > 0 ? sorted[0].timestamp : undefined,
      newestEntry: sorted.length > 0 ? sorted[sorted.length - 1].timestamp : undefined,
      readyForTraining: entries.length >= 50,
      fineTunedVersions: [],
      currentModel: '',
    };
  }

  /** Export data in Alpaca format for fine-tuning. */
  async exportForTraining(
    outputPath: string,
  ): Promise<{ count: number; path: string }> {
    const entries = await this.readAllEntries();

    const alpaca: AlpacaEntry[] = entries.map((e) => ({
      instruction: e.prompt,
      output: e.response,
    }));

    await writeFile(outputPath, JSON.stringify(alpaca, null, 2), 'utf-8');

    return { count: alpaca.length, path: outputPath };
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private async readAllEntries(): Promise<TrainingEntry[]> {
    let raw: string;
    try {
      raw = await readFile(this.dataFilePath, 'utf-8');
    } catch {
      return [];
    }

    if (!raw.trim()) {
      return [];
    }

    const entries: TrainingEntry[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed) as TrainingEntry);
      } catch {
        // Skip malformed lines.
      }
    }
    return entries;
  }
}
