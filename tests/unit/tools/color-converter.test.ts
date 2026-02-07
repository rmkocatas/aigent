import { describe, it, expect } from 'vitest';
import { colorConverterHandler } from '../../../src/core/tools/builtins/color-converter.js';
import type { ToolContext } from '../../../src/core/tools/registry.js';

const ctx: ToolContext = {
  workspaceDir: '/tmp', memoryDir: '/tmp/mem', conversationId: 'test', userId: 'u1', maxExecutionMs: 5000,
};

describe('color_converter tool', () => {
  it('converts hex to rgb', async () => {
    const r = await colorConverterHandler({ color: '#FF5733', to_format: 'rgb' }, ctx);
    expect(r).toBe('rgb(255, 87, 51)');
  });

  it('converts hex to hsl', async () => {
    const r = await colorConverterHandler({ color: '#FF0000', to_format: 'hsl' }, ctx);
    expect(r).toContain('hsl(0,');
    expect(r).toContain('100%');
    expect(r).toContain('50%');
  });

  it('converts rgb to hex', async () => {
    const r = await colorConverterHandler({ color: 'rgb(255, 87, 51)', to_format: 'hex' }, ctx);
    expect(r).toBe('#FF5733');
  });

  it('converts rgb to hsl', async () => {
    const r = await colorConverterHandler({ color: 'rgb(0, 0, 0)', to_format: 'hsl' }, ctx);
    expect(r).toContain('hsl(0,');
    expect(r).toContain('0%');
  });

  it('converts hsl to hex', async () => {
    const r = await colorConverterHandler({ color: 'hsl(0, 100%, 50%)', to_format: 'hex' }, ctx);
    expect(r).toBe('#FF0000');
  });

  it('converts hsl to rgb', async () => {
    const r = await colorConverterHandler({ color: 'hsl(0, 100%, 50%)', to_format: 'rgb' }, ctx);
    expect(r).toBe('rgb(255, 0, 0)');
  });

  it('handles white', async () => {
    const r = await colorConverterHandler({ color: '#FFFFFF', to_format: 'rgb' }, ctx);
    expect(r).toBe('rgb(255, 255, 255)');
  });

  it('handles bare hex without #', async () => {
    const r = await colorConverterHandler({ color: 'FF5733', to_format: 'rgb' }, ctx);
    expect(r).toBe('rgb(255, 87, 51)');
  });

  it('throws for invalid hex', async () => {
    await expect(colorConverterHandler({ color: '#GGG', to_format: 'rgb' }, ctx)).rejects.toThrow();
  });

  it('throws for out-of-range RGB', async () => {
    await expect(colorConverterHandler({ color: 'rgb(300, 0, 0)', to_format: 'hex' }, ctx)).rejects.toThrow('0-255');
  });

  it('throws for missing color', async () => {
    await expect(colorConverterHandler({ to_format: 'hex' }, ctx)).rejects.toThrow('Missing color');
  });
});
