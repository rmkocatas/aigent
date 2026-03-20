// ============================================================
// OpenClaw Deploy — Local Ollama Embedding Client
// ============================================================

import type { OllamaConfig } from '../../../types/index.js';

let embeddingAvailable: boolean | null = null;

export async function getEmbedding(
  ollamaConfig: OllamaConfig,
  model: string,
  text: string,
): Promise<number[] | null> {
  if (embeddingAvailable === false) return null;

  try {
    const url = `${ollamaConfig.baseUrl}/api/embed`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: text }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.warn(
          `[memory] Embedding model "${model}" not available. Falling back to keyword search.`,
        );
        embeddingAvailable = false;
        return null;
      }
      throw new Error(`Embedding error: ${response.status}`);
    }

    const data = (await response.json()) as { embeddings?: number[][] };
    embeddingAvailable = true;
    return data.embeddings?.[0] ?? null;
  } catch (err) {
    if (embeddingAvailable === null) {
      console.warn('[memory] Ollama embedding unavailable, using keyword-only search');
      embeddingAvailable = false;
    }
    return null;
  }
}

export function resetEmbeddingAvailability(): void {
  embeddingAvailable = null;
}

export function isEmbeddingAvailable(): boolean {
  return embeddingAvailable !== false;
}
