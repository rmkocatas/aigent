import { describe, it, expect } from 'vitest';
import { datetimeHandler } from '../../../src/core/tools/builtins/datetime.js';
import type { ToolContext } from '../../../src/core/tools/registry.js';

const context: ToolContext = {
  workspaceDir: '/tmp',
  memoryDir: '/tmp/memory',
  conversationId: 'test',
  userId: 'test-user',
  maxExecutionMs: 5000,
};

describe('current_datetime tool', () => {
  it('returns current date and time', async () => {
    const result = await datetimeHandler({}, context);
    expect(result).toBeTruthy();
    // Should contain a year
    expect(result).toMatch(/\d{4}/);
  });

  it('accepts timezone parameter', async () => {
    const result = await datetimeHandler({ timezone: 'America/New_York' }, context);
    expect(result).toBeTruthy();
    expect(result).toMatch(/(EST|EDT)/);
  });

  it('handles UTC timezone', async () => {
    const result = await datetimeHandler({ timezone: 'UTC' }, context);
    expect(result).toBeTruthy();
    expect(result).toContain('UTC');
  });

  it('gracefully handles invalid timezone', async () => {
    const result = await datetimeHandler({ timezone: 'Invalid/Zone' }, context);
    // Should still return something (falls back to local)
    expect(result).toBeTruthy();
    expect(result).toMatch(/\d{4}/);
  });
});
