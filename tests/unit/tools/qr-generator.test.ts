import { describe, it, expect } from 'vitest';
import { qrGeneratorHandler } from '../../../src/core/tools/builtins/qr-generator.js';
import type { ToolContext } from '../../../src/core/tools/registry.js';

const ctx: ToolContext = {
  workspaceDir: '/tmp', memoryDir: '/tmp/mem', conversationId: 'test', userId: 'u1', maxExecutionMs: 5000,
};

describe('qr_generator tool', () => {
  it('generates QR code from text', async () => {
    const r = await qrGeneratorHandler({ text: 'Hello' }, ctx);
    expect(r).toBeTruthy();
    expect(r.length).toBeGreaterThan(10);
    // UTF-8 QR output contains block characters
    expect(r).toContain('█');
  });

  it('generates QR code from URL', async () => {
    const r = await qrGeneratorHandler({ text: 'https://example.com' }, ctx);
    expect(r).toContain('█');
  });

  it('accepts error correction levels', async () => {
    const rL = await qrGeneratorHandler({ text: 'test', error_correction: 'L' }, ctx);
    const rH = await qrGeneratorHandler({ text: 'test', error_correction: 'H' }, ctx);
    // Higher error correction = larger QR code
    expect(rH.length).toBeGreaterThanOrEqual(rL.length);
  });

  it('throws for missing text', async () => {
    await expect(qrGeneratorHandler({}, ctx)).rejects.toThrow('Missing text');
  });

  it('throws for text too long', async () => {
    await expect(qrGeneratorHandler({ text: 'x'.repeat(2049) }, ctx)).rejects.toThrow('too long');
  });

  it('handles special characters', async () => {
    const r = await qrGeneratorHandler({ text: 'hello world!@#$%' }, ctx);
    expect(r).toBeTruthy();
  });

  it('generates different QR for different inputs', async () => {
    const r1 = await qrGeneratorHandler({ text: 'AAA' }, ctx);
    const r2 = await qrGeneratorHandler({ text: 'ZZZ' }, ctx);
    expect(r1).not.toBe(r2);
  });
});
