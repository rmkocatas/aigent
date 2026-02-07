// ============================================================
// OpenClaw Deploy — Password Generator Tool
// ============================================================

import { randomBytes } from 'node:crypto';
import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const NUMBERS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{}|;:,.<>?';

export const passwordGeneratorDefinition: ToolDefinition = {
  name: 'password_generator',
  description: 'Generate a cryptographically secure random password.',
  parameters: {
    type: 'object',
    properties: {
      length: { type: 'number', description: 'Password length (4-256, default 16).' },
      include_uppercase: { type: 'string', description: 'Include uppercase letters.', enum: ['true', 'false'] },
      include_numbers: { type: 'string', description: 'Include numbers.', enum: ['true', 'false'] },
      include_symbols: { type: 'string', description: 'Include symbols.', enum: ['true', 'false'] },
    },
  },
};

export const passwordGeneratorHandler: ToolHandler = async (input) => {
  const length = (input.length as number) ?? 16;
  const includeUpper = (input.include_uppercase as string) !== 'false';
  const includeNumbers = (input.include_numbers as string) !== 'false';
  const includeSymbols = (input.include_symbols as string) !== 'false';

  if (typeof length !== 'number' || !Number.isInteger(length)) {
    throw new Error('Length must be an integer');
  }
  if (length < 4 || length > 256) {
    throw new Error('Length must be between 4 and 256');
  }

  let pool = LOWERCASE;
  const required: string[] = [LOWERCASE];

  if (includeUpper) { pool += UPPERCASE; required.push(UPPERCASE); }
  if (includeNumbers) { pool += NUMBERS; required.push(NUMBERS); }
  if (includeSymbols) { pool += SYMBOLS; required.push(SYMBOLS); }

  const bytes = randomBytes(length * 2); // extra bytes for rejection sampling
  const chars: string[] = [];

  // Ensure at least one char from each required set
  for (const set of required) {
    const idx = bytes[chars.length] % set.length;
    chars.push(set[idx]);
  }

  // Fill remaining with random pool chars
  let byteIdx = required.length;
  while (chars.length < length) {
    const idx = bytes[byteIdx % bytes.length] % pool.length;
    chars.push(pool[idx]);
    byteIdx++;
  }

  // Shuffle using Fisher-Yates with crypto bytes
  const shuffleBytes = randomBytes(length);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = shuffleBytes[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
};
