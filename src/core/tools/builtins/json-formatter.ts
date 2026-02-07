// ============================================================
// OpenClaw Deploy — JSON Formatter Tool
// ============================================================

import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

const MAX_INPUT_LENGTH = 1_048_576; // 1MB

export const jsonFormatterDefinition: ToolDefinition = {
  name: 'json_formatter',
  description: 'Pretty-print, minify, or validate a JSON string.',
  parameters: {
    type: 'object',
    properties: {
      json: { type: 'string', description: 'The JSON string to process.' },
      operation: {
        type: 'string',
        description: 'Operation to perform.',
        enum: ['prettify', 'minify', 'validate'],
      },
      indent: { type: 'number', description: 'Indentation spaces for prettify (default 2).' },
    },
    required: ['json', 'operation'],
  },
};

export const jsonFormatterHandler: ToolHandler = async (input) => {
  const json = input.json as string;
  const operation = input.operation as string;
  const indent = (input.indent as number) ?? 2;

  if (!json || typeof json !== 'string') {
    throw new Error('Missing json input');
  }
  if (json.length > MAX_INPUT_LENGTH) {
    throw new Error('Input too large (max 1MB)');
  }

  if (operation === 'validate') {
    try {
      JSON.parse(json);
      return 'Valid JSON.';
    } catch (err) {
      return `Invalid JSON: ${(err as Error).message}`;
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(`Invalid JSON: ${(err as Error).message}`);
  }

  if (operation === 'prettify') {
    return JSON.stringify(parsed, null, indent);
  }
  if (operation === 'minify') {
    return JSON.stringify(parsed);
  }

  throw new Error(`Unknown operation: ${operation}. Use: prettify, minify, validate`);
};
