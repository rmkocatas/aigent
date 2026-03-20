// ============================================================
// OpenClaw Deploy — Knowledge Base Tools (Web Clipper + RAG)
// ============================================================
//
// Provides:
//   - web_clip: Save URL content for later retrieval
//   - read_later_add / read_later_list: Queue URLs for later reading
//   - knowledge_search: Search across all saved clips and documents
//
// Storage: knowledge/{userId}/ directory with clips.json and index.json
// ============================================================

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

const MAX_CLIPS_PER_USER = 200;
const MAX_CLIP_SIZE = 50_000; // 50KB text per clip
const MAX_READ_LATER = 100;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WebClip {
  id: string;
  url: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
  wordCount: number;
}

interface ReadLaterItem {
  id: string;
  url: string;
  note?: string;
  addedAt: string;
  read: boolean;
}

interface KnowledgeStore {
  clips: WebClip[];
  readLater: ReadLaterItem[];
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function getStorePath(memoryDir: string, userId: string): string {
  return join(memoryDir, '..', 'knowledge', `${userId}.json`);
}

async function loadStore(memoryDir: string, userId: string): Promise<KnowledgeStore> {
  try {
    const content = await readFile(getStorePath(memoryDir, userId), 'utf-8');
    return JSON.parse(content) as KnowledgeStore;
  } catch {
    return { clips: [], readLater: [] };
  }
}

async function saveStore(memoryDir: string, userId: string, store: KnowledgeStore): Promise<void> {
  const filePath = getStorePath(memoryDir, userId);
  await mkdir(join(filePath, '..'), { recursive: true });
  await writeFile(filePath, JSON.stringify(store, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// BM25-lite search (simple term frequency scoring)
// ---------------------------------------------------------------------------

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter((t) => t.length > 2);
}

function bm25Score(query: string, document: string): number {
  const queryTerms = tokenize(query);
  const docTerms = tokenize(document);
  if (docTerms.length === 0 || queryTerms.length === 0) return 0;

  const termFreq = new Map<string, number>();
  for (const term of docTerms) {
    termFreq.set(term, (termFreq.get(term) ?? 0) + 1);
  }

  let score = 0;
  const k1 = 1.5;
  const b = 0.75;
  const avgDl = 200; // rough average document length
  const dl = docTerms.length;

  for (const qt of queryTerms) {
    const tf = termFreq.get(qt) ?? 0;
    if (tf > 0) {
      // Simplified BM25 (no IDF since we score individual docs)
      score += (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (dl / avgDl)));
    }
  }

  return score;
}

// ---------------------------------------------------------------------------
// web_clip: Save URL content for later
// ---------------------------------------------------------------------------

export const webClipDefinition: ToolDefinition = {
  name: 'web_clip',
  description: 'Save the content of a URL to the knowledge base for later retrieval. Fetches the page and stores its text.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to clip/save' },
      title: { type: 'string', description: 'A descriptive title for the clip' },
      tags: { type: 'string', description: 'Comma-separated tags (e.g. "python,tutorial,async")' },
    },
    required: ['url', 'title'],
  },
  routing: {
    useWhen: ['User asks to save, clip, or bookmark a webpage for later', 'User wants to store web content in their knowledge base'],
    avoidWhen: ['User just wants to read a URL now (use fetch_url instead)', 'User wants a simple bookmark (use /pin command)'],
  },
};

export const webClipHandler: ToolHandler = async (input, context) => {
  const url = input.url as string;
  const title = input.title as string;
  const tags = ((input.tags as string) ?? '').split(',').map((t) => t.trim()).filter(Boolean);

  if (!url || !url.startsWith('http')) throw new Error('Invalid URL');
  if (!title) throw new Error('Missing title');

  const store = await loadStore(context.memoryDir, context.userId);

  if (store.clips.length >= MAX_CLIPS_PER_USER) {
    throw new Error(`Knowledge base full (max ${MAX_CLIPS_PER_USER} clips). Remove old clips first.`);
  }

  // Check for duplicates
  if (store.clips.some((c) => c.url === url)) {
    throw new Error('This URL is already in your knowledge base.');
  }

  // Fetch the content
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; MoltBot/1.0)',
      Accept: 'text/html, text/plain, */*',
    },
    signal: AbortSignal.timeout(15_000),
    redirect: 'follow',
  });

  if (!res.ok) throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`);

  let rawText = await res.text();

  // Strip HTML
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('html')) {
    rawText = rawText
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
  }

  let content = rawText;
  if (content.length > MAX_CLIP_SIZE) {
    content = content.slice(0, MAX_CLIP_SIZE) + '\n[Truncated]';
  }

  const wordCount = content.split(/\s+/).length;

  const clip: WebClip = {
    id: randomUUID().slice(0, 8),
    url,
    title,
    content,
    tags,
    createdAt: new Date().toISOString(),
    wordCount,
  };

  store.clips.push(clip);
  await saveStore(context.memoryDir, context.userId, store);

  // Also remove from read-later queue if present
  const rlIdx = store.readLater.findIndex((r) => r.url === url);
  if (rlIdx !== -1) {
    store.readLater[rlIdx].read = true;
    await saveStore(context.memoryDir, context.userId, store);
  }

  return `Saved to knowledge base (ID: ${clip.id}). ${wordCount} words, ${tags.length > 0 ? `tags: ${tags.join(', ')}` : 'no tags'}.`;
};

// ---------------------------------------------------------------------------
// read_later_add: Queue a URL for later reading
// ---------------------------------------------------------------------------

export const readLaterAddDefinition: ToolDefinition = {
  name: 'read_later_add',
  description: 'Add a URL to the read-later queue. Use this when the user wants to save a link to read later.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to save for later' },
      note: { type: 'string', description: 'Optional note about why to read this' },
    },
    required: ['url'],
  },
  routing: {
    useWhen: ['User says "read later", "save this link", "remind me to read this"'],
    avoidWhen: ['User wants to read the URL right now'],
  },
};

export const readLaterAddHandler: ToolHandler = async (input, context) => {
  const url = input.url as string;
  const note = input.note as string | undefined;

  if (!url || !url.startsWith('http')) throw new Error('Invalid URL');

  const store = await loadStore(context.memoryDir, context.userId);

  if (store.readLater.filter((r) => !r.read).length >= MAX_READ_LATER) {
    throw new Error(`Read-later queue full (max ${MAX_READ_LATER}). Clear some items first.`);
  }

  if (store.readLater.some((r) => r.url === url && !r.read)) {
    throw new Error('This URL is already in your read-later queue.');
  }

  store.readLater.push({
    id: randomUUID().slice(0, 8),
    url,
    note,
    addedAt: new Date().toISOString(),
    read: false,
  });

  await saveStore(context.memoryDir, context.userId, store);

  return `Added to read-later queue.${note ? ` Note: ${note}` : ''}`;
};

// ---------------------------------------------------------------------------
// read_later_list: Show the read-later queue
// ---------------------------------------------------------------------------

export const readLaterListDefinition: ToolDefinition = {
  name: 'read_later_list',
  description: 'Show all unread items in the read-later queue.',
  parameters: { type: 'object', properties: {} },
  routing: {
    useWhen: ['User asks to see their read-later list or saved links'],
    avoidWhen: ['User wants to search knowledge base (use knowledge_search instead)'],
  },
};

export const readLaterListHandler: ToolHandler = async (_input, context) => {
  const store = await loadStore(context.memoryDir, context.userId);
  const unread = store.readLater.filter((r) => !r.read);

  if (unread.length === 0) return 'Read-later queue is empty.';

  const lines = unread.map((r) => {
    const age = Math.round((Date.now() - new Date(r.addedAt).getTime()) / 86_400_000);
    const noteStr = r.note ? ` — ${r.note}` : '';
    return `- [${r.id}] ${r.url}${noteStr} (${age}d ago)`;
  });

  return `Read later (${unread.length}):\n${lines.join('\n')}`;
};

// ---------------------------------------------------------------------------
// knowledge_search: Search across all saved content
// ---------------------------------------------------------------------------

export const knowledgeSearchDefinition: ToolDefinition = {
  name: 'knowledge_search',
  description: 'Search the knowledge base (saved web clips and documents) for relevant information. Returns matching excerpts.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      tag: { type: 'string', description: 'Optional tag filter' },
    },
    required: ['query'],
  },
  routing: {
    useWhen: ['User asks to find something in their saved clips or knowledge base', 'User references information they previously saved'],
    avoidWhen: ['User wants to search the live web (use web_search instead)'],
  },
};

export const knowledgeSearchHandler: ToolHandler = async (input, context) => {
  const query = input.query as string;
  const tag = input.tag as string | undefined;

  if (!query) throw new Error('Missing search query');

  const store = await loadStore(context.memoryDir, context.userId);

  let clips = store.clips;
  if (tag) {
    clips = clips.filter((c) => c.tags.some((t) => t.toLowerCase() === tag.toLowerCase()));
  }

  if (clips.length === 0) {
    return tag
      ? `No clips found with tag "${tag}". You have ${store.clips.length} total clips.`
      : 'Knowledge base is empty. Use web_clip to save content.';
  }

  // Score and rank
  const scored = clips.map((clip) => ({
    clip,
    score: bm25Score(query, `${clip.title} ${clip.tags.join(' ')} ${clip.content}`),
  }));

  scored.sort((a, b) => b.score - a.score);
  const topResults = scored.filter((s) => s.score > 0).slice(0, 5);

  if (topResults.length === 0) {
    return `No matching results for "${query}" in ${clips.length} clips.`;
  }

  const results = topResults.map((r) => {
    // Extract a relevant snippet (first occurrence of query terms)
    const queryTerms = tokenize(query);
    const contentLower = r.clip.content.toLowerCase();
    let snippetStart = 0;
    for (const term of queryTerms) {
      const idx = contentLower.indexOf(term);
      if (idx !== -1) {
        snippetStart = Math.max(0, idx - 100);
        break;
      }
    }
    const snippet = r.clip.content.slice(snippetStart, snippetStart + 300).trim();

    return `**${r.clip.title}** (${r.clip.id})\n` +
      `  URL: ${r.clip.url}\n` +
      `  Tags: ${r.clip.tags.join(', ') || 'none'}\n` +
      `  ...${snippet}...`;
  });

  return `Found ${topResults.length} results:\n\n${results.join('\n\n')}`;
};
