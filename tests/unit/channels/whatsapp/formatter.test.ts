import { describe, it, expect } from 'vitest';
import {
  formatResponse,
  splitMessage,
  stripMarkdown,
} from '../../../../src/core/channels/whatsapp/formatter.js';

describe('formatResponse', () => {
  it('converts **bold** to *bold*', () => {
    expect(formatResponse('Hello **world**')).toBe('Hello *world*');
  });

  it('converts ~~strikethrough~~ to ~strikethrough~', () => {
    expect(formatResponse('~~removed~~')).toBe('~removed~');
  });

  it('converts markdown headings to bold', () => {
    expect(formatResponse('## Section Title')).toBe('*Section Title*');
    expect(formatResponse('# Main Title')).toBe('*Main Title*');
  });

  it('converts markdown links to plain text with URL', () => {
    expect(formatResponse('[Click here](https://example.com)')).toBe(
      'Click here (https://example.com)',
    );
  });

  it('preserves code blocks', () => {
    const input = 'Here is code:\n```\nconst x = 1;\n```\nEnd.';
    const result = formatResponse(input);
    expect(result).toContain('```\nconst x = 1;\n```');
  });

  it('preserves inline code', () => {
    expect(formatResponse('Use `npm install`')).toBe('Use `npm install`');
  });

  it('handles plain text without changes', () => {
    expect(formatResponse('Hello world')).toBe('Hello world');
  });

  it('handles multiple formatting in one message', () => {
    const result = formatResponse('**bold** and _italic_ and ~~strike~~');
    expect(result).toBe('*bold* and _italic_ and ~strike~');
  });
});

describe('splitMessage', () => {
  it('returns single chunk for short messages', () => {
    expect(splitMessage('Hello')).toEqual(['Hello']);
  });

  it('splits long messages at paragraph boundaries', () => {
    const para1 = 'A'.repeat(2000);
    const para2 = 'B'.repeat(2000);
    const text = `${para1}\n\n${para2}`;
    const chunks = splitMessage(text, 4096);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it('handles code block closure across chunks', () => {
    const code = '```\n' + 'x'.repeat(5000) + '\n```';
    const chunks = splitMessage(code, 4096);
    expect(chunks.length).toBeGreaterThan(1);
    // First chunk should be closed
    expect(chunks[0].endsWith('```')).toBe(true);
    // Second chunk should be reopened
    expect(chunks[1].startsWith('```')).toBe(true);
  });

  it('respects custom max length', () => {
    const text = 'Hello world, this is a test message for splitting.';
    const chunks = splitMessage(text, 20);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(24); // some slack for code block closure
    }
  });
});

describe('stripMarkdown', () => {
  it('removes bold formatting', () => {
    expect(stripMarkdown('*bold text*')).toBe('bold text');
  });

  it('removes italic formatting', () => {
    expect(stripMarkdown('_italic text_')).toBe('italic text');
  });

  it('removes strikethrough', () => {
    expect(stripMarkdown('~struck~')).toBe('struck');
  });

  it('removes code blocks', () => {
    expect(stripMarkdown('```\ncode\n```')).toBe('code');
  });

  it('removes inline code', () => {
    expect(stripMarkdown('Use `npm`')).toBe('Use npm');
  });

  it('removes heading markers', () => {
    expect(stripMarkdown('## Heading')).toBe('Heading');
  });

  it('simplifies links', () => {
    expect(stripMarkdown('[text](https://url.com)')).toBe('text');
  });
});
