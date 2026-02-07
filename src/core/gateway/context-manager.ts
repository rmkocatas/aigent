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
 * - Otherwise, keeps messages from the end until 90% of the budget is used.
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

  // Truncation: keep messages from the end until 90% of available budget
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
