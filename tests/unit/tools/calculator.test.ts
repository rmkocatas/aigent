import { describe, it, expect } from 'vitest';
import { calculatorHandler } from '../../../src/core/tools/builtins/calculator.js';
import type { ToolContext } from '../../../src/core/tools/registry.js';

const context: ToolContext = {
  workspaceDir: '/tmp',
  memoryDir: '/tmp/memory',
  conversationId: 'test',
  userId: 'test-user',
  maxExecutionMs: 5000,
};

describe('calculator tool', () => {
  it('evaluates basic arithmetic', async () => {
    expect(await calculatorHandler({ expression: '2 + 3' }, context)).toBe('5');
    expect(await calculatorHandler({ expression: '10 * 5' }, context)).toBe('50');
    expect(await calculatorHandler({ expression: '100 / 4' }, context)).toBe('25');
  });

  it('evaluates exponentiation', async () => {
    expect(await calculatorHandler({ expression: '2 ** 10' }, context)).toBe('1024');
  });

  it('evaluates math functions', async () => {
    expect(await calculatorHandler({ expression: 'sqrt(144)' }, context)).toBe('12');
    expect(await calculatorHandler({ expression: 'abs(-5)' }, context)).toBe('5');
  });

  it('uses math constants', async () => {
    const pi = await calculatorHandler({ expression: 'PI' }, context);
    expect(parseFloat(pi)).toBeCloseTo(Math.PI);
  });

  it('evaluates complex expressions', async () => {
    const result = await calculatorHandler({ expression: '(2 + 3) * 4 - 1' }, context);
    expect(result).toBe('19');
  });

  it('rejects dangerous keywords', async () => {
    await expect(
      calculatorHandler({ expression: 'eval("1+1")' }, context),
    ).rejects.toThrow('disallowed');

    await expect(
      calculatorHandler({ expression: 'process.exit()' }, context),
    ).rejects.toThrow('disallowed');
  });

  it('rejects assignment', async () => {
    await expect(
      calculatorHandler({ expression: 'x = 5' }, context),
    ).rejects.toThrow('disallowed');
  });

  it('rejects missing expression', async () => {
    await expect(
      calculatorHandler({ expression: '' }, context),
    ).rejects.toThrow('Missing expression');
  });

  it('rejects overly long expressions', async () => {
    await expect(
      calculatorHandler({ expression: '1+'.repeat(300) }, context),
    ).rejects.toThrow('too long');
  });
});
