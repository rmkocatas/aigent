import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TrainingDataStore } from '../../../src/core/training/data-collector.js';

describe('TrainingDataStore', () => {
  let dataDir: string;
  let store: TrainingDataStore;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'openclaw-test-'));
    store = new TrainingDataStore(dataDir);
    await store.init();
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('should initialize data directory and empty JSONL file', async () => {
    const content = await readFile(join(dataDir, 'data.jsonl'), 'utf-8');
    expect(content).toBe('');
  });

  it('should add an entry with auto-generated id and timestamp', async () => {
    const entry = await store.addEntry({
      prompt: 'What is TypeScript?',
      response: 'TypeScript is a typed superset of JavaScript.',
      provider: 'anthropic',
      model: 'claude-opus-4-6',
    });

    expect(entry.id).toBeDefined();
    expect(entry.timestamp).toBeDefined();
    expect(entry.prompt).toBe('What is TypeScript?');
    expect(entry.provider).toBe('anthropic');
  });

  it('should persist entries to JSONL file', async () => {
    await store.addEntry({
      prompt: 'Hello',
      response: 'Hi there',
      provider: 'openai',
      model: 'gpt-4o',
    });

    const raw = await readFile(join(dataDir, 'data.jsonl'), 'utf-8');
    const lines = raw.trim().split('\n');
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.prompt).toBe('Hello');
  });

  it('should retrieve all entries', async () => {
    await store.addEntry({ prompt: 'p1', response: 'r1', provider: 'anthropic', model: 'm1' });
    await store.addEntry({ prompt: 'p2', response: 'r2', provider: 'openai', model: 'm2' });

    const entries = await store.getEntries();
    expect(entries).toHaveLength(2);
  });

  it('should filter entries by provider', async () => {
    await store.addEntry({ prompt: 'p1', response: 'r1', provider: 'anthropic', model: 'm1' });
    await store.addEntry({ prompt: 'p2', response: 'r2', provider: 'openai', model: 'm2' });
    await store.addEntry({ prompt: 'p3', response: 'r3', provider: 'anthropic', model: 'm3' });

    const filtered = await store.getEntries({ provider: 'anthropic' });
    expect(filtered).toHaveLength(2);
    expect(filtered.every((e) => e.provider === 'anthropic')).toBe(true);
  });

  it('should support limit and offset', async () => {
    for (let i = 0; i < 5; i++) {
      await store.addEntry({ prompt: `p${i}`, response: `r${i}`, provider: 'anthropic', model: 'm' });
    }

    const page = await store.getEntries({ offset: 2, limit: 2 });
    expect(page).toHaveLength(2);
    expect(page[0].prompt).toBe('p2');
    expect(page[1].prompt).toBe('p3');
  });

  it('should return correct stats', async () => {
    await store.addEntry({ prompt: 'p1', response: 'r1', provider: 'anthropic', model: 'm1' });
    await store.addEntry({ prompt: 'p2', response: 'r2', provider: 'openai', model: 'm2' });

    const stats = await store.getStats();
    expect(stats.totalEntries).toBe(2);
    expect(stats.dataFileSizeMB).toBeGreaterThanOrEqual(0);
    expect(stats.oldestEntry).toBeDefined();
    expect(stats.newestEntry).toBeDefined();
    expect(stats.readyForTraining).toBe(false); // need 50+
  });

  it('should export in Alpaca format', async () => {
    await store.addEntry({ prompt: 'What is X?', response: 'X is Y.', provider: 'anthropic', model: 'm' });

    const outputPath = join(dataDir, 'export.json');
    const result = await store.exportForTraining(outputPath);

    expect(result.count).toBe(1);
    const content = JSON.parse(await readFile(outputPath, 'utf-8'));
    expect(content[0].instruction).toBe('What is X?');
    expect(content[0].output).toBe('X is Y.');
  });

  it('should handle empty file gracefully', async () => {
    const entries = await store.getEntries();
    expect(entries).toHaveLength(0);

    const stats = await store.getStats();
    expect(stats.totalEntries).toBe(0);
  });
});
