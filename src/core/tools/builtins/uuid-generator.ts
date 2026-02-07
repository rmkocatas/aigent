// ============================================================
// OpenClaw Deploy — UUID Generator Tool
// ============================================================

import { randomUUID } from 'node:crypto';
import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

const MAX_COUNT = 100;

export const uuidGeneratorDefinition: ToolDefinition = {
  name: 'uuid_generator',
  description: 'Generate one or more cryptographically random UUIDs (v4).',
  parameters: {
    type: 'object',
    properties: {
      count: { type: 'number', description: 'Number of UUIDs to generate (1-100, default 1).' },
    },
  },
};

export const uuidGeneratorHandler: ToolHandler = async (input) => {
  const count = (input.count as number) ?? 1;

  if (typeof count !== 'number' || !Number.isInteger(count)) {
    throw new Error('Count must be an integer');
  }
  if (count < 1 || count > MAX_COUNT) {
    throw new Error(`Count must be between 1 and ${MAX_COUNT}`);
  }

  const uuids: string[] = [];
  for (let i = 0; i < count; i++) {
    uuids.push(randomUUID());
  }

  return uuids.join('\n');
};
