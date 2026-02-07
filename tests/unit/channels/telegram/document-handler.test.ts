import { describe, it, expect } from 'vitest';
import { extractTextFromDocument } from '../../../../src/core/channels/telegram/document-handler.js';

describe('extractTextFromDocument', () => {
  it('extracts text from a .txt file', () => {
    const content = 'Hello, world!\nThis is a text file.';
    const buffer = Buffer.from(content, 'utf-8');
    const result = extractTextFromDocument(buffer, 'readme.txt');
    expect(result).toBe(content);
  });

  it('extracts text from a .json file', () => {
    const json = JSON.stringify({ key: 'value', num: 42 });
    const buffer = Buffer.from(json, 'utf-8');
    const result = extractTextFromDocument(buffer, 'data.json');
    expect(result).toBe(json);
  });

  it('extracts text from a .csv file', () => {
    const csv = 'name,age\nAlice,30\nBob,25';
    const buffer = Buffer.from(csv, 'utf-8');
    const result = extractTextFromDocument(buffer, 'people.csv');
    expect(result).toBe(csv);
  });

  it('throws an error for unsupported formats', () => {
    const buffer = Buffer.from('binary data');
    expect(() => extractTextFromDocument(buffer, 'image.png')).toThrow(
      'Unsupported document format: .png',
    );
  });

  it('truncates text at 50,000 characters', () => {
    const longContent = 'x'.repeat(60_000);
    const buffer = Buffer.from(longContent, 'utf-8');
    const result = extractTextFromDocument(buffer, 'large.txt');
    expect(result.length).toBe(50_000);
  });

  it('extracts text from other supported extensions', () => {
    for (const ext of ['.md', '.xml', '.html', '.ts', '.js', '.py', '.yaml', '.yml', '.toml', '.ini', '.log', '.sql', '.sh', '.bat', '.ps1']) {
      const content = `content for ${ext}`;
      const buffer = Buffer.from(content, 'utf-8');
      const result = extractTextFromDocument(buffer, `file${ext}`);
      expect(result).toBe(content);
    }
  });

  it('returns fallback message for complex PDFs', () => {
    // A buffer that starts with %PDF but has no simple Tj/TJ operators
    const pdfHeader = Buffer.from('%PDF-1.4\nsome binary content without text operators');
    const result = extractTextFromDocument(pdfHeader, 'document.pdf');
    expect(result).toBe('This PDF requires a specialized reader for text extraction.');
  });

  it('extracts text from simple PDFs with Tj operators', () => {
    const pdfContent = '%PDF-1.4\n(Hello World) Tj\n(Second line) Tj';
    const buffer = Buffer.from(pdfContent, 'latin1');
    const result = extractTextFromDocument(buffer, 'simple.pdf');
    expect(result).toBe('Hello WorldSecond line');
  });

  it('extracts text from PDFs with TJ array operators', () => {
    const pdfContent = '%PDF-1.4\n[(Hello )(World)] TJ';
    const buffer = Buffer.from(pdfContent, 'latin1');
    const result = extractTextFromDocument(buffer, 'array.pdf');
    expect(result).toBe('Hello World');
  });
});
