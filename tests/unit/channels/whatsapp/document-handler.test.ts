import { describe, it, expect } from 'vitest';
import { extractTextFromDocument } from '../../../../src/core/channels/whatsapp/document-handler.js';

describe('WhatsApp document-handler re-export', () => {
  it('re-exports extractTextFromDocument from telegram module', () => {
    expect(typeof extractTextFromDocument).toBe('function');
  });

  it('extracts text from plain text buffer', () => {
    const buffer = Buffer.from('Hello, this is a test document.');
    const text = extractTextFromDocument(buffer, 'test.txt', 'text/plain');
    expect(text).toBe('Hello, this is a test document.');
  });

  it('extracts text from markdown buffer', () => {
    const buffer = Buffer.from('# Title\n\nSome content.');
    const text = extractTextFromDocument(buffer, 'readme.md', 'text/markdown');
    expect(text).toBe('# Title\n\nSome content.');
  });

  it('throws for unsupported formats', () => {
    const buffer = Buffer.from([0x00, 0x01, 0x02]);
    expect(() =>
      extractTextFromDocument(buffer, 'file.exe', 'application/octet-stream'),
    ).toThrow('Unsupported document format');
  });
});
