// ============================================================
// OpenClaw Deploy — Text-to-Speech Tool
// ============================================================
//
// Provider cascade: OpenAI TTS → Edge TTS (free)
// Returns audio as a generated file (sent as voice note in Telegram).
// ============================================================

import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';
import { generateSpeech } from '../../services/tts-provider.js';

const MAX_TEXT_LENGTH = 4096;

export const textToSpeechDefinition: ToolDefinition = {
  name: 'text_to_speech',
  description: 'Convert text to speech audio. Sends the result as a voice message. Max 4096 characters.',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The text to convert to speech (max 4096 chars)',
      },
      voice: {
        type: 'string',
        description: 'Voice to use. Options: "alloy", "echo", "fable", "onyx", "nova", "shimmer" (OpenAI) or "default" (Edge TTS). Default: "nova".',
      },
    },
    required: ['text'],
  },
  routing: {
    useWhen: ['User asks to read something aloud', 'User requests text-to-speech or TTS', 'User says "say this" or "speak"'],
    avoidWhen: ['User is asking about speech recognition or transcription'],
  },
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const textToSpeechHandler: ToolHandler = async (input) => {
  const text = input.text as string;
  if (!text || typeof text !== 'string') throw new Error('Missing text');
  if (text.length > MAX_TEXT_LENGTH) {
    throw new Error(`Text too long (${text.length} chars, max ${MAX_TEXT_LENGTH})`);
  }

  const voice = (input.voice as string) || 'nova';

  const audioBuffer = await generateSpeech(text, voice);
  if (audioBuffer) {
    return `<<AUDIO_BASE64:${audioBuffer.toString('base64')}>>`;
  }

  throw new Error(
    'All TTS providers failed. Configure OPENAI_API_KEY for high-quality TTS, ' +
    'or check network connectivity for free Edge TTS fallback.',
  );
};
