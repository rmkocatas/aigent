import { describe, it, expect } from 'vitest';
import { passwordGeneratorHandler } from '../../../src/core/tools/builtins/password-generator.js';
import type { ToolContext } from '../../../src/core/tools/registry.js';

const ctx: ToolContext = {
  workspaceDir: '/tmp', memoryDir: '/tmp/mem', conversationId: 'test', userId: 'u1', maxExecutionMs: 5000,
};

describe('password_generator tool', () => {
  it('generates password of default length 16', async () => {
    const r = await passwordGeneratorHandler({}, ctx);
    expect(r).toHaveLength(16);
  });

  it('generates password of custom length', async () => {
    const r = await passwordGeneratorHandler({ length: 32 }, ctx);
    expect(r).toHaveLength(32);
  });

  it('includes uppercase when enabled', async () => {
    const r = await passwordGeneratorHandler({ length: 64, include_uppercase: 'true' }, ctx);
    expect(/[A-Z]/.test(r)).toBe(true);
  });

  it('includes numbers when enabled', async () => {
    const r = await passwordGeneratorHandler({ length: 64, include_numbers: 'true' }, ctx);
    expect(/[0-9]/.test(r)).toBe(true);
  });

  it('includes symbols when enabled', async () => {
    const r = await passwordGeneratorHandler({ length: 64, include_symbols: 'true' }, ctx);
    expect(/[!@#$%^&*()\-_=+\[\]{}|;:,.<>?]/.test(r)).toBe(true);
  });

  it('lowercase only when all extras disabled', async () => {
    const r = await passwordGeneratorHandler({
      length: 100, include_uppercase: 'false', include_numbers: 'false', include_symbols: 'false',
    }, ctx);
    expect(r).toMatch(/^[a-z]+$/);
  });

  it('throws for length below 4', async () => {
    await expect(passwordGeneratorHandler({ length: 3 }, ctx)).rejects.toThrow('between 4 and 256');
  });

  it('throws for length above 256', async () => {
    await expect(passwordGeneratorHandler({ length: 300 }, ctx)).rejects.toThrow('between 4 and 256');
  });

  it('generates unique passwords each call', async () => {
    const a = await passwordGeneratorHandler({ length: 32 }, ctx);
    const b = await passwordGeneratorHandler({ length: 32 }, ctx);
    expect(a).not.toBe(b);
  });
});
