import { describe, it, expect } from 'vitest';
import { timezoneConverterHandler } from '../../../src/core/tools/builtins/timezone-converter.js';
import type { ToolContext } from '../../../src/core/tools/registry.js';

const ctx: ToolContext = {
  workspaceDir: '/tmp', memoryDir: '/tmp/mem', conversationId: 'test', userId: 'u1', maxExecutionMs: 5000,
};

describe('timezone_converter tool', () => {
  it('converts ISO time between zones', async () => {
    const r = await timezoneConverterHandler({
      time: '2024-06-15T14:30:00', from_timezone: 'America/New_York', to_timezone: 'Europe/London',
    }, ctx);
    expect(r).toContain('→');
    // Output contains timezone abbreviation or time info
    expect(r.length).toBeGreaterThan(10);
  });

  it('converts HH:MM format', async () => {
    const r = await timezoneConverterHandler({
      time: '09:00', from_timezone: 'UTC', to_timezone: 'Asia/Tokyo',
    }, ctx);
    expect(r).toContain('→');
  });

  it('handles same timezone', async () => {
    const r = await timezoneConverterHandler({
      time: '12:00', from_timezone: 'UTC', to_timezone: 'UTC',
    }, ctx);
    expect(r).toContain('→');
  });

  it('throws for invalid source timezone', async () => {
    await expect(timezoneConverterHandler({
      time: '12:00', from_timezone: 'Invalid/Zone', to_timezone: 'UTC',
    }, ctx)).rejects.toThrow('Invalid source timezone');
  });

  it('throws for invalid target timezone', async () => {
    await expect(timezoneConverterHandler({
      time: '12:00', from_timezone: 'UTC', to_timezone: 'Nowhere/City',
    }, ctx)).rejects.toThrow('Invalid target timezone');
  });

  it('throws for invalid time format', async () => {
    await expect(timezoneConverterHandler({
      time: 'not-a-time', from_timezone: 'UTC', to_timezone: 'UTC',
    }, ctx)).rejects.toThrow('Invalid time');
  });

  it('throws for missing time', async () => {
    await expect(timezoneConverterHandler({
      from_timezone: 'UTC', to_timezone: 'UTC',
    }, ctx)).rejects.toThrow('Missing time');
  });

  it('throws for missing from_timezone', async () => {
    await expect(timezoneConverterHandler({
      time: '12:00', to_timezone: 'UTC',
    }, ctx)).rejects.toThrow('Missing from_timezone');
  });

  it('returns formatted output with arrow', async () => {
    const r = await timezoneConverterHandler({
      time: '2024-01-01T00:00:00', from_timezone: 'UTC', to_timezone: 'America/Los_Angeles',
    }, ctx);
    const lines = r.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('→');
  });
});
