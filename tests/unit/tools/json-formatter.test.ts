import { describe, it, expect } from 'vitest';
import { jsonFormatterHandler } from '../../../src/core/tools/builtins/json-formatter.js';
import type { ToolContext } from '../../../src/core/tools/registry.js';

const ctx: ToolContext = {
  workspaceDir: '/tmp', memoryDir: '/tmp/mem', conversationId: 'test', userId: 'u1', maxExecutionMs: 5000,
};

describe('json_formatter tool', () => {
  it('prettifies JSON', async () => {
    const r = await jsonFormatterHandler({ json: '{"a":1,"b":2}', operation: 'prettify' }, ctx);
    expect(r).toBe('{\n  "a": 1,\n  "b": 2\n}');
  });

  it('prettifies with custom indent', async () => {
    const r = await jsonFormatterHandler({ json: '{"a":1}', operation: 'prettify', indent: 4 }, ctx);
    expect(r).toBe('{\n    "a": 1\n}');
  });

  it('minifies JSON', async () => {
    const r = await jsonFormatterHandler({ json: '{\n  "a": 1,\n  "b": 2\n}', operation: 'minify' }, ctx);
    expect(r).toBe('{"a":1,"b":2}');
  });

  it('validates valid JSON', async () => {
    const r = await jsonFormatterHandler({ json: '{"valid": true}', operation: 'validate' }, ctx);
    expect(r).toContain('Valid');
  });

  it('validates invalid JSON', async () => {
    const r = await jsonFormatterHandler({ json: '{invalid}', operation: 'validate' }, ctx);
    expect(r).toContain('Invalid');
  });

  it('throws when prettifying invalid JSON', async () => {
    await expect(jsonFormatterHandler({ json: 'not json', operation: 'prettify' }, ctx)).rejects.toThrow('Invalid JSON');
  });

  it('handles arrays', async () => {
    const r = await jsonFormatterHandler({ json: '[1,2,3]', operation: 'prettify' }, ctx);
    expect(r).toContain('[\n');
  });

  it('throws for missing json input', async () => {
    await expect(jsonFormatterHandler({ operation: 'prettify' }, ctx)).rejects.toThrow('Missing');
  });

  it('throws for unknown operation', async () => {
    await expect(jsonFormatterHandler({ json: '{}', operation: 'compress' }, ctx)).rejects.toThrow('Unknown operation');
  });
});
