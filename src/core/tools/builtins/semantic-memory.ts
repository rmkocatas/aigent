// ============================================================
// OpenClaw Deploy — Semantic Memory Tools
// ============================================================

import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';
import type { MemoryEngine } from '../../services/memory/memory-engine.js';

// Singleton set by server.ts after construction
let memoryEngine: MemoryEngine | null = null;

export function setMemoryEngine(engine: MemoryEngine): void {
  memoryEngine = engine;
}

// ---------------------------------------------------------------------------
// memory_recall
// ---------------------------------------------------------------------------

export const memoryRecallDefinition: ToolDefinition = {
  name: 'memory_recall',
  description:
    'Search the SECONDARY semantic memory index. NOTE: Your PRIMARY memory is memory.md (use project_read_file). Only use this tool as a fallback if memory.md does not have what you need.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Natural language search query (e.g., "what does the user do for work?" or "their food preferences")',
      },
      max_results: {
        type: 'string',
        description: 'Maximum results to return (default 5)',
      },
    },
    required: ['query'],
  },
  routing: {
    useWhen: [
      'You already checked memory.md and need additional context not found there',
      'Searching for facts from older conversations not yet in memory.md',
    ],
    avoidWhen: [
      'You have not checked memory.md yet — check it first with project_read_file',
      'User is asking a general knowledge question',
      'This is about current conversation context only',
    ],
  },
};

export const memoryRecallHandler: ToolHandler = async (input, context) => {
  if (!memoryEngine) return 'Semantic memory not available.';

  const query = input.query as string;
  if (!query) throw new Error('Missing query');

  const maxResults = parseInt(String(input.max_results ?? '5'), 10);
  const results = await memoryEngine.search(
    context.userId,
    query,
    Math.min(maxResults, 20),
  );

  if (results.length === 0) return `No memories found matching "${query}".`;

  const lines = results.map((r, i) => {
    const score = (r.score * 100).toFixed(0);
    const meta = [
      ...r.entry.metadata.persons.map((p) => `@${p}`),
      ...r.entry.metadata.topics.map((t) => `#${t}`),
    ].join(' ');
    return `${i + 1}. [${score}%] ${r.entry.fact}${meta ? ` (${meta})` : ''}`;
  });

  return `${results.length} relevant memories:\n${lines.join('\n')}`;
};

// ---------------------------------------------------------------------------
// memory_remember
// ---------------------------------------------------------------------------

export const memoryRememberDefinition: ToolDefinition = {
  name: 'memory_remember',
  description:
    'Store a fact in the SECONDARY semantic memory index. NOTE: Your PRIMARY memory is memory.md (use project_write_file to update it). Prefer writing to memory.md over using this tool.',
  parameters: {
    type: 'object',
    properties: {
      fact: {
        type: 'string',
        description:
          'A self-contained fact to remember (e.g., "Roman prefers dark mode in all applications")',
      },
    },
    required: ['fact'],
  },
  routing: {
    useWhen: [
      'You already wrote to memory.md AND also want a semantic index entry as backup',
    ],
    avoidWhen: [
      'You have not updated memory.md yet — update memory.md first with project_write_file',
      'Information is temporary or session-specific',
      'User is just making conversation',
    ],
  },
};

export const memoryRememberHandler: ToolHandler = async (input, context) => {
  if (!memoryEngine) return 'Semantic memory not available.';

  const fact = input.fact as string;
  if (!fact) throw new Error('Missing fact');
  if (fact.length > 500) throw new Error('Fact too long (max 500 chars)');

  return memoryEngine.explicitStore(context.userId, fact, context.conversationId);
};

// ---------------------------------------------------------------------------
// memory_forget
// ---------------------------------------------------------------------------

export const memoryForgetDefinition: ToolDefinition = {
  name: 'memory_forget',
  description:
    'Remove a fact from semantic long-term memory by searching for it or by its ID.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'The memory to forget — either a memory ID or a natural language description.',
      },
    },
    required: ['query'],
  },
  routing: {
    useWhen: [
      'User asks you to forget something specific',
      'User says information is outdated or wrong',
    ],
    avoidWhen: [
      'User is correcting information (store updated fact instead)',
    ],
  },
};

export const memoryForgetHandler: ToolHandler = async (input, context) => {
  if (!memoryEngine) return 'Semantic memory not available.';

  const query = input.query as string;
  if (!query) throw new Error('Missing query');

  return memoryEngine.explicitForget(context.userId, query);
};
