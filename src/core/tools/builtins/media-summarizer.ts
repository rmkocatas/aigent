// ============================================================
// OpenClaw Deploy — Media Summarizer Tool
// ============================================================
//
// Summarizes content from YouTube videos, podcasts, and articles.
// For YouTube: fetches transcript via public APIs.
// For articles/pages: fetches readable text content.
// Returns a summary prompt that the LLM can process.
// ============================================================

import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

const MAX_CONTENT_SIZE = 30_000;

export const mediaSummarizerDefinition: ToolDefinition = {
  name: 'summarize_url',
  description:
    'Fetch and summarize content from a URL. Works with articles, YouTube videos (via transcript), ' +
    'Vimeo, TikTok, and other web pages. Returns the extracted content for you to summarize.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to summarize',
      },
      focus: {
        type: 'string',
        description: 'Optional focus area for the summary (e.g. "key takeaways", "technical details")',
      },
    },
    required: ['url'],
  },
  routing: {
    useWhen: [
      'User asks to summarize a URL, article, or video',
      'User shares a YouTube link and asks about its content',
      'User wants a TLDR of a webpage',
    ],
    avoidWhen: [
      'User just wants to read the raw content (use fetch_url instead)',
      'User wants to save content for later (use web_clip instead)',
    ],
  },
};

// ---------------------------------------------------------------------------
// YouTube transcript extraction
// ---------------------------------------------------------------------------

function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

async function fetchYouTubeTranscript(videoId: string): Promise<string | null> {
  try {
    // Fetch the video page to extract captions track
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!pageRes.ok) return null;
    const html = await pageRes.text();

    // Extract title
    const titleMatch = html.match(/<title>([^<]*)<\/title>/);
    const title = titleMatch
      ? titleMatch[1].replace(' - YouTube', '').trim()
      : 'Unknown Title';

    // Extract captions URL from page data
    const captionsMatch = html.match(/"captions":\s*(\{[^}]*"playerCaptionsTracklistRenderer"[^}]*\})/);
    if (!captionsMatch) {
      // Try to get video description as fallback
      const descMatch = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
      if (descMatch) {
        const desc = descMatch[1]
          .replace(/\\n/g, '\n')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
        return `[YouTube Video] ${title}\n\n[No transcript available. Video description:]\n${desc}`;
      }
      return `[YouTube Video] ${title}\n\n[No transcript or description available for this video]`;
    }

    // Find auto-generated or manual captions URL
    const urlMatch = html.match(/"baseUrl":"(https:\/\/www\.youtube\.com\/api\/timedtext[^"]*)"/);
    if (!urlMatch) {
      return `[YouTube Video] ${title}\n\n[Transcript URL not found]`;
    }

    const captionUrl = urlMatch[1].replace(/\\u0026/g, '&');

    const captionRes = await fetch(captionUrl, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!captionRes.ok) return `[YouTube Video] ${title}\n\n[Failed to fetch transcript]`;

    const captionXml = await captionRes.text();

    // Parse XML transcript
    const lines: string[] = [];
    const textRegex = /<text[^>]*>([\s\S]*?)<\/text>/g;
    let match: RegExpExecArray | null;
    while ((match = textRegex.exec(captionXml)) !== null) {
      let text = match[1]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n/g, ' ')
        .trim();
      if (text) lines.push(text);
    }

    if (lines.length === 0) {
      return `[YouTube Video] ${title}\n\n[Transcript is empty]`;
    }

    return `[YouTube Video] ${title}\n\nTranscript:\n${lines.join(' ')}`;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Vimeo transcript/description extraction
// ---------------------------------------------------------------------------

function extractVimeoId(url: string): string | null {
  const match = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return match ? match[1] : null;
}

async function fetchVimeoContent(videoId: string): Promise<string | null> {
  try {
    // Vimeo oEmbed API (free, no auth)
    const oembedRes = await fetch(
      `https://vimeo.com/api/oembed.json?url=https://vimeo.com/${videoId}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!oembedRes.ok) return null;
    const oembed = await oembedRes.json() as Record<string, unknown>;
    const title = String(oembed.title ?? 'Unknown');
    const author = String(oembed.author_name ?? 'Unknown');
    const description = String(oembed.description ?? '');

    // Try to fetch the video page for additional metadata
    const pageRes = await fetch(`https://vimeo.com/${videoId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MoltBot/1.0)' },
      signal: AbortSignal.timeout(10_000),
    });

    let extraContent = '';
    if (pageRes.ok) {
      const html = await pageRes.text();
      // Extract LD+JSON metadata
      const ldJson = extractLdJson(html);
      if (ldJson) extraContent = `\n\nMetadata: ${ldJson}`;
    }

    return `[Vimeo Video] ${title}\nBy: ${author}\n\n${description || '[No description available]'}${extraContent}`;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// TikTok content extraction
// ---------------------------------------------------------------------------

function isTikTokUrl(url: string): boolean {
  return /tiktok\.com/.test(url);
}

async function fetchTikTokContent(url: string): Promise<string | null> {
  try {
    // TikTok oEmbed API (free, no auth)
    const oembedRes = await fetch(
      `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!oembedRes.ok) return null;
    const oembed = await oembedRes.json() as Record<string, unknown>;
    const title = String(oembed.title ?? '');
    const author = String(oembed.author_name ?? 'Unknown');

    return `[TikTok Video] ${title || 'Video'}\nBy: @${author}\n\n${title || '[No description available]'}`;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// LD+JSON metadata extraction (works for many video pages)
// ---------------------------------------------------------------------------

function extractLdJson(html: string): string | null {
  const ldJsonRegex = /<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  const results: string[] = [];

  while ((match = ldJsonRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]) as Record<string, unknown>;
      // Look for VideoObject type
      const type = String(data['@type'] ?? '');
      if (type === 'VideoObject' || type === 'Movie' || type === 'TVEpisode') {
        const parts: string[] = [];
        if (data.name) parts.push(`Title: ${data.name}`);
        if (data.description) parts.push(`Description: ${String(data.description).slice(0, 2000)}`);
        if (data.duration) parts.push(`Duration: ${data.duration}`);
        if (data.uploadDate) parts.push(`Uploaded: ${data.uploadDate}`);
        if (data.author) {
          const author = data.author as Record<string, unknown>;
          parts.push(`Author: ${author.name ?? JSON.stringify(data.author)}`);
        }
        if (parts.length > 0) results.push(parts.join('\n'));
      }
    } catch {
      // Ignore parse errors
    }
  }

  return results.length > 0 ? results.join('\n\n') : null;
}

// ---------------------------------------------------------------------------
// Generic article extraction
// ---------------------------------------------------------------------------

async function fetchArticleContent(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; MoltBot/1.0)',
      Accept: 'text/html, text/plain, */*',
    },
    signal: AbortSignal.timeout(15_000),
    redirect: 'follow',
  });

  if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);

  const raw = await res.text();
  const contentType = res.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    try {
      return `[JSON Content]\n${JSON.stringify(JSON.parse(raw), null, 2)}`;
    } catch {
      return raw;
    }
  }

  if (contentType.includes('text/plain')) {
    return raw;
  }

  // Extract title
  const titleMatch = raw.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';

  // Strip HTML more aggressively for summarization
  let text = raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?(p|div|br|hr|h[1-6]|li|tr|blockquote|pre|section|article)[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();

  if (title) text = `[Article] ${title}\n\n${text}`;

  return text;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const mediaSummarizerHandler: ToolHandler = async (input) => {
  const url = input.url as string;
  const focus = input.focus as string | undefined;

  if (!url || typeof url !== 'string') throw new Error('Missing URL');
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error('URL must start with http:// or https://');
  }

  let content: string;

  // Check if it's a YouTube URL
  const ytId = extractYouTubeId(url);
  const vimeoId = extractVimeoId(url);

  if (ytId) {
    const transcript = await fetchYouTubeTranscript(ytId);
    content = transcript ?? `[YouTube Video] Could not extract transcript for video ${ytId}`;
  } else if (vimeoId) {
    const vimeoContent = await fetchVimeoContent(vimeoId);
    content = vimeoContent ?? `[Vimeo Video] Could not extract content for video ${vimeoId}`;
  } else if (isTikTokUrl(url)) {
    const tiktokContent = await fetchTikTokContent(url);
    content = tiktokContent ?? `[TikTok Video] Could not extract content`;
  } else {
    content = await fetchArticleContent(url);
  }

  // Truncate if too long
  if (content.length > MAX_CONTENT_SIZE) {
    content = content.slice(0, MAX_CONTENT_SIZE) + '\n\n[Content truncated at 30KB]';
  }

  // Return content with summarization instructions for the LLM
  const focusInstr = focus ? `\nFocus area: ${focus}` : '';

  return (
    `Please provide a concise summary of the following content.${focusInstr}\n` +
    `Include key points, main arguments, and important details.\n\n` +
    `---\n${content}\n---`
  );
};
