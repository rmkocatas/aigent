// ============================================================
// OpenClaw Deploy — News Headlines Tool (RSS)
// ============================================================

import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

let lastRequestTime = 0;
const MIN_INTERVAL_MS = 2000;
const MAX_RESPONSE_SIZE = 512_000; // 500KB

const RSS_SOURCES: Record<string, { name: string; url: string }> = {
  bbc: { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  reuters: { name: 'Reuters', url: 'https://news.google.com/rss/search?q=site:reuters.com&hl=en' },
  hackernews: { name: 'Hacker News', url: 'https://hnrss.org/frontpage' },
};

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

function extractItems(xml: string, maxItems: number): Array<{ title: string; link: string }> {
  const items: Array<{ title: string; link: string }> = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null && items.length < maxItems) {
    const block = match[1];
    const titleMatch = block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    const linkMatch = block.match(/<link[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i);

    if (titleMatch) {
      items.push({
        title: titleMatch[1].trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'),
        link: linkMatch ? linkMatch[1].trim() : '',
      });
    }
  }

  return items;
}

export const newsHeadlinesDefinition: ToolDefinition = {
  name: 'news_headlines',
  description: 'Fetch latest news headlines from RSS feeds (BBC, Reuters, Hacker News).',
  parameters: {
    type: 'object',
    properties: {
      source: { type: 'string', description: 'News source.', enum: ['bbc', 'reuters', 'hackernews'] },
      max_items: { type: 'number', description: 'Maximum headlines to return (1-15, default 5).' },
    },
  },
  routing: {
    useWhen: ['User asks for latest news or headlines', 'User wants to know what is happening in the world'],
    avoidWhen: ['User is asking about a specific past event (use web_search instead)'],
  },
};

export const newsHeadlinesHandler: ToolHandler = async (input) => {
  const sourceKey = ((input.source as string) ?? 'bbc').toLowerCase();
  const maxItems = Math.min(Math.max((input.max_items as number) ?? 5, 1), 15);

  const source = RSS_SOURCES[sourceKey];
  if (!source) {
    throw new Error(`Unknown source: ${sourceKey}. Available: ${Object.keys(RSS_SOURCES).join(', ')}`);
  }

  await rateLimit();

  const response = await fetch(source.url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MoltBot/1.0)' },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) throw new Error(`Failed to fetch ${source.name}: ${response.status}`);

  const text = await response.text();
  if (text.length > MAX_RESPONSE_SIZE) {
    throw new Error('Response too large');
  }

  const items = extractItems(text, maxItems);

  if (items.length === 0) {
    return `No headlines found from ${source.name}.`;
  }

  const lines = items.map((item, i) => {
    return `${i + 1}. ${item.title}${item.link ? `\n   ${item.link}` : ''}`;
  });

  return `${source.name} Headlines:\n\n${lines.join('\n\n')}`;
};
