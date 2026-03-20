// ============================================================
// OpenClaw Deploy — Base64 / URL Codec Tool
// ============================================================

import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

const MAX_INPUT_LENGTH = 1_048_576; // 1MB

export const base64CodecDefinition: ToolDefinition = {
  name: 'base64_codec',
  description: 'Encode or decode text using Base64 or URL encoding.',
  parameters: {
    type: 'object',
    properties: {
      input: { type: 'string', description: 'The text to encode or decode.' },
      operation: {
        type: 'string',
        description: 'Operation to perform.',
        enum: ['base64_encode', 'base64_decode', 'url_encode', 'url_decode'],
      },
    },
    required: ['input', 'operation'],
  },
  routing: {
    useWhen: ['User asks to encode or decode a base64 string'],
    avoidWhen: ['User is asking about base64 as a concept'],
  },
};

export const base64CodecHandler: ToolHandler = async (input) => {
  const text = input.input as string;
  const operation = input.operation as string;

  if (text === undefined || text === null || typeof text !== 'string') {
    throw new Error('Missing input');
  }
  if (text.length > MAX_INPUT_LENGTH) {
    throw new Error('Input too large (max 1MB)');
  }

  switch (operation) {
    case 'base64_encode':
      return Buffer.from(text, 'utf-8').toString('base64');

    case 'base64_decode':
      try {
        return Buffer.from(text, 'base64').toString('utf-8');
      } catch {
        throw new Error('Invalid base64 input');
      }

    case 'url_encode':
      return encodeURIComponent(text);

    case 'url_decode':
      try {
        return decodeURIComponent(text);
      } catch {
        throw new Error('Invalid URL-encoded input');
      }

    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
};
