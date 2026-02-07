import { describe, it, expect } from 'vitest';
import { uuidGeneratorHandler } from '../../../src/core/tools/builtins/uuid-generator.js';
import type { ToolContext } from '../../../src/core/tools/registry.js';

const ctx: ToolContext = {
  workspaceDir: '/tmp', memoryDir: '/tmp/mem', conversationId: 'test', userId: 'u1', maxExecutionMs: 5000,
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuid_generator tool', () => {
  it('generates a single UUID by default', async () => {
    const r = await uuidGeneratorHandler({}, ctx);
    expect(r.split('\n')).toHaveLength(1);
    expect(r).toMatch(UUID_REGEX);
  });

  it('generates multiple UUIDs', async () => {
    const r = await uuidGeneratorHandler({ count: 5 }, ctx);
    const uuids = r.split('\n');
    expect(uuids).toHaveLength(5);
    for (const uuid of uuids) {
      expect(uuid).toMatch(UUID_REGEX);
    }
  });

  it('generates unique UUIDs', async () => {
    const r = await uuidGeneratorHandler({ count: 10 }, ctx);
    const uuids = r.split('\n');
    expect(new Set(uuids).size).toBe(10);
  });

  it('throws for count below 1', async () => {
    await expect(uuidGeneratorHandler({ count: 0 }, ctx)).rejects.toThrow('between 1 and 100');
  });

  it('throws for count above 100', async () => {
    await expect(uuidGeneratorHandler({ count: 101 }, ctx)).rejects.toThrow('between 1 and 100');
  });

  it('throws for non-integer count', async () => {
    await expect(uuidGeneratorHandler({ count: 1.5 }, ctx)).rejects.toThrow('integer');
  });

  it('generates exactly 100 UUIDs at max', async () => {
    const r = await uuidGeneratorHandler({ count: 100 }, ctx);
    expect(r.split('\n')).toHaveLength(100);
  });
});
