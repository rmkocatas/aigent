import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionStore } from '../../../src/core/gateway/session-store.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';

describe('SessionStore', () => {
  let store: SessionStore;

  beforeEach(() => {
    store = new SessionStore(30, 100);
  });

  afterEach(() => {
    store.stop();
  });

  it('creates a new conversation', async () => {
    const conv = await store.getOrCreate();
    expect(conv.id).toBeTruthy();
    expect(conv.messages).toEqual([]);
  });

  it('returns existing conversation by ID', async () => {
    const conv = await store.getOrCreate();
    const same = await store.getOrCreate(conv.id);
    expect(same.id).toBe(conv.id);
  });

  it('creates new conversation for unknown ID', async () => {
    const conv = await store.getOrCreate('nonexistent');
    expect(conv.id).toBe('nonexistent');
  });

  it('adds messages to a conversation', async () => {
    const conv = await store.getOrCreate();
    store.addMessage(conv.id, {
      role: 'user',
      content: 'Hello',
      timestamp: new Date().toISOString(),
    });
    const updated = await store.getOrCreate(conv.id);
    expect(updated.messages).toHaveLength(1);
    expect(updated.messages[0].content).toBe('Hello');
  });

  it('updates lastActivity on message add', async () => {
    const conv = await store.getOrCreate();
    const before = conv.lastActivity;
    await new Promise((r) => setTimeout(r, 10));
    store.addMessage(conv.id, {
      role: 'user',
      content: 'test',
      timestamp: new Date().toISOString(),
    });
    const after = (await store.getOrCreate(conv.id)).lastActivity;
    expect(after).not.toBe(before);
  });

  it('evicts oldest when max concurrent exceeded', async () => {
    const maxStore = new SessionStore(30, 2);
    const c1 = await maxStore.getOrCreate();
    await maxStore.getOrCreate();
    // Third should evict first
    await maxStore.getOrCreate();
    const c1Again = await maxStore.getOrCreate(c1.id);
    // c1 was evicted, so getOrCreate creates a fresh one
    expect(c1Again.messages).toEqual([]);
    maxStore.stop();
  });

  it('start and stop do not throw', () => {
    expect(() => store.start()).not.toThrow();
    expect(() => store.stop()).not.toThrow();
  });

  it('getConversation returns undefined for unknown ID', () => {
    const conv = store.getConversation('does-not-exist');
    expect(conv).toBeUndefined();
  });

  it('tracks active count', async () => {
    await store.getOrCreate();
    await store.getOrCreate();
    expect(store.activeCount).toBe(2);
  });

  it('silently ignores message for non-existent conversation', () => {
    expect(() =>
      store.addMessage('nope', {
        role: 'user',
        content: 'test',
        timestamp: new Date().toISOString(),
      }),
    ).not.toThrow();
  });
});

describe('SessionStore persistence', () => {
  let tmpDir: string;
  let store: SessionStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'openclaw-session-'));
    store = new SessionStore(30, 100, tmpDir);
  });

  afterEach(async () => {
    store.stop();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('saves conversation to disk on create', async () => {
    const conv = await store.getOrCreate('persist-test');
    // Give fire-and-forget save a moment
    await new Promise((r) => setTimeout(r, 50));
    const files = await readdir(tmpDir);
    expect(files).toContain('persist-test.json');
    const raw = await readFile(join(tmpDir, 'persist-test.json'), 'utf-8');
    const data = JSON.parse(raw);
    expect(data.id).toBe('persist-test');
    expect(data.messages).toEqual([]);
  });

  it('saves messages to disk', async () => {
    await store.getOrCreate('msg-test');
    store.addMessage('msg-test', {
      role: 'user',
      content: 'Hello!',
      timestamp: new Date().toISOString(),
    });
    await new Promise((r) => setTimeout(r, 50));
    const raw = await readFile(join(tmpDir, 'msg-test.json'), 'utf-8');
    const data = JSON.parse(raw);
    expect(data.messages).toHaveLength(1);
    expect(data.messages[0].content).toBe('Hello!');
  });

  it('loads conversation from disk after eviction', async () => {
    const smallStore = new SessionStore(30, 1, tmpDir);
    const conv = await smallStore.getOrCreate('first');
    smallStore.addMessage('first', {
      role: 'user',
      content: 'Persisted',
      timestamp: new Date().toISOString(),
    });
    await new Promise((r) => setTimeout(r, 50));

    // Creating second evicts first from memory
    await smallStore.getOrCreate('second');
    expect(smallStore.getConversation('first')).toBeUndefined();

    // Re-access loads from disk
    const reloaded = await smallStore.getOrCreate('first');
    expect(reloaded.messages).toHaveLength(1);
    expect(reloaded.messages[0].content).toBe('Persisted');
    smallStore.stop();
  });

  it('loads from disk with fresh store instance', async () => {
    await store.getOrCreate('fresh-test');
    store.addMessage('fresh-test', {
      role: 'user',
      content: 'Survive restart',
      timestamp: new Date().toISOString(),
    });
    await new Promise((r) => setTimeout(r, 50));
    store.stop();

    // New store instance pointing at same dir
    const store2 = new SessionStore(30, 100, tmpDir);
    const reloaded = await store2.getOrCreate('fresh-test');
    expect(reloaded.messages).toHaveLength(1);
    expect(reloaded.messages[0].content).toBe('Survive restart');
    store2.stop();
  });

  it('reset clears messages on disk', async () => {
    await store.getOrCreate('reset-test');
    store.addMessage('reset-test', {
      role: 'user',
      content: 'Gone',
      timestamp: new Date().toISOString(),
    });
    await new Promise((r) => setTimeout(r, 50));

    store.reset('reset-test');
    await new Promise((r) => setTimeout(r, 50));

    const raw = await readFile(join(tmpDir, 'reset-test.json'), 'utf-8');
    const data = JSON.parse(raw);
    expect(data.messages).toEqual([]);
  });

  it('sanitizes conversation IDs for filenames', async () => {
    await store.getOrCreate('telegram:12345');
    await new Promise((r) => setTimeout(r, 50));
    const files = await readdir(tmpDir);
    // : is replaced with _ for filesystem safety
    expect(files).toContain('telegram_12345.json');
  });

  it('works without persistence (null persistDir)', async () => {
    const memStore = new SessionStore(30, 100, null);
    const conv = await memStore.getOrCreate('mem-only');
    memStore.addMessage('mem-only', {
      role: 'user',
      content: 'In memory only',
      timestamp: new Date().toISOString(),
    });
    expect(conv.messages).toHaveLength(1);
    const files = await readdir(tmpDir);
    expect(files).not.toContain('mem-only.json');
    memStore.stop();
  });
});
