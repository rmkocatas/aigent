// ============================================================
// OpenClaw Deploy — Conversation Compaction
// ============================================================
//
// Instead of simply truncating old messages (losing all context),
// compaction summarizes older conversation history into a concise
// summary that preserves key facts, decisions, and ongoing tasks.
// ============================================================

import type {
  ChatMessage,
  CompactionSummary,
  CompactionConfig,
  OllamaConfig,
  ContentBlock,
} from '../../types/index.js';
import { estimateTokens, estimateMessageTokens } from './token-estimator.js';
import { streamOllamaChat } from './ollama-client.js';
import { streamAnthropicChat } from './anthropic-client.js';
import { streamOpenAIChat } from './openai-client.js';

const COMPACTION_SYSTEM_PROMPT = `You are a conversation summarizer. Your job is to compress conversation history into a concise context summary that preserves essential information.

Rules:
- Preserve: key facts discussed, user preferences, decisions made, tool results, task outcomes, and any ongoing work
- Omit: greetings, filler, repeated questions, redundant exchanges, verbose tool outputs
- Write in third person past tense ("The user asked about...", "The assistant found that...")
- Be concise but complete — another AI will use this summary to continue the conversation
- Do NOT add information that was not in the conversation
- Preserve the user's language preference — if the conversation was in a non-English language, write the summary in that language
- Preserve any active persona or voice style context (e.g. "the assistant was using a professor persona")`;

export interface CompactionResult {
  recentMessages: ChatMessage[];
  summary: CompactionSummary | undefined;
  compacted: boolean;
}

/**
 * Compact a conversation by summarizing older messages.
 *
 * Returns the recent messages to keep verbatim and an updated summary.
 * If compaction is not needed (conversation fits in budget), returns
 * all messages unchanged.
 */
export async function compactConversation(
  messages: ChatMessage[],
  existingSummary: CompactionSummary | undefined,
  maxTokens: number,
  systemPrompt: string | null,
  config: CompactionConfig,
  ollamaConfig: OllamaConfig | null,
  anthropicApiKey: string | null,
  openaiApiKey?: string | null,
): Promise<CompactionResult> {
  if (!config.enabled) {
    return { recentMessages: messages, summary: existingSummary, compacted: false };
  }

  // Estimate current token usage (with sanity clamping)
  const systemPromptTokens = systemPrompt ? Math.max(0, estimateTokens(systemPrompt)) : 0;
  const summaryTokens = existingSummary ? Math.max(0, estimateTokens(existingSummary.summary)) : 0;
  let messageTokens = 0;
  for (const msg of messages) {
    const est = estimateMessageTokens({ role: msg.role, content: msg.content });
    messageTokens += (Number.isFinite(est) && est > 0) ? est : 0;
  }
  const totalTokens = systemPromptTokens + summaryTokens + messageTokens;

  // Sanity check: if total is 0 or NaN despite having messages, skip compaction
  if (!Number.isFinite(totalTokens) || (messages.length > 0 && totalTokens === 0)) {
    console.warn('[compaction] Token estimate returned invalid value, skipping compaction');
    return { recentMessages: messages, summary: existingSummary, compacted: false };
  }

  // Check if we need to compact
  const threshold = maxTokens * config.triggerThreshold;
  if (totalTokens <= threshold) {
    return { recentMessages: messages, summary: existingSummary, compacted: false };
  }

  // Split messages into old (to summarize) and recent (to keep)
  const keepCount = Math.min(config.keepRecentCount, messages.length);
  const splitIndex = messages.length - keepCount;

  if (splitIndex <= 0) {
    // Not enough messages to compact — keep all
    return { recentMessages: messages, summary: existingSummary, compacted: false };
  }

  const oldMessages = messages.slice(0, splitIndex);
  const recentMessages = messages.slice(splitIndex);

  // Build the text to summarize
  const textToSummarize = formatMessagesForSummary(oldMessages, existingSummary);

  // Call LLM to generate summary
  const summaryText = await generateSummary(
    textToSummarize,
    config,
    ollamaConfig,
    anthropicApiKey,
    openaiApiKey ?? null,
  );

  const summaryTokenEst = Math.max(0, estimateTokens(summaryText));

  // Post-compaction sanity: if summary is larger than what we compacted, something went wrong
  let oldMessageTokens = 0;
  for (const msg of oldMessages) {
    const est = estimateMessageTokens({ role: msg.role, content: msg.content });
    oldMessageTokens += (Number.isFinite(est) && est > 0) ? est : 0;
  }
  if (summaryTokenEst > oldMessageTokens * 1.1) {
    console.warn(
      `[compaction] Summary (${summaryTokenEst} tokens) is larger than compacted messages (${oldMessageTokens} tokens) — keeping original`,
    );
    return { recentMessages: messages, summary: existingSummary, compacted: false };
  }

  const summary: CompactionSummary = {
    summary: summaryText,
    messageCount: (existingSummary?.messageCount ?? 0) + oldMessages.length,
    timestamp: new Date().toISOString(),
    tokenEstimate: summaryTokenEst,
  };

  console.log(
    `[compaction] Compacted ${oldMessages.length} messages into ${summary.tokenEstimate} token summary (total compacted: ${summary.messageCount})`,
  );

  return { recentMessages, summary, compacted: true };
}

/**
 * Format messages into readable text for the summarizer.
 */
function formatMessagesForSummary(
  messages: ChatMessage[],
  existingSummary?: CompactionSummary,
): string {
  const parts: string[] = [];

  if (existingSummary) {
    parts.push(`[Previous context summary]\n${existingSummary.summary}\n`);
  }

  parts.push('[Conversation to summarize]');
  for (const msg of messages) {
    const role = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : msg.role;
    const text = extractTextContent(msg.content);
    if (text) {
      parts.push(`${role}: ${text}`);
    }
  }

  return parts.join('\n');
}

/**
 * Extract plain text from a message's content (string or ContentBlock[]).
 */
function extractTextContent(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join(' ');
}

/**
 * Call the LLM to generate a summary.
 */
async function generateSummary(
  textToSummarize: string,
  config: CompactionConfig,
  ollamaConfig: OllamaConfig | null,
  anthropicApiKey: string | null,
  openaiApiKey: string | null,
): Promise<string> {
  const userPrompt = `Summarize the following conversation into a concise context summary (under ${config.summaryMaxTokens * 4} characters):\n\n${textToSummarize}`;

  const messages = [
    { role: 'system', content: COMPACTION_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];

  // Use fastModel for compaction (smaller model is sufficient for summarization)
  const compactionOllamaConfig = ollamaConfig
    ? { ...ollamaConfig, model: ollamaConfig.fastModel ?? ollamaConfig.model }
    : null;

  // Try the configured provider, fall back to the other
  if (config.provider === 'ollama' && compactionOllamaConfig) {
    return await collectStreamResponse(
      streamOllamaChat(compactionOllamaConfig, messages),
    );
  }

  if (config.provider === 'anthropic' && anthropicApiKey) {
    return await collectStreamResponse(
      streamAnthropicChat(anthropicApiKey, 'claude-haiku-4-5-20251001', messages),
    );
  }

  if (config.provider === 'openai' && openaiApiKey) {
    return await collectStreamResponse(
      streamOpenAIChat(openaiApiKey, 'gpt-4o-mini', messages),
    );
  }

  // Fallback: try whatever is available
  if (openaiApiKey) {
    return await collectStreamResponse(
      streamOpenAIChat(openaiApiKey, 'gpt-4o-mini', messages),
    );
  }

  if (compactionOllamaConfig) {
    return await collectStreamResponse(
      streamOllamaChat(compactionOllamaConfig, messages),
    );
  }

  if (anthropicApiKey) {
    return await collectStreamResponse(
      streamAnthropicChat(anthropicApiKey, 'claude-haiku-4-5-20251001', messages),
    );
  }

  // No LLM available — fall back to naive truncation
  return textToSummarize.slice(0, config.summaryMaxTokens * 4);
}

/**
 * Consume a stream and return the full text response.
 */
async function collectStreamResponse(
  stream: AsyncGenerator<{ content: string; done: boolean }>,
): Promise<string> {
  let text = '';
  for await (const chunk of stream) {
    text += chunk.content;
    if (chunk.done) break;
  }
  return text.trim();
}
