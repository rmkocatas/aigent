import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  noteAddHandler, noteListHandler, noteSearchHandler, noteDeleteHandler,
} from '../../../src/core/tools/builtins/note-taker.js';
import type { ToolContext } from '../../../src/core/tools/registry.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let baseDir: string;
let ctx: ToolContext;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'openclaw-notes-'));
  ctx = {
    workspaceDir: join(baseDir, 'workspace'),
    memoryDir: join(baseDir, 'memory'),
    conversationId: 'test-conv',
    userId: 'user1',
    maxExecutionMs: 5000,
  };
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

describe('note_add tool', () => {
  it('adds a note', async () => {
    const r = await noteAddHandler({ content: 'Test note' }, ctx);
    expect(r).toContain('Note saved');
    expect(r).toContain('ID:');
  });

  it('adds a note with tags', async () => {
    const r = await noteAddHandler({ content: 'Tagged', tags: 'work,important' }, ctx);
    expect(r).toContain('work');
    expect(r).toContain('important');
  });

  it('throws for missing content', async () => {
    await expect(noteAddHandler({}, ctx)).rejects.toThrow('Missing content');
  });

  it('throws for content too long', async () => {
    await expect(noteAddHandler({ content: 'x'.repeat(5001) }, ctx)).rejects.toThrow('too long');
  });

  it('enforces max notes limit', async () => {
    for (let i = 0; i < 200; i++) {
      await noteAddHandler({ content: `Note ${i}` }, ctx);
    }
    await expect(noteAddHandler({ content: 'overflow' }, ctx)).rejects.toThrow('limit');
  });
});

describe('note_list tool', () => {
  it('returns empty when no notes', async () => {
    const r = await noteListHandler({}, ctx);
    expect(r).toContain('No notes');
  });

  it('lists all notes', async () => {
    await noteAddHandler({ content: 'First note' }, ctx);
    await noteAddHandler({ content: 'Second note' }, ctx);
    const r = await noteListHandler({}, ctx);
    expect(r).toContain('2 note(s)');
    expect(r).toContain('First note');
    expect(r).toContain('Second note');
  });

  it('filters by tag', async () => {
    await noteAddHandler({ content: 'Work stuff', tags: 'work' }, ctx);
    await noteAddHandler({ content: 'Personal', tags: 'personal' }, ctx);
    const r = await noteListHandler({ tag: 'work' }, ctx);
    expect(r).toContain('1 note(s)');
    expect(r).toContain('Work stuff');
  });
});

describe('note_search tool', () => {
  it('finds matching notes', async () => {
    await noteAddHandler({ content: 'Meeting with Alice at 3pm' }, ctx);
    await noteAddHandler({ content: 'Buy groceries' }, ctx);
    const r = await noteSearchHandler({ query: 'alice' }, ctx);
    expect(r).toContain('1 result(s)');
    expect(r).toContain('Meeting');
  });

  it('returns no results for non-matching query', async () => {
    await noteAddHandler({ content: 'Something' }, ctx);
    const r = await noteSearchHandler({ query: 'nonexistent' }, ctx);
    expect(r).toContain('No notes matching');
  });

  it('throws for missing query', async () => {
    await expect(noteSearchHandler({}, ctx)).rejects.toThrow('Missing query');
  });
});

describe('note_delete tool', () => {
  it('deletes a note by ID', async () => {
    const addResult = await noteAddHandler({ content: 'Delete me' }, ctx);
    const idMatch = addResult.match(/ID: ([a-f0-9]+)/);
    const noteId = idMatch![1];

    const r = await noteDeleteHandler({ note_id: noteId }, ctx);
    expect(r).toContain('deleted');

    const listResult = await noteListHandler({}, ctx);
    expect(listResult).toContain('No notes');
  });

  it('throws for non-existent note', async () => {
    await expect(noteDeleteHandler({ note_id: 'fake-id' }, ctx)).rejects.toThrow('not found');
  });

  it('throws for missing note_id', async () => {
    await expect(noteDeleteHandler({}, ctx)).rejects.toThrow('Missing');
  });
});
