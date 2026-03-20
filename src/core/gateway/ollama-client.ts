import type { OllamaConfig, StreamChunk, ToolDefinition } from '../../types/index.js';

export async function* streamOllamaChat(
  config: OllamaConfig,
  messages: Array<{ role: string; content: string; images?: string[]; tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }> }>,
  signal?: AbortSignal,
  tools?: ToolDefinition[],
): AsyncGenerator<StreamChunk> {
  const url = `${config.baseUrl}/api/chat`;

  // Convert tools to Ollama format
  const ollamaTools = tools?.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  // Build messages with images support for multimodal models (e.g. Qwen 3.5)
  const ollamaMessages = messages.map((m) => {
    const msg: Record<string, unknown> = { role: m.role, content: m.content };
    if (m.images && m.images.length > 0) msg.images = m.images;
    if (m.tool_calls) msg.tool_calls = m.tool_calls;
    return msg;
  });

  // Build Ollama options: num_ctx, num_predict, plus any extra options from config
  const options: Record<string, unknown> = {
    ...(config.extraOptions ?? {}),
    ...(config.numCtx ? { num_ctx: config.numCtx } : {}),
    ...(config.numPredict ? { num_predict: config.numPredict } : {}),
  };

  const body = JSON.stringify({
    model: config.model,
    messages: ollamaMessages,
    stream: true,
    ...(ollamaTools && ollamaTools.length > 0 ? { tools: ollamaTools } : {}),
    ...(Object.keys(options).length > 0 ? { options } : {}),
    ...(config.keepAlive ? { keep_alive: config.keepAlive } : {}),
  });

  const effectiveSignal = signal ?? AbortSignal.timeout(300_000);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: effectiveSignal,
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error('Ollama returned no response body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // Track <think>...</think> blocks from reasoning models (e.g. Qwen3) and suppress them
  let insideThink = false;
  let thinkBuffer = '';

  /** Strip think tags from a content chunk, buffering partial tags. Returns content to yield. */
  function filterThinkContent(raw: string): string {
    let result = '';
    const combined = thinkBuffer + raw;
    thinkBuffer = '';

    let i = 0;
    while (i < combined.length) {
      if (insideThink) {
        const closeIdx = combined.indexOf('</think>', i);
        if (closeIdx === -1) {
          // Still inside think block, check for partial closing tag at end
          if (combined.length - i < 8 && combined.slice(i).startsWith('</think'.slice(0, combined.length - i))) {
            thinkBuffer = combined.slice(i);
          }
          break;
        }
        insideThink = false;
        i = closeIdx + 8; // skip past </think>
      } else {
        const openIdx = combined.indexOf('<think>', i);
        if (openIdx === -1) {
          // No think tag — check for partial opening tag at the end
          const remaining = combined.slice(i);
          let partialMatch = 0;
          for (let k = 1; k <= Math.min(7, remaining.length); k++) {
            if ('<think>'.startsWith(remaining.slice(remaining.length - k))) {
              partialMatch = k;
            }
          }
          if (partialMatch > 0) {
            result += remaining.slice(0, remaining.length - partialMatch);
            thinkBuffer = remaining.slice(remaining.length - partialMatch);
          } else {
            result += remaining;
          }
          break;
        }
        result += combined.slice(i, openIdx);
        insideThink = true;
        i = openIdx + 7; // skip past <think>
      }
    }
    return result;
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);

          // Check for tool calls in the response
          if (parsed.message?.tool_calls && parsed.message.tool_calls.length > 0) {
            for (const toolCall of parsed.message.tool_calls) {
              const fn = toolCall.function;
              yield {
                content: '',
                done: false,
                provider: 'ollama',
                model: config.model,
                toolUse: {
                  type: 'tool_use',
                  id: `ollama_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                  name: fn.name,
                  input: fn.arguments ?? {},
                },
                stopReason: 'tool_use',
              };
            }
            if (parsed.done) {
              yield {
                content: '',
                done: true,
                provider: 'ollama',
                model: config.model,
                stopReason: 'tool_use',
              };
              return;
            }
            continue;
          }

          const rawContent = parsed.message?.content ?? '';
          const filtered = filterThinkContent(rawContent);

          yield {
            content: filtered,
            done: parsed.done ?? false,
            provider: 'ollama',
            model: config.model,
          };
          if (parsed.done) return;
        } catch {
          // Skip malformed JSON lines
        }
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer);
        const rawContent = parsed.message?.content ?? '';
        const filtered = filterThinkContent(rawContent);
        yield {
          content: filtered,
          done: parsed.done ?? false,
          provider: 'ollama',
          model: config.model,
        };
      } catch {
        // Skip
      }
    }
  } finally {
    reader.releaseLock();
  }
}
