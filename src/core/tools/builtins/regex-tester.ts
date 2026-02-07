// ============================================================
// OpenClaw Deploy — Regex Tester Tool
// ============================================================

import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

const MAX_PATTERN_LENGTH = 500;
const MAX_INPUT_LENGTH = 10_000;
const REGEX_TIMEOUT_MS = 2_000;

export const regexTesterDefinition: ToolDefinition = {
  name: 'regex_tester',
  description: 'Test a regular expression pattern against an input string. Returns all matches with groups and indices.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'The regex pattern (without delimiters).' },
      input: { type: 'string', description: 'The string to test against.' },
      flags: { type: 'string', description: 'Regex flags (default "g"). E.g. "gi", "gm".' },
    },
    required: ['pattern', 'input'],
  },
};

export const regexTesterHandler: ToolHandler = async (input) => {
  const pattern = input.pattern as string;
  const text = input.input as string;
  const flags = (input.flags as string) ?? 'g';

  if (pattern === undefined || pattern === null || typeof pattern !== 'string') {
    throw new Error('Missing pattern');
  }
  if (!text || typeof text !== 'string') {
    throw new Error('Missing input');
  }
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new Error(`Pattern too long (max ${MAX_PATTERN_LENGTH} chars)`);
  }
  if (text.length > MAX_INPUT_LENGTH) {
    throw new Error(`Input too long (max ${MAX_INPUT_LENGTH} chars)`);
  }

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, flags);
  } catch (err) {
    throw new Error(`Invalid regex: ${(err as Error).message}`);
  }

  // Run with timeout to prevent ReDoS
  const matches = await Promise.race<RegExpMatchArray[]>([
    new Promise<RegExpMatchArray[]>((resolve) => {
      const results: RegExpMatchArray[] = [];
      if (flags.includes('g')) {
        let match: RegExpExecArray | null;
        let count = 0;
        while ((match = regex.exec(text)) !== null && count < 100) {
          results.push(match);
          count++;
          if (match[0].length === 0) regex.lastIndex++;
        }
      } else {
        const match = regex.exec(text);
        if (match) results.push(match);
      }
      resolve(results);
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Regex execution timed out (possible catastrophic backtracking)')), REGEX_TIMEOUT_MS),
    ),
  ]);

  if (matches.length === 0) {
    return 'No matches found.';
  }

  const lines = matches.map((m, i) => {
    let line = `Match ${i + 1}: "${m[0]}" at index ${m.index}`;
    if (m.length > 1) {
      const groups = m.slice(1).map((g, gi) => `  Group ${gi + 1}: "${g ?? ''}"`);
      line += '\n' + groups.join('\n');
    }
    return line;
  });

  return `${matches.length} match(es) found:\n\n${lines.join('\n\n')}`;
};
