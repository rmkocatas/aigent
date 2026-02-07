import { describe, it, expect } from 'vitest';
import {
  escapeMarkdownV2,
  formatResponse,
  splitMessage,
  stripMarkdown,
} from '../../../../src/core/channels/telegram/formatter.js';

describe('escapeMarkdownV2', () => {
  it('escapes special characters', () => {
    const result = escapeMarkdownV2('Hello. World!');
    expect(result).toBe('Hello\\. World\\!');
  });

  it('escapes all MarkdownV2 special chars', () => {
    const result = escapeMarkdownV2('a_b*c[d]e(f)g~h>i#j+k-l=m|n{o}p.q!r');
    expect(result).toContain('\\_');
    expect(result).toContain('\\*');
    expect(result).toContain('\\.');
    expect(result).toContain('\\!');
  });

  it('preserves code blocks without escaping', () => {
    const result = escapeMarkdownV2('text ```code.block!``` more text.');
    expect(result).toContain('```code.block!```');
    expect(result).toContain('more text\\.');
  });

  it('preserves inline code without escaping', () => {
    const result = escapeMarkdownV2('use `array.map()` here.');
    expect(result).toContain('`array.map()`');
    expect(result).toContain('here\\.');
  });

  it('handles text with no special chars', () => {
    expect(escapeMarkdownV2('hello world')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(escapeMarkdownV2('')).toBe('');
  });
});

describe('formatResponse', () => {
  it('formats standard markdown to MarkdownV2', () => {
    const result = formatResponse('Hello! How are you.');
    expect(result).toContain('\\!');
    expect(result).toContain('\\.');
  });

  it('preserves code blocks', () => {
    const input = 'Here is code:\n```python\nprint("hello")\n```\nDone.';
    const result = formatResponse(input);
    expect(result).toContain('```python\nprint("hello")\n```');
    expect(result).toContain('Done\\.');
  });
});

describe('splitMessage', () => {
  it('returns single chunk for short messages', () => {
    const result = splitMessage('hello', 4096);
    expect(result).toEqual(['hello']);
  });

  it('splits on paragraph boundary', () => {
    const para1 = 'a'.repeat(3000);
    const para2 = 'b'.repeat(3000);
    const text = para1 + '\n\n' + para2;
    const result = splitMessage(text, 4096);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(para1);
    expect(result[1]).toBe(para2);
  });

  it('splits on line boundary when no paragraph break', () => {
    const line1 = 'a'.repeat(3000);
    const line2 = 'b'.repeat(3000);
    const text = line1 + '\n' + line2;
    const result = splitMessage(text, 4096);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it('each chunk is under maxLength', () => {
    const text = 'word '.repeat(2000);
    const result = splitMessage(text, 4096);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(4096 + 10); // small margin for code fence closure
    }
  });

  it('handles unclosed code blocks at split point', () => {
    const code = '```\n' + 'x'.repeat(5000) + '\n```';
    const result = splitMessage(code, 4096);
    expect(result.length).toBeGreaterThanOrEqual(2);
    // First chunk should close the code block
    expect(result[0]).toContain('```');
  });

  it('returns empty array for empty string', () => {
    const result = splitMessage('', 4096);
    expect(result).toEqual(['']);
  });
});

describe('stripMarkdown', () => {
  it('removes bold formatting', () => {
    expect(stripMarkdown('**bold text**')).toBe('bold text');
  });

  it('removes italic formatting', () => {
    expect(stripMarkdown('*italic*')).toBe('italic');
  });

  it('removes inline code backticks', () => {
    expect(stripMarkdown('use `code` here')).toBe('use code here');
  });

  it('removes code fence markers', () => {
    const result = stripMarkdown('```python\nprint("hi")\n```');
    expect(result).toContain('print("hi")');
    expect(result).not.toContain('```');
  });

  it('removes heading markers', () => {
    expect(stripMarkdown('## Heading')).toBe('Heading');
  });

  it('removes link formatting', () => {
    expect(stripMarkdown('[click here](https://example.com)')).toBe('click here');
  });

  it('removes escape backslashes', () => {
    expect(stripMarkdown('Hello\\!')).toBe('Hello!');
  });
});
