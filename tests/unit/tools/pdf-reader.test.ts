import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pdfReaderHandler } from '../../../src/core/tools/builtins/pdf-reader.js';
import type { ToolContext } from '../../../src/core/tools/registry.js';

// Mock PDFParse class
const mockGetText = vi.fn();
const mockGetInfo = vi.fn();
const mockDestroy = vi.fn();

vi.mock('pdf-parse', () => ({
  PDFParse: vi.fn().mockImplementation(() => ({
    getText: mockGetText,
    getInfo: mockGetInfo,
    destroy: mockDestroy,
  })),
}));

// Mock fs
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual('node:fs/promises');
  return { ...actual, readFile: vi.fn() };
});

import { readFile } from 'node:fs/promises';
const mockReadFile = vi.mocked(readFile);

const ctx: ToolContext = {
  workspaceDir: '/workspace', memoryDir: '/workspace/memory', conversationId: 'test', userId: 'u1', maxExecutionMs: 5000,
};

beforeEach(() => {
  mockReadFile.mockReset();
  mockGetText.mockReset();
  mockGetInfo.mockReset();
  mockDestroy.mockReset().mockResolvedValue(undefined);
});

describe('pdf_reader tool', () => {
  it('extracts text from PDF', async () => {
    const pdfHeader = Buffer.from('%PDF-1.4 fake content');
    mockReadFile.mockResolvedValueOnce(pdfHeader as never);
    mockGetText.mockResolvedValueOnce({ text: 'Hello World from PDF', pages: [{}, {}] });
    mockGetInfo.mockResolvedValueOnce({ pages: 2 });

    const r = await pdfReaderHandler({ path: 'doc.pdf' }, ctx);
    expect(r).toContain('Pages: 2');
    expect(r).toContain('Hello World from PDF');
  });

  it('throws for file not found', async () => {
    const err = new Error('ENOENT') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    mockReadFile.mockRejectedValueOnce(err);

    await expect(pdfReaderHandler({ path: 'missing.pdf' }, ctx)).rejects.toThrow('File not found');
  });

  it('throws for non-PDF file', async () => {
    mockReadFile.mockResolvedValueOnce(Buffer.from('not a pdf') as never);
    await expect(pdfReaderHandler({ path: 'file.txt' }, ctx)).rejects.toThrow('not appear to be a valid PDF');
  });

  it('throws for absolute path', async () => {
    await expect(pdfReaderHandler({ path: '/etc/passwd' }, ctx)).rejects.toThrow('Absolute paths');
  });

  it('throws for path traversal', async () => {
    await expect(pdfReaderHandler({ path: '../secret.pdf' }, ctx)).rejects.toThrow('traversal');
  });

  it('throws for missing path', async () => {
    await expect(pdfReaderHandler({}, ctx)).rejects.toThrow('Missing');
  });

  it('throws for oversized file', async () => {
    const big = Buffer.alloc(11 * 1024 * 1024);
    big.write('%PDF-');
    mockReadFile.mockResolvedValueOnce(big as never);
    await expect(pdfReaderHandler({ path: 'huge.pdf' }, ctx)).rejects.toThrow('too large');
  });

  it('handles PDF with no text', async () => {
    mockReadFile.mockResolvedValueOnce(Buffer.from('%PDF-1.4 content') as never);
    mockGetText.mockResolvedValueOnce({ text: '', pages: [{}] });
    mockGetInfo.mockResolvedValueOnce({ pages: 1 });

    const r = await pdfReaderHandler({ path: 'scan.pdf' }, ctx);
    expect(r).toContain('no extractable text');
  });

  it('truncates large text output', async () => {
    const longText = 'A'.repeat(60_000);
    mockReadFile.mockResolvedValueOnce(Buffer.from('%PDF-1.4 content') as never);
    mockGetText.mockResolvedValueOnce({ text: longText, pages: new Array(100) });
    mockGetInfo.mockResolvedValueOnce({ pages: 100 });

    const r = await pdfReaderHandler({ path: 'long.pdf' }, ctx);
    expect(r).toContain('[Truncated');
    expect(r.length).toBeLessThan(60_000);
  });
});
