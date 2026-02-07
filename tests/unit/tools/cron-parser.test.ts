import { describe, it, expect } from 'vitest';
import { cronParserHandler } from '../../../src/core/tools/builtins/cron-parser.js';
import type { ToolContext } from '../../../src/core/tools/registry.js';

const ctx: ToolContext = {
  workspaceDir: '/tmp', memoryDir: '/tmp/mem', conversationId: 'test', userId: 'u1', maxExecutionMs: 5000,
};

describe('cron_parser tool', () => {
  it('parses every minute', async () => {
    const r = await cronParserHandler({ expression: '* * * * *' }, ctx);
    expect(r).toContain('every minute');
  });

  it('parses every 5 minutes', async () => {
    const r = await cronParserHandler({ expression: '*/5 * * * *' }, ctx);
    expect(r).toContain('every 5 minute');
  });

  it('parses specific time', async () => {
    const r = await cronParserHandler({ expression: '30 14 * * *' }, ctx);
    expect(r).toContain('14:30');
  });

  it('parses midnight daily', async () => {
    const r = await cronParserHandler({ expression: '0 0 * * *' }, ctx);
    expect(r).toContain('00:00');
  });

  it('parses @daily shortcut', async () => {
    const r = await cronParserHandler({ expression: '@daily' }, ctx);
    expect(r).toContain('00:00');
  });

  it('parses @hourly shortcut', async () => {
    const r = await cronParserHandler({ expression: '@hourly' }, ctx);
    expect(r).toContain('minute');
  });

  it('parses day of week', async () => {
    const r = await cronParserHandler({ expression: '0 9 * * 1' }, ctx);
    expect(r).toContain('Monday');
  });

  it('parses month', async () => {
    const r = await cronParserHandler({ expression: '0 0 1 1 *' }, ctx);
    expect(r).toContain('January');
  });

  it('parses range', async () => {
    const r = await cronParserHandler({ expression: '0 9-17 * * *' }, ctx);
    expect(r).toContain('through');
  });

  it('throws for invalid field count', async () => {
    await expect(cronParserHandler({ expression: '* * *' }, ctx)).rejects.toThrow('Expected 5 fields');
  });

  it('throws for unknown shortcut', async () => {
    await expect(cronParserHandler({ expression: '@never' }, ctx)).rejects.toThrow('Unknown shortcut');
  });
});
