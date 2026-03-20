// ============================================================
// OpenClaw Deploy — X/Twitter Search Tool
// ============================================================
//
// Searches X (formerly Twitter) for recent posts and discussions.
// Uses DuckDuckGo with site:x.com filtering (free, no API key).
// Falls back to site:twitter.com if needed.
// ============================================================

import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';
import { duckDuckGoSearch, createRateLimiter } from './ddg-search.js';

export const xSearchDefinition: ToolDefinition = {
  name: 'x_search',
  description:
    'Search X (formerly Twitter) for recent posts, discussions, and trends. ' +
    'Returns tweet content, authors, and links. Useful for finding public opinions, ' +
    'breaking news reactions, and trending discussions.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query (e.g., "AI agents 2026", "@elonmusk about AI").',
      },
      max_results: {
        type: 'number',
        description: 'Maximum number of results to return (1-15, default 10).',
      },
      sort: {
        type: 'string',
        enum: ['recent', 'relevant'],
        description: 'Sort by recency or relevance (default: recent).',
      },
    },
    required: ['query'],
  },
  routing: {
    useWhen: [
      'User asks about Twitter or X posts or discussions',
      'User wants to find tweets or social media reactions',
      'User asks about trending topics or public opinions on X',
    ],
    avoidWhen: [
      'User wants general web search (use web_search instead)',
      'User is not asking about social media or X/Twitter specifically',
    ],
  },
};

const rateLimiter = createRateLimiter(2000);

export const xSearchHandler: ToolHandler = async (input, context) => {
  const query = input.query as string;
  if (!query || typeof query !== 'string') {
    throw new Error('Missing search query');
  }

  const maxResults = Math.min(Math.max((input.max_results as number) || 10, 1), 15);
  const sort = (input.sort as string) === 'relevant' ? 'relevant' : 'recent';

  const userKey = context?.userId ?? '_global';
  await rateLimiter.waitIfNeeded(userKey);

  // Strategy: search DuckDuckGo with site:x.com prefix
  const sortHint = sort === 'recent' ? ' ' + new Date().getFullYear() : '';
  const searchQuery = `site:x.com ${query}${sortHint}`;

  const results = await duckDuckGoSearch(searchQuery, maxResults, ['x.com', 'twitter.com']);

  // If we got very few results, try twitter.com as well
  if (results.length < 3) {
    const fallbackQuery = `site:twitter.com ${query}${sortHint}`;
    try {
      const fallbackResults = await duckDuckGoSearch(
        fallbackQuery,
        maxResults - results.length,
        ['x.com', 'twitter.com'],
      );
      for (const r of fallbackResults) {
        if (!results.some((existing) => existing.url === r.url)) {
          results.push(r);
        }
      }
    } catch {
      // Fallback is best-effort
    }
  }

  if (results.length === 0) {
    return `No X/Twitter results found for "${query}". Try a broader search term.`;
  }

  // Format results with tweet-specific parsing
  const formatted = results.slice(0, maxResults).map((r, i) => {
    const author = extractAuthor(r.url);
    const authorStr = author ? `@${author}` : 'Unknown';
    return `${i + 1}. ${authorStr}: ${r.title}\n   ${r.snippet}\n   ${r.url}`;
  });

  return `X/Twitter results for "${query}" (${formatted.length} results):\n\n${formatted.join('\n\n')}`;
};

// ── Helpers ───────────────────────────────────────────────────

function extractAuthor(url: string): string | null {
  const match = url.match(/(?:x\.com|twitter\.com)\/([a-zA-Z0-9_]+)/);
  if (match && !['search', 'hashtag', 'i', 'explore'].includes(match[1])) {
    return match[1];
  }
  return null;
}
