import { describe, it, expect } from 'vitest';
import { base64CodecHandler } from '../../../src/core/tools/builtins/base64-codec.js';
import type { ToolContext } from '../../../src/core/tools/registry.js';

const ctx: ToolContext = {
  workspaceDir: '/tmp', memoryDir: '/tmp/mem', conversationId: 'test', userId: 'u1', maxExecutionMs: 5000,
};

describe('base64_codec tool', () => {
  it('encodes to base64', async () => {
    const r = await base64CodecHandler({ input: 'Hello, World!', operation: 'base64_encode' }, ctx);
    expect(r).toBe('SGVsbG8sIFdvcmxkIQ==');
  });

  it('decodes from base64', async () => {
    const r = await base64CodecHandler({ input: 'SGVsbG8sIFdvcmxkIQ==', operation: 'base64_decode' }, ctx);
    expect(r).toBe('Hello, World!');
  });

  it('URL encodes', async () => {
    const r = await base64CodecHandler({ input: 'hello world & more', operation: 'url_encode' }, ctx);
    expect(r).toBe('hello%20world%20%26%20more');
  });

  it('URL decodes', async () => {
    const r = await base64CodecHandler({ input: 'hello%20world%20%26%20more', operation: 'url_decode' }, ctx);
    expect(r).toBe('hello world & more');
  });

  it('handles unicode in base64', async () => {
    const r = await base64CodecHandler({ input: 'Привет', operation: 'base64_encode' }, ctx);
    const decoded = await base64CodecHandler({ input: r, operation: 'base64_decode' }, ctx);
    expect(decoded).toBe('Привет');
  });

  it('handles empty string', async () => {
    const r = await base64CodecHandler({ input: '', operation: 'base64_encode' }, ctx);
    expect(r).toBe('');
  });

  it('throws for missing input', async () => {
    await expect(base64CodecHandler({ operation: 'base64_encode' }, ctx)).rejects.toThrow('Missing input');
  });

  it('throws for unknown operation', async () => {
    await expect(base64CodecHandler({ input: 'test', operation: 'hex_encode' }, ctx)).rejects.toThrow('Unknown operation');
  });

  it('URL encodes special chars', async () => {
    const r = await base64CodecHandler({ input: 'a=1&b=2', operation: 'url_encode' }, ctx);
    expect(r).toBe('a%3D1%26b%3D2');
  });
});
