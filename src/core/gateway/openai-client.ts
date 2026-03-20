import type { StreamChunk, ToolDefinition, ContentBlock, TokenUsage } from '../../types/index.js';

/**
 * OpenAI Chat Completions streaming client.
 * Uses raw fetch + SSE parsing — no npm dependency required.
 */
export async function* streamOpenAIChat(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string | ContentBlock[] }>,
  signal?: AbortSignal,
  tools?: ToolDefinition[],
): AsyncGenerator<StreamChunk> {
  const openaiMessages = convertMessages(messages);

  const openaiTools = tools?.length
    ? tools.map((t) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: {
            type: 'object',
            properties: t.parameters.properties,
            required: t.parameters.required,
          },
        },
      }))
    : undefined;

  const body: Record<string, unknown> = {
    model,
    messages: openaiMessages,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: 8192,
  };
  if (openaiTools) {
    body.tools = openaiTools;
  }

  // Combine external signal with a 2-min per-stream timeout
  const streamSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
    : AbortSignal.timeout(120_000);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: streamSignal,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errText}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // Accumulate tool calls as they stream in (keyed by index)
  const pendingToolCalls = new Map<number, { id: string; name: string; arguments: string }>();
  let stopReason: 'end_turn' | 'tool_use' | undefined;
  const usage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop()!; // Keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') continue;

      let chunk: any;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }

      const choice = chunk.choices?.[0];
      if (choice) {
        const delta = choice.delta;

        // Text content
        if (delta?.content) {
          yield { content: delta.content, done: false, provider: 'openai', model };
        }

        // Tool calls — streamed incrementally
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx: number = tc.index;
            if (tc.id) {
              // First chunk of a new tool call
              pendingToolCalls.set(idx, {
                id: tc.id,
                name: tc.function?.name ?? '',
                arguments: tc.function?.arguments ?? '',
              });
            } else if (pendingToolCalls.has(idx)) {
              // Continuation — accumulate name/args
              const existing = pendingToolCalls.get(idx)!;
              if (tc.function?.name) existing.name = tc.function.name;
              if (tc.function?.arguments) existing.arguments += tc.function.arguments;
            }
          }
        }

        // Finish reason
        if (choice.finish_reason === 'stop') {
          stopReason = 'end_turn';
        } else if (choice.finish_reason === 'tool_calls') {
          stopReason = 'tool_use';
        }
      }

      // Usage info (comes in the final chunk when stream_options.include_usage is true)
      if (chunk.usage) {
        usage.inputTokens = chunk.usage.prompt_tokens ?? 0;
        usage.outputTokens = chunk.usage.completion_tokens ?? 0;
        // OpenAI reports cached tokens under prompt_tokens_details
        usage.cacheReadInputTokens = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
      }
    }
  }

  // Yield accumulated tool calls as individual StreamChunks
  for (const [, tc] of pendingToolCalls) {
    let input: Record<string, unknown> = {};
    try {
      input = JSON.parse(tc.arguments || '{}');
    } catch {
      // Fall back to empty input
    }

    yield {
      content: '',
      done: false,
      provider: 'openai',
      model,
      toolUse: {
        type: 'tool_use',
        id: tc.id,
        name: tc.name,
        input,
      },
    };
  }

  // Final done chunk
  yield {
    content: '',
    done: true,
    provider: 'openai',
    model,
    stopReason,
    usage,
  };
}

// ---------------------------------------------------------------------------
// Message format conversion: OpenClaw ContentBlock[] → OpenAI messages
// ---------------------------------------------------------------------------

function convertMessages(
  messages: Array<{ role: string; content: string | ContentBlock[] }>,
): any[] {
  const result: any[] = [];

  for (const msg of messages) {
    // Plain string content — pass through
    if (typeof msg.content === 'string') {
      result.push({ role: msg.role, content: msg.content });
      continue;
    }

    const blocks = msg.content as ContentBlock[];

    if (msg.role === 'assistant') {
      // Split into text + tool_use
      const textParts = blocks
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('');
      const toolUses = blocks.filter((b) => b.type === 'tool_use');

      const assistantMsg: any = { role: 'assistant' };
      assistantMsg.content = textParts || null;

      if (toolUses.length > 0) {
        assistantMsg.tool_calls = toolUses.map((t: any) => ({
          id: t.id,
          type: 'function',
          function: {
            name: t.name,
            arguments: JSON.stringify(t.input ?? {}),
          },
        }));
      }

      result.push(assistantMsg);
    } else if (msg.role === 'user') {
      // User messages may contain tool_results (→ OpenAI "tool" role), text, and images
      const toolResults = blocks.filter((b) => b.type === 'tool_result');
      const otherBlocks = blocks.filter((b) => b.type !== 'tool_result');

      // Tool results become separate "tool" messages (must precede user content)
      for (const tr of toolResults) {
        result.push({
          role: 'tool',
          tool_call_id: (tr as any).tool_use_id,
          content: (tr as any).content ?? '',
        });
      }

      // Remaining blocks become a user message
      if (otherBlocks.length > 0) {
        const parts: any[] = [];
        for (const block of otherBlocks) {
          if (block.type === 'text') {
            parts.push({ type: 'text', text: (block as { text: string }).text });
          } else if (block.type === 'image') {
            const img = block as {
              source: { media_type: string; data: string };
            };
            parts.push({
              type: 'image_url',
              image_url: {
                url: `data:${img.source.media_type};base64,${img.source.data}`,
              },
            });
          }
        }

        if (parts.length === 1 && parts[0].type === 'text') {
          result.push({ role: 'user', content: parts[0].text });
        } else if (parts.length > 0) {
          result.push({ role: 'user', content: parts });
        }
      }
    } else {
      // System or other roles — extract text
      const text = blocks
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('');
      result.push({ role: msg.role, content: text });
    }
  }

  return result;
}
