// ============================================================
// OpenClaw Deploy — Context Window Manager
// ============================================================

import type { ContentBlock } from '../../types/index.js';
import { estimateTokens, estimateMessageTokens } from './token-estimator.js';

export interface ManagedMessages {
  messages: Array<{ role: string; content: string | ContentBlock[] }>;
  wasTruncated: boolean;
}

/**
 * Manage the context window by truncating older messages when the
 * conversation exceeds the model's token budget.
 *
 * - If total tokens fit within maxTokens, returns messages as-is.
 * - Otherwise, first tries a soft-trim pass that prunes image blocks
 *   from older tool results (v2026.3.11 image context pruning).
 * - If still over budget, falls back to hard truncation (keep from end).
 * - Ensures the result starts with a user message (Anthropic requirement).
 * - System prompt tokens count against the budget but the system prompt
 *   message is NOT included in the output.
 */
export function manageContextWindow(
  messages: Array<{ role: string; content: string | ContentBlock[] }>,
  maxTokens: number,
  systemPrompt?: string | null,
): ManagedMessages {
  // Calculate system prompt overhead
  const systemPromptTokens = systemPrompt ? estimateTokens(systemPrompt) : 0;
  const availableBudget = maxTokens - systemPromptTokens;

  // Calculate total tokens for all messages
  let totalTokens = 0;
  for (const msg of messages) {
    totalTokens += estimateMessageTokens(msg);
  }

  // If everything fits, return as-is
  if (totalTokens <= availableBudget) {
    return { messages: [...messages], wasTruncated: false };
  }

  // --- Soft-trim pass: prune image blocks from older messages (v2026.3.11) ---
  // This recovers ~1600 tokens per image without losing text context.
  // Only prune images in the first 75% of messages (keep recent ones intact).
  const softTrimmed = softTrimImages(messages, availableBudget);
  if (softTrimmed) {
    return { messages: softTrimmed, wasTruncated: true };
  }

  // --- Hard truncation: keep messages from the end until 90% of budget ---
  const targetBudget = Math.floor(availableBudget * 0.9);
  let usedTokens = 0;
  let startIndex = messages.length;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msgTokens = estimateMessageTokens(messages[i]);
    if (usedTokens + msgTokens > targetBudget) {
      break;
    }
    usedTokens += msgTokens;
    startIndex = i;
  }

  // Ensure result starts with a user message (Anthropic requirement)
  while (startIndex < messages.length && messages[startIndex].role !== 'user') {
    startIndex++;
  }

  const truncated = messages.slice(startIndex);

  return {
    messages: truncated,
    wasTruncated: true,
  };
}

/**
 * Soft-trim: strip image blocks from older tool_result messages.
 * Replaces image blocks with a short text placeholder to preserve structure.
 * Returns null if pruning isn't sufficient to fit within budget.
 */
function softTrimImages(
  messages: Array<{ role: string; content: string | ContentBlock[] }>,
  budget: number,
): Array<{ role: string; content: string | ContentBlock[] }> | null {
  // Only prune images in the first 75% of messages
  const pruneLimit = Math.floor(messages.length * 0.75);
  let recovered = 0;
  const IMAGE_TOKEN_ESTIMATE = 1600;

  // Deep-copy only the messages we'll modify
  const result = messages.map((msg, idx) => {
    if (idx >= pruneLimit) return msg;
    if (typeof msg.content === 'string') return msg;
    if (!Array.isArray(msg.content)) return msg;

    // Check if this message has image blocks worth pruning
    const hasImage = msg.content.some((b) => b.type === 'image');
    if (!hasImage) return msg;

    const filtered = msg.content.map((block) => {
      if (block.type === 'image') {
        recovered += IMAGE_TOKEN_ESTIMATE;
        return { type: 'text' as const, text: '[image pruned from context]' };
      }
      return block;
    });

    return { role: msg.role, content: filtered };
  });

  if (recovered === 0) return null;

  // Recheck total
  let total = 0;
  for (const msg of result) {
    total += estimateMessageTokens(msg);
  }

  return total <= budget ? result : null;
}
