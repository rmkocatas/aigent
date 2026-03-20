// ============================================================
// OpenClaw Deploy — Web Search Tool
// ============================================================

import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';
import { duckDuckGoSearch, createRateLimiter } from './ddg-search.js';

export const webSearchDefinition: ToolDefinition = {
  name: 'web_search',
  description: 'Search the web for current information. Returns titles, URLs, and snippets from search results.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query.',
      },
      max_results: {
        type: 'number',
        description: 'Maximum number of results to return (1-10, default 5).',
      },
    },
    required: ['query'],
  },
  routing: {
    useWhen: ['User asks about current events or recent information', 'User needs real-time or up-to-date data', 'User asks you to look something up or fact-check'],
    avoidWhen: ['User asks a well-known fact or definition you already know', 'User is asking about math, coding syntax, or something you can answer directly', 'User is asking about historical or general knowledge'],
  },
};

const rateLimiter = createRateLimiter(2000);

export const webSearchHandler: ToolHandler = async (input, context) => {
  const query = input.query as string;
  if (!query || typeof query !== 'string') {
    throw new Error('Missing search query');
  }

  const maxResults = Math.min(Math.max((input.max_results as number) || 5, 1), 10);

  const userKey = context?.userId ?? '_global';
  await rateLimiter.waitIfNeeded(userKey);

  const results = await duckDuckGoSearch(query, maxResults);

  if (results.length === 0) {
    return 'No search results found.';
  }

  return results
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
    .join('\n\n');
};
