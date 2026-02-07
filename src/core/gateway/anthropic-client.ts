import Anthropic from '@anthropic-ai/sdk';
import type { StreamChunk, ToolDefinition, ContentBlock } from '../../types/index.js';

export async function* streamAnthropicChat(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string | ContentBlock[] }>,
  _signal?: AbortSignal,
  tools?: ToolDefinition[],
): AsyncGenerator<StreamChunk> {
  const client = new Anthropic({ apiKey });

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

  // Ensure messages alternate and start with user
  if (chatMessages.length === 0 || chatMessages[0].role !== 'user') {
    throw new Error('Conversation must start with a user message');
  }

  // Convert tool definitions to Anthropic format
  const anthropicTools = tools?.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: 'object' as const,
      properties: t.parameters.properties,
      required: t.parameters.required,
    },
  }));

  const stream = client.messages.stream({
    model,
    max_tokens: 4096,
    messages: chatMessages as Anthropic.MessageParam[],
    ...(systemMessages.length > 0
      ? { system: typeof systemMessages[0].content === 'string' ? systemMessages[0].content : '' }
      : {}),
    ...(anthropicTools && anthropicTools.length > 0 ? { tools: anthropicTools as Anthropic.Tool[] } : {}),
  });

  // Track tool use blocks as they stream in
  let currentToolUse: { id: string; name: string; inputJson: string } | null = null;
  let stopReason: 'end_turn' | 'tool_use' | undefined;

  for await (const event of stream) {
    if (event.type === 'content_block_start') {
      if (event.content_block.type === 'tool_use') {
        currentToolUse = {
          id: event.content_block.id,
          name: event.content_block.name,
          inputJson: '',
        };
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
    }

    if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'input_json_delta' &&
      currentToolUse
    ) {
      currentToolUse.inputJson += (event.delta as { partial_json: string }).partial_json;
    }

    if (event.type === 'content_block_stop' && currentToolUse) {
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
    }

    if (event.type === 'message_delta') {
      const delta = event as { type: string; delta: { stop_reason?: string } };
      if (delta.delta.stop_reason === 'tool_use') {
        stopReason = 'tool_use';
      } else if (delta.delta.stop_reason === 'end_turn') {
        stopReason = 'end_turn';
      }
    }
  }

  yield {
    content: '',
    done: true,
    provider: 'anthropic',
    model,
    stopReason,
  };
}
