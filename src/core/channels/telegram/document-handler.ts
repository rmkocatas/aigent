// ============================================================
// OpenClaw Deploy — Telegram Document Text Extractor
// ============================================================

import { extname } from 'node:path';

const MAX_TEXT_LENGTH = 50_000;

/** File extensions that are treated as plain text. */
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.csv', '.json', '.xml', '.html',
  '.ts', '.js', '.py',
  '.yaml', '.yml', '.toml', '.ini',
  '.log', '.sql', '.sh', '.bat', '.ps1',
]);

/**
 * Extracts readable text from a document buffer.
 *
 * - Plain-text formats (identified by extension) are decoded as UTF-8.
 * - PDFs get a best-effort extraction of embedded text operators.
 * - All other formats throw an error.
 *
 * The returned string is truncated to 50 000 characters.
 */
export function extractTextFromDocument(
  buffer: Buffer,
  fileName: string,
  mimeType?: string,
): string {
  const ext = extname(fileName).toLowerCase();

  // --- Plain-text formats ---
  if (TEXT_EXTENSIONS.has(ext)) {
    return truncate(buffer.toString('utf-8'));
  }

  // --- PDF ---
  if (ext === '.pdf' || mimeType === 'application/pdf') {
    return truncate(extractPdfText(buffer));
  }

  throw new Error(`Unsupported document format: ${ext || 'unknown'}`);
}

// ---------------------------------------------------------------------------
// Simple PDF text extraction
// ---------------------------------------------------------------------------

/**
 * Attempts to pull text from a PDF by scanning for `(text)Tj` and
 * `[(text)]TJ` operators in the raw binary stream.  This handles the
 * simplest PDFs; anything more complex (compressed streams, CID fonts,
 * etc.) falls back to a human-readable message.
 */
function extractPdfText(buffer: Buffer): string {
  const raw = buffer.toString('latin1');
  const fragments: string[] = [];

  // Match (text)Tj — simple text showing operator
  const tjRegex = /\(([^)]*)\)\s*Tj/g;
  let match: RegExpExecArray | null;
  while ((match = tjRegex.exec(raw)) !== null) {
    fragments.push(decodePdfEscape(match[1]));
  }

  // Match [(...)(...)]TJ — array text showing operator
  const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g;
  while ((match = tjArrayRegex.exec(raw)) !== null) {
    const inner = match[1];
    const partRegex = /\(([^)]*)\)/g;
    let part: RegExpExecArray | null;
    while ((part = partRegex.exec(inner)) !== null) {
      fragments.push(decodePdfEscape(part[1]));
    }
  }

  if (fragments.length === 0) {
    return 'This PDF requires a specialized reader for text extraction.';
  }

  return fragments.join('');
}

/** Decode common PDF string escape sequences. */
function decodePdfEscape(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(text: string): string {
  if (text.length > MAX_TEXT_LENGTH) {
    return text.slice(0, MAX_TEXT_LENGTH);
  }
  return text;
}
