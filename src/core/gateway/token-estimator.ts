// ============================================================
// OpenClaw Deploy — Token Estimator
// ============================================================

import type { ContentBlock } from '../../types/index.js';

const CHARS_PER_TOKEN = 4;
const IMAGE_TOKEN_ESTIMATE = 1600;

/**
 * Estimate token count for a plain text string.
 * Uses a conservative ~4 characters per token heuristic.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimate token count for a chat message, handling both
 * plain string content and ContentBlock arrays.
 */
export function estimateMessageTokens(msg: {
  role: string;
  content: string | ContentBlock[];
}): number {
  // Role overhead (~4 tokens for role metadata)
  let tokens = 4;

  if (typeof msg.content === 'string') {
    tokens += estimateTokens(msg.content);
    return tokens;
  }

  // ContentBlock array
  for (const block of msg.content) {
    switch (block.type) {
      case 'text':
        tokens += estimateTokens(block.text);
        break;
      case 'image':
        tokens += IMAGE_TOKEN_ESTIMATE;
        break;
      case 'tool_use':
        tokens += estimateTokens(block.name);
        tokens += estimateTokens(JSON.stringify(block.input));
        break;
      case 'tool_result':
        tokens += estimateTokens(block.content);
        break;
    }
  }

  return tokens;
}
