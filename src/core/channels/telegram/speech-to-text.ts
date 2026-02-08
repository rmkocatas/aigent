// ============================================================
// OpenClaw Deploy — Speech-to-Text (Multi-provider)
// ============================================================
// Supports: OpenAI Whisper, Groq Whisper, Hugging Face Inference API

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const TIMEOUT_MS = 30_000;

export interface WhisperConfig {
  apiUrl?: string;
  model?: string;
  provider?: 'openai' | 'huggingface';
}

/**
 * Transcribe an audio buffer to text.
 *
 * - OpenAI/Groq: multipart form with file + model fields
 * - Hugging Face: raw binary POST to inference API
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

  const provider = config?.provider || 'openai';

  if (provider === 'huggingface') {
    return transcribeHuggingFace(buffer, apiKey, config);
  }

  return transcribeOpenAICompat(buffer, apiKey, config);
}

async function transcribeOpenAICompat(
  buffer: Buffer,
  apiKey: string,
  config?: WhisperConfig,
): Promise<string> {
  const apiUrl = config?.apiUrl || 'https://api.openai.com/v1/audio/transcriptions';
  const model = config?.model || 'whisper-1';

  const blob = new Blob([buffer], { type: 'audio/ogg' });
  const form = new FormData();
  form.append('file', blob, 'voice.ogg');
  form.append('model', model);

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
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

async function transcribeHuggingFace(
  buffer: Buffer,
  apiKey: string,
  config?: WhisperConfig,
): Promise<string> {
  const model = config?.model || 'openai/whisper-large-v3-turbo';
  const apiUrl = `https://router.huggingface.co/hf-inference/models/${model}`;

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'audio/ogg',
    },
    body: buffer,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HuggingFace API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { text: string };
  return data.text;
}
