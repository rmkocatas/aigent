// ============================================================
// OpenClaw Deploy — PDF Reader Tool (Restricted)
// ============================================================

import { readFile } from 'node:fs/promises';
import { resolve, normalize, isAbsolute } from 'node:path';
import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_OUTPUT_SIZE = 50_000; // 50KB text output

function validatePath(filePath: string, workspaceDir: string): string {
  if (!filePath || typeof filePath !== 'string') throw new Error('Missing file path');
  if (isAbsolute(filePath)) throw new Error('Absolute paths not allowed. Use workspace-relative paths.');

  const normalized = normalize(filePath);
  if (normalized.startsWith('..') || normalized.includes('..\\') || normalized.includes('../')) {
    throw new Error('Path traversal (.. components) is not allowed.');
  }

  const full = resolve(workspaceDir, normalized);
  if (!full.startsWith(resolve(workspaceDir))) {
    throw new Error('Path resolves outside workspace.');
  }

  return full;
}

export const pdfReaderDefinition: ToolDefinition = {
  name: 'pdf_reader',
  description: 'Extract text from a PDF file in the workspace. Supports multi-page documents.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path to the PDF file within the workspace.' },
    },
    required: ['path'],
  },
  routing: {
    useWhen: ['User asks to read or extract text from a PDF file'],
    avoidWhen: ['User is asking about PDFs conceptually, not reading a specific file'],
  },
};

export const pdfReaderHandler: ToolHandler = async (input, context) => {
  const filePath = validatePath(input.path as string, context.workspaceDir);

  let buffer: Buffer;
  try {
    buffer = await readFile(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`File not found: ${input.path}`);
    }
    throw err;
  }

  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(`File too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB, max 10MB)`);
  }

  // Verify it looks like a PDF
  if (buffer.length < 5 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('File does not appear to be a valid PDF');
  }

  const { PDFParse } = await import('pdf-parse');

  const parser = new PDFParse({ data: new Uint8Array(buffer) });

  try {
    const textResult = await parser.getText();
    const infoResult = await parser.getInfo();

    let text = (textResult?.text ?? '').trim();
    const pageCount = infoResult?.pages ?? textResult?.pages?.length ?? 0;

    if (!text) return 'PDF contains no extractable text (may be image-based).';

    if (text.length > MAX_OUTPUT_SIZE) {
      text = text.slice(0, MAX_OUTPUT_SIZE) + '\n\n[Truncated — PDF text exceeds 50KB]';
    }

    return `Pages: ${pageCount}\n\n${text}`;
  } finally {
    try { await parser.destroy(); } catch { /* ignore */ }
  }
};
