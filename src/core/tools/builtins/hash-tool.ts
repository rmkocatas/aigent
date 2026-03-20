// ============================================================
// OpenClaw Deploy — Hash Tool
// ============================================================

import { createHash } from 'node:crypto';
import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

const SUPPORTED_ALGORITHMS = ['md5', 'sha256', 'sha512'] as const;
const MAX_INPUT_LENGTH = 1_048_576; // 1MB

export const hashToolDefinition: ToolDefinition = {
  name: 'hash_tool',
  description: 'Compute a cryptographic hash of the given input text.',
  parameters: {
    type: 'object',
    properties: {
      input: { type: 'string', description: 'The text to hash.' },
      algorithm: {
        type: 'string',
        description: 'Hash algorithm to use.',
        enum: ['md5', 'sha256', 'sha512'],
      },
    },
    required: ['input', 'algorithm'],
  },
  routing: {
    useWhen: ['User asks to hash a string or compute a checksum (MD5, SHA-256, etc.)'],
    avoidWhen: ['User is asking about hashing concepts, not computing an actual hash'],
  },
};

export const hashToolHandler: ToolHandler = async (input) => {
  const text = input.input as string;
  const algorithm = input.algorithm as string;

  if (text === undefined || text === null || typeof text !== 'string') {
    throw new Error('Missing input');
  }
  if (text.length > MAX_INPUT_LENGTH) {
    throw new Error('Input too large (max 1MB)');
  }
  if (!SUPPORTED_ALGORITHMS.includes(algorithm as typeof SUPPORTED_ALGORITHMS[number])) {
    throw new Error(`Unsupported algorithm: ${algorithm}. Use: ${SUPPORTED_ALGORITHMS.join(', ')}`);
  }

  const hash = createHash(algorithm).update(text, 'utf-8').digest('hex');
  return `${algorithm.toUpperCase()}: ${hash}`;
};
