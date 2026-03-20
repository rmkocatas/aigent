// ============================================================
// OpenClaw Deploy — Shared DuckDuckGo Search Utilities
// ============================================================
//
// Common search parsing, rate limiting, and SSRF-safe fetching
// shared between web-search, x-search, and x-research tools.
// ============================================================

import { validateUrlSafety } from './fetch-url.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface RateLimiter {
  waitIfNeeded(userId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Rate limiter factory
// ---------------------------------------------------------------------------

export function createRateLimiter(intervalMs: number = 2000): RateLimiter {
  const lastRequestByUser = new Map<string, number>();
  return {
    async waitIfNeeded(userId: string): Promise<void> {
      const lastTime = lastRequestByUser.get(userId) ?? 0;
      const now = Date.now();
      const elapsed = now - lastTime;
      if (elapsed < intervalMs) {
        await new Promise((r) => setTimeout(r, intervalMs - elapsed));
      }
      lastRequestByUser.set(userId, Date.now());
    },
  };
}

// ---------------------------------------------------------------------------
// DuckDuckGo HTML search
// ---------------------------------------------------------------------------

/**
 * Perform a DuckDuckGo HTML search and return parsed results.
 * @param query       — search query (may include site:x.com prefix)
 * @param maxResults  — maximum results to return
 * @param siteFilter  — optional domain(s) to keep (e.g. ['x.com', 'twitter.com'])
 */
export async function duckDuckGoSearch(
  query: string,
  maxResults: number,
  siteFilter?: string | string[],
): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MoltBot/1.0)' },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Search request failed: ${response.status}`);
  }

  const html = await response.text();
  return parseSearchResults(html, maxResults, siteFilter);
}

// ---------------------------------------------------------------------------
// HTML parsing
// ---------------------------------------------------------------------------

export function parseSearchResults(
  html: string,
  maxResults: number,
  siteFilter?: string | string[],
): SearchResult[] {
  const results: SearchResult[] = [];
  const filters = siteFilter
    ? (Array.isArray(siteFilter) ? siteFilter : [siteFilter])
    : null;

  const resultBlocks = html.split(/class="result__body"/);

  for (let i = 1; i < resultBlocks.length && results.length < maxResults; i++) {
    const block = resultBlocks[i];

    const titleMatch = block.match(
      /class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/,
    );
    if (!titleMatch) continue;

    let resultUrl = titleMatch[1];
    const title = stripHtmlTags(titleMatch[2]).trim();

    // Extract actual URL from DuckDuckGo redirect
    const uddgMatch = resultUrl.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      resultUrl = decodeURIComponent(uddgMatch[1]);
    }

    // Apply domain filter if specified
    if (filters && !filters.some((f) => resultUrl.includes(f))) {
      continue;
    }

    const snippetMatch = block.match(
      /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|span)>/,
    );
    const snippet = snippetMatch ? stripHtmlTags(snippetMatch[1]).trim() : '';

    if (title && resultUrl) {
      results.push({ title, url: resultUrl, snippet });
    }
  }

  return results;
}

export function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------
// SSRF-safe URL content fetcher
// ---------------------------------------------------------------------------

/**
 * Fetch a URL's text content with SSRF protection and HTML stripping.
 * Reuses validateUrlSafety from fetch-url.ts.
 */
export async function fetchPageContent(
  url: string,
  maxSize: number = 15_000,
): Promise<string> {
  await validateUrlSafety(url);

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; MoltBot/1.0)',
      'Accept': 'text/html, text/plain, */*',
    },
    signal: AbortSignal.timeout(10_000),
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const raw = await response.text();

  let text: string;
  if (contentType.includes('application/json')) {
    try {
      text = JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      text = raw;
    }
  } else if (contentType.includes('text/plain')) {
    text = raw;
  } else {
    text = stripFullHtml(raw);
  }

  return text.length > maxSize ? text.slice(0, maxSize) : text;
}

/** Aggressive HTML stripping for article content */
function stripFullHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?(p|div|br|hr|h[1-6]|li|tr|blockquote|pre|section|article)[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();
}
