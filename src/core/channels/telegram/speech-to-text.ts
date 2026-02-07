// ============================================================
// OpenClaw Deploy — Speech-to-Text (Whisper-compatible API)
// ============================================================
// Supports OpenAI Whisper and Groq Whisper (free tier).

const DEFAULT_API_URL = 'https://api.openai.com/v1/audio/transcriptions';
const DEFAULT_MODEL = 'whisper-1';
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const TIMEOUT_MS = 30_000;

export interface WhisperConfig {
  apiUrl?: string;
  model?: string;
}

/**
 * Transcribe an audio buffer to text using a Whisper-compatible API.
 *
 * Works with OpenAI, Groq, and any OpenAI-compatible endpoint.
 * Uses Node.js 22 native `FormData` and `Blob` — no extra dependencies.
 */
export async function transcribeAudio(
  buffer: Buffer,
  apiKey: string,
  config?: WhisperConfig,
): Promise<string> {
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(
      `Audio file too large: ${(buffer.length / 1024 / 1024).toFixed(1)}MB exceeds 25MB limit`,
    );
  }

  const apiUrl = config?.apiUrl || DEFAULT_API_URL;
  const model = config?.model || DEFAULT_MODEL;

  const blob = new Blob([buffer], { type: 'audio/ogg' });
  const form = new FormData();
  form.append('file', blob, 'voice.ogg');
  form.append('model', model);

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Whisper API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { text: string };
  return data.text;
}
