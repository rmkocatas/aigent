import { describe, it, expect } from 'vitest';
import { estimateTokens, estimateMessageTokens } from '../../../src/core/gateway/token-estimator.js';

describe('estimateTokens', () => {
  it('estimates tokens for a plain string (~4 chars per token)', () => {
    // 20 chars -> ceil(20/4) = 5 tokens
    expect(estimateTokens('12345678901234567890')).toBe(5);
  });

  it('returns 0 for an empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('rounds up partial tokens', () => {
    // 5 chars -> ceil(5/4) = 2 tokens
    expect(estimateTokens('hello')).toBe(2);
  });
});

describe('estimateMessageTokens', () => {
  it('estimates tokens for a message with string content', () => {
    const msg = { role: 'user', content: '12345678901234567890' };
    // 4 (role overhead) + 5 (20 chars / 4) = 9
    expect(estimateMessageTokens(msg)).toBe(9);
  });

  it('estimates tokens for a message with text ContentBlock array', () => {
    const msg = {
      role: 'assistant',
      content: [
        { type: 'text' as const, text: '12345678901234567890' },
        { type: 'text' as const, text: '1234567890' },
      ],
    };
    // 4 (role) + 5 (first text block: 20/4) + 3 (second text block: ceil(10/4)) = 12
    expect(estimateMessageTokens(msg)).toBe(12);
  });

  it('estimates ~1600 tokens for image blocks', () => {
    const msg = {
      role: 'user',
      content: [
        {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: 'image/png' as const,
            data: 'iVBORw0KGgoAAAA...',
          },
        },
      ],
    };
    // 4 (role) + 1600 (image) = 1604
    expect(estimateMessageTokens(msg)).toBe(1604);
  });

  it('estimates tokens for tool_use blocks based on JSON.stringify(input)', () => {
    const msg = {
      role: 'assistant',
      content: [
        {
          type: 'tool_use' as const,
          id: 'tool_1',
          name: 'read_file',
          input: { path: '/foo/bar.ts' },
        },
      ],
    };
    const result = estimateMessageTokens(msg);
    // Should include role overhead + name tokens + JSON input tokens
    expect(result).toBeGreaterThan(4);
  });

  it('estimates tokens for tool_result blocks based on content string', () => {
    const msg = {
      role: 'user',
      content: [
        {
          type: 'tool_result' as const,
          tool_use_id: 'tool_1',
          content: 'File contents here with some text',
        },
      ],
    };
    const result = estimateMessageTokens(msg);
    // 4 (role) + ceil(32/4) = 4 + 8 = 12
    expect(result).toBeGreaterThan(4);
  });
});
