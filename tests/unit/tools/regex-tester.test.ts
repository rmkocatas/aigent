import { describe, it, expect } from 'vitest';
import { regexTesterHandler } from '../../../src/core/tools/builtins/regex-tester.js';
import type { ToolContext } from '../../../src/core/tools/registry.js';

const ctx: ToolContext = {
  workspaceDir: '/tmp', memoryDir: '/tmp/mem', conversationId: 'test', userId: 'u1', maxExecutionMs: 5000,
};

describe('regex_tester tool', () => {
  it('finds simple matches', async () => {
    const r = await regexTesterHandler({ pattern: '\\d+', input: 'abc 123 def 456' }, ctx);
    expect(r).toContain('2 match(es)');
    expect(r).toContain('123');
    expect(r).toContain('456');
  });

  it('reports no matches', async () => {
    const r = await regexTesterHandler({ pattern: '\\d+', input: 'no numbers here' }, ctx);
    expect(r).toContain('No matches');
  });

  it('captures groups', async () => {
    const r = await regexTesterHandler({ pattern: '(\\w+)@(\\w+)', input: 'user@host', flags: 'g' }, ctx);
    expect(r).toContain('Group 1: "user"');
    expect(r).toContain('Group 2: "host"');
  });

  it('respects flags', async () => {
    const r = await regexTesterHandler({ pattern: 'hello', input: 'Hello World', flags: 'gi' }, ctx);
    expect(r).toContain('1 match(es)');
  });

  it('without global flag returns first match only', async () => {
    const r = await regexTesterHandler({ pattern: '\\d+', input: '1 2 3', flags: '' }, ctx);
    expect(r).toContain('1 match(es)');
  });

  it('throws for invalid regex', async () => {
    await expect(regexTesterHandler({ pattern: '[invalid', input: 'test' }, ctx)).rejects.toThrow('Invalid regex');
  });

  it('throws for missing pattern', async () => {
    await expect(regexTesterHandler({ input: 'test' }, ctx)).rejects.toThrow('Missing pattern');
  });

  it('throws for missing input', async () => {
    await expect(regexTesterHandler({ pattern: '.' }, ctx)).rejects.toThrow('Missing input');
  });

  it('throws for pattern too long', async () => {
    await expect(regexTesterHandler({ pattern: 'a'.repeat(501), input: 'test' }, ctx)).rejects.toThrow('too long');
  });

  it('throws for input too long', async () => {
    await expect(regexTesterHandler({ pattern: '.', input: 'a'.repeat(10001) }, ctx)).rejects.toThrow('too long');
  });

  it('handles zero-length matches without infinite loop', async () => {
    const r = await regexTesterHandler({ pattern: '', input: 'abc', flags: 'g' }, ctx);
    expect(r).toContain('match(es)');
  });
});
