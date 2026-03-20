// ============================================================
// OpenClaw Deploy — Shared TTS Provider
// ============================================================
//
// Provider cascade: OpenAI TTS → Edge TTS (free).
// Shared by the text_to_speech tool and auto-voice-reply.
// ============================================================

// ---------------------------------------------------------------------------
// Provider: OpenAI TTS API
// ---------------------------------------------------------------------------

async function tryOpenAITTS(
  text: string,
  voice: string,
): Promise<Buffer | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: text,
        voice: voice || 'nova',
        response_format: 'opus',
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) return null;

    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Provider: Edge TTS (Microsoft, free, no API key)
// ---------------------------------------------------------------------------

async function tryEdgeTTS(text: string): Promise<Buffer | null> {
  try {
    const encodedText = encodeURIComponent(text.slice(0, 1000));
    const res = await fetch(
      `https://api.streamelements.com/kappa/v2/speech?voice=en-US-JennyNeural&text=${encodedText}`,
      { signal: AbortSignal.timeout(15_000) },
    );

    if (!res.ok) return null;

    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate speech audio from text using the provider cascade.
 * Returns a Buffer (opus/ogg for OpenAI, mp3 for Edge) or null if all fail.
 */
export async function generateSpeech(
  text: string,
  voice: string = 'nova',
): Promise<Buffer | null> {
  const openaiResult = await tryOpenAITTS(text, voice);
  if (openaiResult) return openaiResult;

  const edgeResult = await tryEdgeTTS(text);
  if (edgeResult) return edgeResult;

  return null;
}
