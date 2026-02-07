// ============================================================
// OpenClaw Deploy — WhatsApp Message Formatter
// ============================================================
//
// WhatsApp formatting rules:
//   *bold*     _italic_     ~strikethrough~     ```code```
//   Monospace: surround with three backticks
//   No MarkdownV2 escaping needed (unlike Telegram)
// ============================================================

// Regex for special chars in WhatsApp that might need escaping
const CODE_BLOCK_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`]+`/g;

interface Segment {
  text: string;
  isCode: boolean;
}

function splitByCode(text: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;

  // Find code blocks first (```...```)
  const combined = new RegExp(`(${CODE_BLOCK_RE.source}|${INLINE_CODE_RE.source})`, 'g');
  let match: RegExpExecArray | null;

  while ((match = combined.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), isCode: false });
    }
    segments.push({ text: match[0], isCode: true });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), isCode: false });
  }

  return segments;
}

/**
 * Convert LLM markdown to WhatsApp-friendly format.
 *
 * WhatsApp supports: *bold*, _italic_, ~strikethrough~, ```code```
 * LLM uses: **bold**, *italic*, ~~strikethrough~~, ```code```
 */
export function formatResponse(llmResponse: string): string {
  const segments = splitByCode(llmResponse);

  return segments
    .map((seg) => {
      if (seg.isCode) return seg.text;

      let text = seg.text;

      // Convert **bold** -> *bold* (WhatsApp style)
      text = text.replace(/\*\*(.+?)\*\*/g, '*$1*');

      // Convert ~~strikethrough~~ -> ~strikethrough~
      text = text.replace(/~~(.+?)~~/g, '~$1~');

      // Convert markdown headings to bold
      text = text.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

      // Convert markdown links [text](url) -> text (url)
      text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

      return text;
    })
    .join('');
}

/**
 * Split a message into chunks respecting WhatsApp's message limit.
 * Preserves code block integrity where possible.
 */
export function splitMessage(text: string, maxLength = 4096): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;
  let inCodeBlock = false;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitAt = maxLength;

    // Try to split at paragraph boundary
    const paraIdx = remaining.lastIndexOf('\n\n', maxLength);
    if (paraIdx > maxLength * 0.3) {
      splitAt = paraIdx;
    } else {
      // Try line boundary
      const lineIdx = remaining.lastIndexOf('\n', maxLength);
      if (lineIdx > maxLength * 0.3) {
        splitAt = lineIdx;
      }
    }

    let chunk = remaining.slice(0, splitAt);
    remaining = remaining.slice(splitAt).trimStart();

    // Handle code block splitting
    const codeBlockCount = (chunk.match(/```/g) || []).length;
    if (codeBlockCount % 2 !== 0) {
      // Unclosed code block in this chunk
      chunk += '\n```';
      remaining = '```\n' + remaining;
      inCodeBlock = !inCodeBlock;
    }

    chunks.push(chunk);
  }

  return chunks;
}

/**
 * Strip all formatting for plain text fallback.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~([^~]+)~/g, '$1')
    .replace(/```[\s\S]*?```/g, (match) =>
      match.replace(/```/g, '').trim(),
    )
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}
