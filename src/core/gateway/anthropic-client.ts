import Anthropic from '@anthropic-ai/sdk';
import type { StreamChunk, ToolDefinition, ContentBlock, TokenUsage } from '../../types/index.js';

/** Claude 4.6 models default to adaptive thinking (v2026.3.1). */
function getThinkingBudget(model: string): number | undefined {
  if (model.includes('opus-4-6') || model.includes('sonnet-4-6')) {
    return 8192;
  }
  return undefined;
}

/** Detect errors caused by providers rejecting thinking parameters. */
function isThinkingRejectionError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (msg.includes('thinking') && (msg.includes('not supported') || msg.includes('invalid') || msg.includes('unknown')))
    || (msg.includes('400') && msg.includes('think'));
}

export async function* streamAnthropicChat(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string | ContentBlock[] }>,
  signal?: AbortSignal,
  tools?: ToolDefinition[],
): AsyncGenerator<StreamChunk> {
  const client = new Anthropic({ apiKey });

  // Combine external signal (pipeline timeout) with per-stream 2-min timeout
  // so a single hung API call can't freeze the bot indefinitely
  const streamSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
    : AbortSignal.timeout(120_000);

  // Separate system messages from the conversation
  const systemMessages = messages.filter((m) => m.role === 'system');
  const chatMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => {
      if (typeof m.content === 'string') {
        return {
          role: m.role as 'user' | 'assistant',
          content: m.content,
        };
      }
      // ContentBlock[] — convert to Anthropic format
      const blocks = (m.content as ContentBlock[]).map((block) => {
        if (block.type === 'text') {
          return { type: 'text' as const, text: block.text };
        }
        if (block.type === 'tool_use') {
          return {
            type: 'tool_use' as const,
            id: block.id,
            name: block.name,
            input: block.input,
          };
        }
        if (block.type === 'tool_result') {
          return {
            type: 'tool_result' as const,
            tool_use_id: block.tool_use_id,
            content: block.content,
            is_error: block.is_error,
          };
        }
        if (block.type === 'image') {
          return {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: block.source.media_type,
              data: block.source.data,
            },
          };
        }
        return { type: 'text' as const, text: '' };
      });
      return {
        role: m.role as 'user' | 'assistant',
        content: blocks,
      };
    });

  // Ensure messages start with a user message (Anthropic API requirement).
  // After compaction or context truncation, the first message may be assistant —
  // fix by prepending a synthetic user message rather than crashing.
  if (chatMessages.length > 0 && chatMessages[0].role !== 'user') {
    chatMessages.unshift({ role: 'user', content: '(continuing conversation)' });
  }
  if (chatMessages.length === 0) {
    chatMessages.push({ role: 'user', content: '(new conversation)' });
  }

  // Convert tool definitions to Anthropic format with prompt caching
  const anthropicTools = tools?.map((t, i, arr) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: 'object' as const,
      properties: t.parameters.properties,
      required: t.parameters.required,
    },
    // Cache marker on the last tool — caches all tools before it
    ...(i === arr.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {}),
  }));

  // Build system prompt with cache_control for prompt caching
  const systemText = systemMessages.length > 0
    ? (typeof systemMessages[0].content === 'string' ? systemMessages[0].content : '')
    : '';
  const systemParam = systemText
    ? [{ type: 'text' as const, text: systemText, cache_control: { type: 'ephemeral' as const } }]
    : undefined;

  // Adaptive thinking: Claude 4.6 models default to enabled thinking (v2026.3.1)
  const thinkingBudget = getThinkingBudget(model);

  // Retry loop: if thinking is rejected by the provider, fall back to think=off
  for (let attempt = 0; attempt < 2; attempt++) {
    const useThinking = attempt === 0 && !!thinkingBudget;

    const stream = client.messages.stream({
      model,
      max_tokens: useThinking ? thinkingBudget! + 8192 : 8192,
      messages: chatMessages as Anthropic.MessageParam[],
      ...(systemParam ? { system: systemParam } : {}),
      ...(anthropicTools && anthropicTools.length > 0 ? { tools: anthropicTools as Anthropic.Tool[] } : {}),
      ...(useThinking ? { thinking: { type: 'enabled' as const, budget_tokens: thinkingBudget! } } : {}),
    }, {
      signal: streamSignal,
    });

    // Track tool use blocks as they stream in
    let currentToolUse: { id: string; name: string; inputJson: string } | null = null;
    let isThinkingBlock = false;
    let stopReason: 'end_turn' | 'tool_use' | undefined;
    const usage: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
    let chunksYielded = 0;

    try {
    for await (const event of stream) {
      // Capture token usage from message events
      if (event.type === 'message_start') {
        const msg = (event as unknown as { message?: { usage?: Record<string, number> } }).message;
        if (msg?.usage) {
          usage.inputTokens = msg.usage.input_tokens ?? 0;
          usage.cacheReadInputTokens = msg.usage.cache_read_input_tokens ?? 0;
          usage.cacheCreationInputTokens = msg.usage.cache_creation_input_tokens ?? 0;
        }
      }

      if (event.type === 'content_block_start') {
        if (event.content_block.type === 'tool_use') {
          currentToolUse = {
            id: event.content_block.id,
            name: event.content_block.name,
            inputJson: '',
          };
        } else if ((event.content_block as { type: string }).type === 'thinking') {
          isThinkingBlock = true;
        }
      }

      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield {
          content: event.delta.text,
          done: false,
          provider: 'anthropic',
          model,
        };
        chunksYielded++;
      }

      // Skip thinking_delta events — internal reasoning is not surfaced
      // (thinking blocks use 'thinking_delta', not 'text_delta', so they're
      // already filtered above, but we track the block for content_block_stop)

      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'input_json_delta' &&
        currentToolUse
      ) {
        currentToolUse.inputJson += (event.delta as { partial_json: string }).partial_json;
      }

      if (event.type === 'content_block_stop') {
        if (isThinkingBlock) {
          isThinkingBlock = false;
        } else if (currentToolUse) {
          // Parse accumulated JSON and yield tool use chunk
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(currentToolUse.inputJson || '{}');
          } catch {
            // Fall back to empty input
          }

          yield {
            content: '',
            done: false,
            provider: 'anthropic',
            model,
            toolUse: {
              type: 'tool_use',
              id: currentToolUse.id,
              name: currentToolUse.name,
              input,
            },
          };
          currentToolUse = null;
          chunksYielded++;
        }
      }

      if (event.type === 'message_delta') {
        const delta = event as { type: string; delta: { stop_reason?: string }; usage?: { output_tokens?: number } };
        if (delta.delta.stop_reason === 'tool_use') {
          stopReason = 'tool_use';
        } else if (delta.delta.stop_reason === 'end_turn') {
          stopReason = 'end_turn';
        }
        if (delta.usage?.output_tokens) {
          usage.outputTokens = delta.usage.output_tokens;
        }
      }
    }
    } catch (err) {
      // Thinking fallback: if the provider rejects thinking and we haven't yielded
      // any chunks yet, retry without thinking (v2026.3.1)
      if (attempt === 0 && thinkingBudget && chunksYielded === 0 && isThinkingRejectionError(err)) {
        console.warn(`[anthropic] Thinking rejected for ${model}, retrying with think=off`);
        continue;
      }
      throw err;
    }

    yield {
      content: '',
      done: true,
      provider: 'anthropic',
      model,
      stopReason,
      usage,
    };
    return; // Stream completed successfully
  }
}
