// ============================================================
// OpenClaw Deploy — QR Code Generator Tool
// ============================================================

import QRCode from 'qrcode';
import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

const MAX_TEXT_LENGTH = 2048;

export const qrGeneratorDefinition: ToolDefinition = {
  name: 'qr_generator',
  description: 'Generate a QR code as text/ASCII art from the given text or URL.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The text or URL to encode (max 2048 chars).' },
      error_correction: {
        type: 'string',
        description: 'Error correction level.',
        enum: ['L', 'M', 'Q', 'H'],
      },
    },
    required: ['text'],
  },
  routing: {
    useWhen: ['User asks to generate or create a QR code'],
    avoidWhen: ['User is asking about QR codes conceptually', 'User wants to read/scan a QR code'],
  },
};

export const qrGeneratorHandler: ToolHandler = async (input) => {
  const text = input.text as string;
  const errorCorrection = (input.error_correction as string) ?? 'M';

  if (!text || typeof text !== 'string') throw new Error('Missing text');
  if (text.length > MAX_TEXT_LENGTH) throw new Error(`Text too long (max ${MAX_TEXT_LENGTH} chars)`);

  const qr = await QRCode.toString(text, {
    type: 'utf8',
    errorCorrectionLevel: errorCorrection as 'L' | 'M' | 'Q' | 'H',
  });

  return qr;
};
