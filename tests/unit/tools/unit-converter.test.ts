import { describe, it, expect } from 'vitest';
import { unitConverterHandler } from '../../../src/core/tools/builtins/unit-converter.js';
import type { ToolContext } from '../../../src/core/tools/registry.js';

const ctx: ToolContext = {
  workspaceDir: '/tmp', memoryDir: '/tmp/mem', conversationId: 'test', userId: 'u1', maxExecutionMs: 5000,
};

describe('unit_converter tool', () => {
  it('converts km to mi', async () => {
    const r = await unitConverterHandler({ value: 10, from_unit: 'km', to_unit: 'mi' }, ctx);
    expect(r).toContain('6.21');
  });

  it('converts lb to kg', async () => {
    const r = await unitConverterHandler({ value: 100, from_unit: 'lb', to_unit: 'kg' }, ctx);
    expect(r).toContain('45.3592');
  });

  it('converts celsius to fahrenheit', async () => {
    const r = await unitConverterHandler({ value: 100, from_unit: 'c', to_unit: 'f' }, ctx);
    expect(r).toContain('212');
  });

  it('converts fahrenheit to celsius', async () => {
    const r = await unitConverterHandler({ value: 32, from_unit: 'f', to_unit: 'c' }, ctx);
    expect(r).toContain('0');
  });

  it('converts gb to mb', async () => {
    const r = await unitConverterHandler({ value: 1, from_unit: 'gb', to_unit: 'mb' }, ctx);
    expect(r).toContain('1024');
  });

  it('converts hours to seconds', async () => {
    const r = await unitConverterHandler({ value: 1, from_unit: 'h', to_unit: 's' }, ctx);
    expect(r).toContain('3600');
  });

  it('handles same unit', async () => {
    const r = await unitConverterHandler({ value: 42, from_unit: 'm', to_unit: 'm' }, ctx);
    expect(r).toContain('42 m = 42 m');
  });

  it('converts m/s to km/h', async () => {
    const r = await unitConverterHandler({ value: 10, from_unit: 'm/s', to_unit: 'km/h' }, ctx);
    expect(r).toContain('36');
  });

  it('converts m2 to ft2', async () => {
    const r = await unitConverterHandler({ value: 1, from_unit: 'm2', to_unit: 'ft2' }, ctx);
    expect(r).toContain('10.76');
  });

  it('converts l to gal', async () => {
    const r = await unitConverterHandler({ value: 3.785, from_unit: 'l', to_unit: 'gal' }, ctx);
    expect(r).toContain('1');
  });

  it('throws for unknown unit', async () => {
    await expect(unitConverterHandler({ value: 1, from_unit: 'foo', to_unit: 'm' }, ctx)).rejects.toThrow('Unknown unit');
  });

  it('throws for cross-category conversion', async () => {
    await expect(unitConverterHandler({ value: 1, from_unit: 'km', to_unit: 'kg' }, ctx)).rejects.toThrow('Cannot convert');
  });

  it('converts kelvin to celsius', async () => {
    const r = await unitConverterHandler({ value: 273.15, from_unit: 'k', to_unit: 'c' }, ctx);
    expect(r).toContain('0');
  });

  it('handles zero value', async () => {
    const r = await unitConverterHandler({ value: 0, from_unit: 'km', to_unit: 'mi' }, ctx);
    expect(r).toContain('0');
  });

  it('handles negative temperature', async () => {
    const r = await unitConverterHandler({ value: -40, from_unit: 'c', to_unit: 'f' }, ctx);
    expect(r).toContain('-40');
  });

  it('throws for invalid value', async () => {
    await expect(unitConverterHandler({ value: 'abc', from_unit: 'km', to_unit: 'mi' }, ctx)).rejects.toThrow('invalid value');
  });
});
