// ============================================================
// OpenClaw Deploy — Telegram MarkdownV2 Formatter
// ============================================================

// Characters that must be escaped in MarkdownV2 (outside code blocks)
const SPECIAL_CHARS = /([_*\[\]()~`>#+\-=|{}.!\\])/g;

/**
 * Escape special characters for Telegram MarkdownV2,
 * preserving code blocks and inline code.
 */
export function escapeMarkdownV2(text: string): string {
  const segments = splitByCode(text);
  return segments
    .map((seg) =>
      seg.isCode ? seg.text : seg.text.replace(SPECIAL_CHARS, '\\$1'),
    )
    .join('');
}

/**
 * Convert standard LLM markdown output to Telegram MarkdownV2.
 * Preserves code blocks, escapes special chars in prose.
 */
export function formatResponse(llmResponse: string): string {
  return escapeMarkdownV2(llmResponse);
}

/**
 * Split a message into chunks that fit within Telegram's limit.
 * Prefers splitting on paragraph boundaries, then lines, then words.
 * Handles code blocks that span split points.
 */
export function splitMessage(text: string, maxLength = 4096): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Find best split point within maxLength
    const candidate = remaining.slice(0, maxLength);
    let splitIdx = -1;

    // 1. Try paragraph boundary (double newline)
    const paraIdx = candidate.lastIndexOf('\n\n');
    if (paraIdx > maxLength * 0.3) {
      splitIdx = paraIdx;
    }

    // 2. Try line boundary
    if (splitIdx === -1) {
      const lineIdx = candidate.lastIndexOf('\n');
      if (lineIdx > maxLength * 0.2) {
        splitIdx = lineIdx;
      }
    }

    // 3. Try word boundary
    if (splitIdx === -1) {
      const spaceIdx = candidate.lastIndexOf(' ');
      if (spaceIdx > maxLength * 0.2) {
        splitIdx = spaceIdx;
      }
    }

    // 4. Hard split as last resort
    if (splitIdx === -1) {
      splitIdx = maxLength;
    }

    const chunk = remaining.slice(0, splitIdx).trimEnd();
    remaining = remaining.slice(splitIdx).trimStart();

    // Handle unclosed code blocks: count triple backticks
    const fenceCount = (chunk.match(/```/g) ?? []).length;
    if (fenceCount % 2 !== 0) {
      // Odd number = unclosed code block; close it and reopen in next chunk
      chunks.push(chunk + '\n```');
      remaining = '```\n' + remaining;
    } else {
      chunks.push(chunk);
    }
  }

  return chunks.filter((c) => c.length > 0);
}

/**
 * Strip markdown formatting for plain text fallback.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (match) => {
      // Keep code content but remove fences
      return match.replace(/```\w*\n?/g, '').replace(/```/g, '');
    })
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\\([_*\[\]()~`>#+\-=|{}.!\\])/g, '$1');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface TextSegment {
  text: string;
  isCode: boolean;
}

function splitByCode(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]+`)/);

  for (const part of parts) {
    if (part.startsWith('```') || (part.startsWith('`') && part.endsWith('`'))) {
      segments.push({ text: part, isCode: true });
    } else {
      segments.push({ text: part, isCode: false });
    }
  }

  return segments;
}
