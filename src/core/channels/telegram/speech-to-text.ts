// ============================================================
// OpenClaw Deploy — Speech-to-Text via OpenAI Whisper API
// ============================================================

const WHISPER_API_URL = 'https://api.openai.com/v1/audio/transcriptions';
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const TIMEOUT_MS = 30_000;

/**
 * Transcribe an audio buffer to text using the OpenAI Whisper API.
 *
 * Uses Node.js 22 native `FormData` and `Blob` — no extra dependencies.
 */
export async function transcribeAudio(
  buffer: Buffer,
  apiKey: string,
): Promise<string> {
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(
      `Audio file too large: ${(buffer.length / 1024 / 1024).toFixed(1)}MB exceeds 25MB limit`,
    );
  }

  const blob = new Blob([buffer], { type: 'audio/ogg' });
  const form = new FormData();
  form.append('file', blob, 'voice.ogg');
  form.append('model', 'whisper-1');

  const res = await fetch(WHISPER_API_URL, {
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
