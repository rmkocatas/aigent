// ============================================================
// OpenClaw Deploy — Memory Tool (Persistent KV Store)
// ============================================================

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

const MAX_KEYS = 100;
const MAX_VALUE_SIZE = 10_240; // 10KB

export const memoryReadDefinition: ToolDefinition = {
  name: 'memory_read',
  description: 'Read a value from persistent memory for this user. Memory persists across conversations.',
  parameters: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'The key to read.',
      },
    },
    required: ['key'],
  },
  routing: {
    useWhen: ['Checking if something was previously stored about the user', 'User asks you to recall a preference or fact'],
    avoidWhen: ['This is the very first interaction with no prior context', 'User is asking a general question unrelated to stored preferences'],
  },
};

export const memoryWriteDefinition: ToolDefinition = {
  name: 'memory_write',
  description: 'Write a value to persistent memory for this user. Use this to remember facts about the user across conversations.',
  parameters: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'The key to store under.',
      },
      value: {
        type: 'string',
        description: 'The value to store.',
      },
    },
    required: ['key', 'value'],
  },
  routing: {
    useWhen: ['User explicitly asks you to remember something', 'User states a personal preference or important fact to save'],
    avoidWhen: ['Information is temporary or session-specific', 'User is just making conversation, not asking you to remember'],
  },
};

function sanitizeId(id: string): string {
  // Replace any non-alphanumeric/dash/underscore chars
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

async function loadMemory(
  memoryDir: string,
  conversationId: string,
): Promise<Record<string, string>> {
  const filePath = join(memoryDir, `${sanitizeId(conversationId)}.json`);
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function saveMemory(
  memoryDir: string,
  conversationId: string,
  data: Record<string, string>,
): Promise<void> {
  await mkdir(memoryDir, { recursive: true });
  const filePath = join(memoryDir, `${sanitizeId(conversationId)}.json`);
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export const memoryReadHandler: ToolHandler = async (input, context) => {
  const key = input.key as string;
  if (!key || typeof key !== 'string') {
    throw new Error('Missing key');
  }

  const data = await loadMemory(context.memoryDir, context.userId);
  const value = data[key];
  if (value === undefined) {
    return `No value stored for key "${key}".`;
  }
  return value;
};

export const memoryWriteHandler: ToolHandler = async (input, context) => {
  const key = input.key as string;
  const value = input.value as string;

  if (!key || typeof key !== 'string') {
    throw new Error('Missing key');
  }
  if (value === undefined || value === null) {
    throw new Error('Missing value');
  }

  const valueStr = String(value);
  if (valueStr.length > MAX_VALUE_SIZE) {
    throw new Error(`Value too large (max ${MAX_VALUE_SIZE} bytes)`);
  }

  const data = await loadMemory(context.memoryDir, context.userId);

  if (!(key in data) && Object.keys(data).length >= MAX_KEYS) {
    throw new Error(`Memory limit reached (max ${MAX_KEYS} keys per user)`);
  }

  data[key] = valueStr;
  await saveMemory(context.memoryDir, context.userId, data);
  return `Stored "${key}" in memory.`;
};
