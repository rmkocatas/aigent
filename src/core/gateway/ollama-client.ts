import type { OllamaConfig, StreamChunk, ToolDefinition } from '../../types/index.js';

export async function* streamOllamaChat(
  config: OllamaConfig,
  messages: Array<{ role: string; content: string }>,
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

  const body = JSON.stringify({
    model: config.model,
    messages,
    stream: true,
    ...(ollamaTools && ollamaTools.length > 0 ? { tools: ollamaTools } : {}),
  });

  const effectiveSignal = signal ?? AbortSignal.timeout(120_000);

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

          yield {
            content: parsed.message?.content ?? '',
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
        yield {
          content: parsed.message?.content ?? '',
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
