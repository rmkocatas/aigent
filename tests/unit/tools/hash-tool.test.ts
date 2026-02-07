import { describe, it, expect } from 'vitest';
import { hashToolHandler } from '../../../src/core/tools/builtins/hash-tool.js';
import type { ToolContext } from '../../../src/core/tools/registry.js';

const ctx: ToolContext = {
  workspaceDir: '/tmp', memoryDir: '/tmp/mem', conversationId: 'test', userId: 'u1', maxExecutionMs: 5000,
};

describe('hash_tool', () => {
  it('computes md5', async () => {
    const r = await hashToolHandler({ input: 'hello', algorithm: 'md5' }, ctx);
    expect(r).toBe('MD5: 5d41402abc4b2a76b9719d911017c592');
  });

  it('computes sha256', async () => {
    const r = await hashToolHandler({ input: 'hello', algorithm: 'sha256' }, ctx);
    expect(r).toBe('SHA256: 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('computes sha512', async () => {
    const r = await hashToolHandler({ input: 'hello', algorithm: 'sha512' }, ctx);
    expect(r).toContain('SHA512:');
    expect(r.split(': ')[1]).toHaveLength(128);
  });

  it('hashes empty string', async () => {
    const r = await hashToolHandler({ input: '', algorithm: 'md5' }, ctx);
    expect(r).toBe('MD5: d41d8cd98f00b204e9800998ecf8427e');
  });

  it('throws for unsupported algorithm', async () => {
    await expect(hashToolHandler({ input: 'test', algorithm: 'sha1' }, ctx)).rejects.toThrow('Unsupported algorithm');
  });

  it('throws for missing input', async () => {
    await expect(hashToolHandler({ algorithm: 'md5' }, ctx)).rejects.toThrow('Missing input');
  });

  it('produces deterministic output', async () => {
    const a = await hashToolHandler({ input: 'test', algorithm: 'sha256' }, ctx);
    const b = await hashToolHandler({ input: 'test', algorithm: 'sha256' }, ctx);
    expect(a).toBe(b);
  });

  it('different inputs produce different hashes', async () => {
    const a = await hashToolHandler({ input: 'hello', algorithm: 'sha256' }, ctx);
    const b = await hashToolHandler({ input: 'world', algorithm: 'sha256' }, ctx);
    expect(a).not.toBe(b);
  });

  it('throws for input exceeding 1MB', async () => {
    const big = 'x'.repeat(1_048_577);
    await expect(hashToolHandler({ input: big, algorithm: 'md5' }, ctx)).rejects.toThrow('too large');
  });
});
