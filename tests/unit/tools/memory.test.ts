import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { memoryReadHandler, memoryWriteHandler } from '../../../src/core/tools/builtins/memory.js';
import type { ToolContext } from '../../../src/core/tools/registry.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let memoryDir: string;
let context: ToolContext;

beforeEach(async () => {
  memoryDir = await mkdtemp(join(tmpdir(), 'openclaw-mem-'));
  context = {
    workspaceDir: '/tmp',
    memoryDir,
    conversationId: 'test-conv',
    userId: 'telegram:12345',
    maxExecutionMs: 5000,
  };
});

afterEach(async () => {
  await rm(memoryDir, { recursive: true, force: true });
});

describe('memory_write tool', () => {
  it('stores a value', async () => {
    const result = await memoryWriteHandler(
      { key: 'name', value: 'Alice' },
      context,
    );
    expect(result).toContain('Stored');
    expect(result).toContain('name');
  });

  it('rejects missing key', async () => {
    await expect(
      memoryWriteHandler({ value: 'test' }, context),
    ).rejects.toThrow('Missing key');
  });
});

describe('memory_read tool', () => {
  it('reads stored value', async () => {
    await memoryWriteHandler({ key: 'color', value: 'blue' }, context);
    const result = await memoryReadHandler({ key: 'color' }, context);
    expect(result).toBe('blue');
  });

  it('returns message for missing key', async () => {
    const result = await memoryReadHandler({ key: 'unknown' }, context);
    expect(result).toContain('No value');
  });

  it('persists across calls', async () => {
    await memoryWriteHandler({ key: 'k1', value: 'v1' }, context);
    await memoryWriteHandler({ key: 'k2', value: 'v2' }, context);

    expect(await memoryReadHandler({ key: 'k1' }, context)).toBe('v1');
    expect(await memoryReadHandler({ key: 'k2' }, context)).toBe('v2');
  });

  it('overwrites existing values', async () => {
    await memoryWriteHandler({ key: 'mood', value: 'happy' }, context);
    await memoryWriteHandler({ key: 'mood', value: 'excited' }, context);
    const result = await memoryReadHandler({ key: 'mood' }, context);
    expect(result).toBe('excited');
  });
});
