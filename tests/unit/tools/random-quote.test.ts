import { describe, it, expect } from 'vitest';
import { randomQuoteHandler } from '../../../src/core/tools/builtins/random-quote.js';
import type { ToolContext } from '../../../src/core/tools/registry.js';

const ctx: ToolContext = {
  workspaceDir: '/tmp', memoryDir: '/tmp/mem', conversationId: 'test', userId: 'u1', maxExecutionMs: 5000,
};

describe('random_quote tool', () => {
  it('returns a quote with author', async () => {
    const r = await randomQuoteHandler({}, ctx);
    expect(r).toContain('"');
    expect(r).toContain('—');
  });

  it('filters by category', async () => {
    const r = await randomQuoteHandler({ category: 'tech' }, ctx);
    expect(r).toContain('"');
  });

  it('returns non-empty string', async () => {
    const r = await randomQuoteHandler({}, ctx);
    expect(r.length).toBeGreaterThan(10);
  });

  it('handles all categories', async () => {
    for (const cat of ['inspirational', 'funny', 'wisdom', 'tech']) {
      const r = await randomQuoteHandler({ category: cat }, ctx);
      expect(r).toContain('"');
    }
  });

  it('returns different quotes over multiple calls', async () => {
    const results = new Set<string>();
    for (let i = 0; i < 20; i++) {
      results.add(await randomQuoteHandler({}, ctx));
    }
    // With 44+ quotes, 20 calls should yield at least a few unique
    expect(results.size).toBeGreaterThan(1);
  });
});
