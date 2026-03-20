// ============================================================
// OpenClaw Deploy — X/Twitter Research Tool (Compound)
// ============================================================
//
// A compound research tool that performs X/Twitter search,
// optional web search, and URL content fetching in a single
// tool call. Uses the Twitter GraphQL API directly when
// available, falls back to DuckDuckGo scraping.
//
// Generates professional PDF reports with:
//   - Cover page
//   - Tweet cards with profile images and engagement bars
//   - Web source summaries
//   - Source excerpts
//   - Page numbers and date footer
// ============================================================

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';
import {
  duckDuckGoSearch,
  fetchPageContent,
  createRateLimiter,
  type SearchResult,
} from './ddg-search.js';
import { getTwitterClient } from './twitter-tools.js';
import { getBrowserBridge } from './browser-tools.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_OUTPUT_CHARS = 7500;
const X_RESULTS_BUDGET = 3000;
const WEB_RESULTS_BUDGET = 1500;
const FETCHED_BUDGET = 2800;
const MAX_FETCH_CONCURRENT = 3;

// WinAnsi-safe character set for pdf-lib's StandardFonts (Helvetica)
// Strips emoji, CJK, Arabic, etc. that would crash drawText()
function sanitizeForPdf(text: string): string {
  // Keep only printable ASCII + Latin-1 supplement (U+0020..U+007E, U+00A0..U+00FF)
  // Replace everything else with '?' to preserve text length/readability
  return text.replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '?');
}

const rateLimiter = createRateLimiter(2000);

// PDF layout constants
const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 50;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_Y = 25;

// Colors
const COLOR_TITLE = rgb(0.15, 0.25, 0.45);
const COLOR_BODY = rgb(0.15, 0.15, 0.15);
const COLOR_MUTED = rgb(0.5, 0.5, 0.5);
const COLOR_LINE = rgb(0.7, 0.7, 0.7);
const COLOR_ACCENT = rgb(0.2, 0.5, 0.85);
const COLOR_CARD_BG = rgb(0.96, 0.96, 0.97);
const COLOR_CARD_BORDER = rgb(0.2, 0.45, 0.8);
const COLOR_LIKES = rgb(0.85, 0.2, 0.25);
const COLOR_RTS = rgb(0.2, 0.7, 0.35);
const COLOR_REPLIES = rgb(0.25, 0.5, 0.85);
const COLOR_VIEWS = rgb(0.55, 0.55, 0.55);
const COLOR_COVER_LINE = rgb(0.2, 0.4, 0.7);
const COLOR_HEADING = rgb(0.1, 0.1, 0.1);


// ---------------------------------------------------------------------------
// Internal enriched tweet type
// ---------------------------------------------------------------------------

interface EnrichedTweet {
  username: string;
  displayName: string;
  text: string;
  likes: number;
  retweets: number;
  replies: number;
  views: number;
  timestamp: string;
  url: string;
  profileImageUrl?: string;
  source?: 'search' | 'timeline' | 'ddg';
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const xResearchDefinition: ToolDefinition = {
  name: 'x_research',
  description:
    'Perform comprehensive X/Twitter + web research on a topic in a single call. ' +
    'Searches X/Twitter for posts (uses direct API when available, falls back to DuckDuckGo), ' +
    'optionally includes your Twitter timeline/feed for curated content from followed accounts, ' +
    'optionally searches the broader web, fetches top source URLs, ' +
    'and returns a structured research summary. Set generate_pdf=true to also create and deliver ' +
    'a professional PDF report with tweet cards, engagement metrics, and visual formatting. ' +
    'Use this instead of separate web_search + x_search + fetch_url calls.',
  parameters: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        description: 'The research topic to investigate.',
      },
      max_x_results: {
        type: 'number',
        description: 'Max X/Twitter results (1-15, default 8).',
      },
      max_web_results: {
        type: 'number',
        description: 'Max web search results (1-10, default 5).',
      },
      fetch_top_n: {
        type: 'number',
        description: 'Number of top web source URLs to fetch in full (0-5, default 3).',
      },
      include_web: {
        type: 'boolean',
        description: 'Include broader web search results for context (default true).',
      },
      include_timeline: {
        type: 'boolean',
        description: 'Include tweets from your Twitter timeline/feed (default true). Shows content from accounts you follow.',
      },
      max_timeline_results: {
        type: 'number',
        description: 'Max tweets to pull from timeline (1-50, default 15). Only used if include_timeline=true.',
      },
      filter_timeline: {
        type: 'boolean',
        description: 'Filter timeline tweets by topic relevance (default false). When false, all timeline tweets are included since the feed is already curated.',
      },
      generate_pdf: {
        type: 'boolean',
        description: 'Also generate and deliver a PDF report (default false). The PDF is sent automatically via Telegram.',
      },
      include_screenshots: {
        type: 'boolean',
        description: 'Include browser screenshots of top tweets in the PDF (default true when generate_pdf=true). Uses embedded tweet renderer — no login wall.',
      },
      max_screenshots: {
        type: 'number',
        description: 'Max tweet screenshots to capture (1-10, default 5). Only used if include_screenshots=true.',
      },
    },
    required: ['topic'],
  },
  routing: {
    useWhen: [
      'User wants research on a topic involving X/Twitter discussion',
      'User asks for a research report or analysis that includes social media',
      'User asks to research something and generate a PDF or report',
    ],
    avoidWhen: [
      'User just wants a simple web search (use web_search)',
      'User just wants to read one specific URL (use fetch_url)',
      'User only wants X/Twitter search without broader research (use x_search)',
    ],
  },
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const xResearchHandler: ToolHandler = async (input, context) => {
  const topic = input.topic as string;
  if (!topic || typeof topic !== 'string') {
    throw new Error('Missing required parameter: topic');
  }

  const maxXResults = Math.min(Math.max((input.max_x_results as number) || 8, 1), 15);
  const maxWebResults = Math.min(Math.max((input.max_web_results as number) || 5, 1), 10);
  const fetchTopN = Math.min(Math.max((input.fetch_top_n as number) ?? 3, 0), 5);
  const includeWeb = input.include_web !== false;
  const includeTimeline = input.include_timeline !== false; // default true
  const maxTimelineResults = Math.min(Math.max((input.max_timeline_results as number) || 15, 1), 50);
  const filterTimeline = input.filter_timeline === true; // default false — include all, feed is curated
  const generatePdf = input.generate_pdf === true;
  // Screenshots default to ON when generating PDF (embed approach is fast & reliable)
  const includeScreenshots = input.include_screenshots !== false && generatePdf;
  const maxScreenshots = Math.min(Math.max((input.max_screenshots as number) || 5, 1), 10);

  const userKey = context?.userId ?? '_global';
  await rateLimiter.waitIfNeeded(userKey);

  // ── Phase 1: Twitter API search (preferred) ─────────────────

  let enrichedTweets: EnrichedTweet[] = [];
  let usedTwitterApi = false;

  const tc = getTwitterClient();
  if (tc?.isConnected()) {
    try {
      const apiTweets = await tc.search(topic, maxXResults, 'latest', userKey);
      for (const t of apiTweets) {
        enrichedTweets.push({
          username: t.username,
          displayName: t.displayName,
          text: t.text,
          likes: t.likes,
          retweets: t.retweets,
          replies: t.replies,
          views: t.views,
          timestamp: t.timestamp,
          url: t.url,
          profileImageUrl: t.profileImageUrl || undefined,
          source: 'search',
        });
      }
      if (enrichedTweets.length > 0) usedTwitterApi = true;
    } catch {
      // Twitter API failed, fall through to DDG
    }
  }

  // ── Phase 1a: Twitter timeline (curated feed from followed accounts) ──

  let timelineTweets: EnrichedTweet[] = [];
  if (includeTimeline && tc?.isConnected()) {
    try {
      const tlTweets = await tc.getTimeline('following', maxTimelineResults, userKey);

      for (const t of tlTweets) {
        // Avoid duplicates with search results (skip dedup if URL is empty)
        if (t.url && enrichedTweets.some((e) => e.url === t.url)) continue;

        // If filter_timeline=true, apply keyword relevance filter
        if (filterTimeline) {
          const topicWords = topic.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
          const AI_SYNONYMS: Record<string, string[]> = {
            ai: ['artificial', 'intelligence', 'machine', 'learning', 'deep', 'neural', 'llm', 'gpt', 'model', 'training', 'inference', 'agent', 'automation', 'openai', 'anthropic', 'google', 'meta', 'nvidia', 'transformer', 'diffusion', 'chatbot', 'copilot'],
            artificial: ['ai', 'intelligence', 'machine', 'learning'],
            intelligence: ['ai', 'artificial', 'machine', 'learning'],
            llm: ['ai', 'model', 'language', 'gpt', 'claude', 'gemini', 'llama'],
            machine: ['ai', 'learning', 'deep', 'neural', 'model'],
            learning: ['ai', 'machine', 'deep', 'training', 'model'],
          };
          const expandedWords = new Set(topicWords);
          for (const w of topicWords) {
            const synonyms = AI_SYNONYMS[w];
            if (synonyms) for (const s of synonyms) expandedWords.add(s);
          }
          const tweetText = t.text.toLowerCase();
          const isRelevant = [...expandedWords].some((w) => tweetText.includes(w));
          if (!isRelevant) continue;
        }

        timelineTweets.push({
          username: t.username,
          displayName: t.displayName,
          text: t.text,
          likes: t.likes,
          retweets: t.retweets,
          replies: t.replies,
          views: t.views,
          timestamp: t.timestamp,
          url: t.url,
          profileImageUrl: t.profileImageUrl || undefined,
          source: 'timeline',
        });
      }
      if (!usedTwitterApi && timelineTweets.length > 0) usedTwitterApi = true;
    } catch (err) {
      console.error('[x-research] Timeline fetch failed:', (err as Error).message);
    }
  }

  // ── Phase 1b: DDG fallback for X results ────────────────────

  let xResults: SearchResult[] = [];
  let webResults: SearchResult[] = [];

  if (!usedTwitterApi) {
    // DDG search for X/Twitter posts
    const year = new Date().getFullYear();
    const xQuery = `site:x.com ${topic} ${year}`;

    const searchPromises: Promise<{ type: string; results: SearchResult[] }>[] = [
      duckDuckGoSearch(xQuery, maxXResults, ['x.com', 'twitter.com'])
        .then((results) => ({ type: 'x', results }))
        .catch(() => ({ type: 'x', results: [] as SearchResult[] })),
    ];

    if (includeWeb) {
      searchPromises.push(
        duckDuckGoSearch(topic, maxWebResults)
          .then((results) => ({ type: 'web', results }))
          .catch(() => ({ type: 'web', results: [] as SearchResult[] })),
      );
    }

    const settled = await Promise.allSettled(searchPromises);
    for (const s of settled) {
      if (s.status === 'fulfilled') {
        if (s.value.type === 'x') xResults = s.value.results;
        else webResults = s.value.results;
      }
    }

    // Twitter.com fallback if few X results
    if (xResults.length < 3) {
      try {
        const fallbackQuery = `site:twitter.com ${topic} ${year}`;
        const fallback = await duckDuckGoSearch(
          fallbackQuery,
          maxXResults - xResults.length,
          ['x.com', 'twitter.com'],
        );
        for (const r of fallback) {
          if (!xResults.some((existing) => existing.url === r.url)) {
            xResults.push(r);
          }
        }
      } catch {
        // Fallback is best-effort
      }
    }

    // Convert DDG results to enriched tweets
    for (const r of xResults) {
      const author = extractAuthor(r.url);
      enrichedTweets.push({
        username: author ?? 'Unknown',
        displayName: '',
        text: r.snippet || r.title,
        likes: 0,
        retweets: 0,
        replies: 0,
        views: 0,
        timestamp: '',
        url: r.url,
        source: 'ddg',
      });
    }
  } else if (includeWeb) {
    // Twitter API was used, but still need web results
    try {
      webResults = await duckDuckGoSearch(topic, maxWebResults);
    } catch {
      // Best effort
    }
  }

  // ── Phase 2: Fetch top web source URLs ────────────────────────

  const urlsToFetch: string[] = [];
  for (const r of webResults) {
    if (urlsToFetch.length < fetchTopN) urlsToFetch.push(r.url);
  }

  const fetchedContent: Array<{ url: string; content: string }> = [];

  if (urlsToFetch.length > 0) {
    for (let i = 0; i < urlsToFetch.length; i += MAX_FETCH_CONCURRENT) {
      const batch = urlsToFetch.slice(i, i + MAX_FETCH_CONCURRENT);
      const results = await Promise.allSettled(
        batch.map(async (url) => {
          const content = await fetchPageContent(url, 10_000);
          return { url, content };
        }),
      );
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.content.length > 50) {
          fetchedContent.push(r.value);
        }
      }
    }
  }

  // ── Phase 3: Build structured text output ──────────────────────

  const sections: string[] = [];

  // Combine all tweets: search results + timeline (deduplicated)
  const allTweets = [...enrichedTweets, ...timelineTweets];

  const sourceLabel = usedTwitterApi ? 'Twitter API' : 'DuckDuckGo';
  sections.push(
    `Research: "${topic}"\n` +
    `Found ${enrichedTweets.length} X/Twitter search results (via ${sourceLabel}), ` +
    `${timelineTweets.length} relevant timeline posts, ${webResults.length} web sources, ` +
    `${fetchedContent.length} pages fetched.`,
  );

  // X/Twitter Search Results
  if (enrichedTweets.length > 0) {
    const xLines = enrichedTweets.map((t, i) => {
      const authorStr = `@${t.username}`;
      const metrics = usedTwitterApi
        ? ` [${formatMetric(t.likes)} likes, ${formatMetric(t.retweets)} RTs, ${formatMetric(t.views)} views]`
        : '';
      return `${i + 1}. ${authorStr}: ${t.text.slice(0, 280)}${metrics}\n   ${t.url}`;
    });
    const xSection = `\n## X/Twitter Search Results\n${xLines.join('\n')}`;
    sections.push(truncate(xSection, X_RESULTS_BUDGET));
  } else {
    sections.push('\n## X/Twitter Search Results\nNo X/Twitter posts found for this topic.');
  }

  // Timeline Results (from followed accounts)
  if (timelineTweets.length > 0) {
    const tlLines = timelineTweets.map((t, i) => {
      const authorStr = `@${t.username}`;
      const metrics = ` [${formatMetric(t.likes)} likes, ${formatMetric(t.retweets)} RTs, ${formatMetric(t.views)} views]`;
      return `${i + 1}. ${authorStr}: ${t.text.slice(0, 280)}${metrics}\n   ${t.url}`;
    });
    const tlSection = `\n## From Your Timeline\n${tlLines.join('\n')}`;
    sections.push(truncate(tlSection, X_RESULTS_BUDGET));
  }

  // Web Sources
  if (webResults.length > 0) {
    const webLines = webResults.map(
      (r, i) => `${i + 1}. ${r.title}\n   ${r.snippet}\n   ${r.url}`,
    );
    const webSection = `\n## Web Sources\n${webLines.join('\n')}`;
    sections.push(truncate(webSection, WEB_RESULTS_BUDGET));
  }

  // Fetched Content Excerpts
  if (fetchedContent.length > 0) {
    const perPage = Math.floor(FETCHED_BUDGET / fetchedContent.length);
    const excerpts = fetchedContent.map((fc) => {
      const excerpt = truncate(fc.content, perPage - 60);
      return `### ${fc.url}\n${excerpt}`;
    });
    sections.push(`\n## Source Excerpts\n${excerpts.join('\n\n')}`);
  }

  // ── Phase 4: PDF generation ──────────────────────────────────

  if (generatePdf && context.collectedFiles) {
    try {
      // Fetch profile images in parallel (for all tweets: search + timeline)
      const imagePromises = allTweets.slice(0, 25).map(async (t) => {
        if (t.profileImageUrl) {
          return fetchImageBuffer(t.profileImageUrl);
        }
        return null;
      });
      const profileImages = await Promise.allSettled(imagePromises);
      const imageBuffers: (Buffer | null)[] = profileImages.map(
        (r) => (r.status === 'fulfilled' ? r.value : null),
      );

      // Optional: capture tweet screenshots via browser bridge
      let screenshots: (Buffer | null)[] = [];
      if (includeScreenshots) {
        const bridge = getBrowserBridge();
        if (bridge?.isConnected()) {
          screenshots = await captureTweetScreenshots(
            bridge,
            allTweets.slice(0, maxScreenshots),
          );
        }
      }

      const pdfBytes = await buildResearchPdf(
        topic,
        allTweets,
        webResults,
        fetchedContent,
        imageBuffers,
        screenshots,
        usedTwitterApi,
      );

      const filename = topic
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) + '-research.pdf';

      context.collectedFiles.push({
        filename,
        mimeType: 'application/pdf',
        data: Buffer.from(pdfBytes),
        caption: `Research Report: ${topic}`,
      });
      sections.push(`\nPDF report "${filename}" generated and queued for delivery.`);
    } catch (err) {
      sections.push(
        `\nPDF generation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Final output with budget enforcement
  const result = sections.join('\n');
  if (result.length > MAX_OUTPUT_CHARS) {
    return result.slice(0, MAX_OUTPUT_CHARS) + '\n\n[Output truncated to fit context]';
  }
  return result;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractAuthor(url: string): string | null {
  const match = url.match(/(?:x\.com|twitter\.com)\/([a-zA-Z0-9_]+)/);
  if (match && !['search', 'hashtag', 'i', 'explore'].includes(match[1])) {
    return match[1];
  }
  return null;
}

function truncate(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const cut = text.slice(0, budget);
  const lastNewline = cut.lastIndexOf('\n');
  return (lastNewline > budget * 0.7 ? cut.slice(0, lastNewline) : cut) + '\n...';
}

function formatMetric(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    return buf.length > 100 ? buf : null;
  } catch {
    return null;
  }
}

async function captureTweetScreenshots(
  bridge: { call: (name: string, args?: Record<string, unknown>) => Promise<string> },
  tweets: EnrichedTweet[],
): Promise<(Buffer | null)[]> {
  const results: (Buffer | null)[] = [];
  for (const tweet of tweets) {
    try {
      // Extract tweet ID from URL (e.g. https://x.com/user/status/123456)
      const tweetIdMatch = tweet.url.match(/status\/(\d+)/);
      if (!tweetIdMatch) {
        results.push(null);
        continue;
      }
      const tweetId = tweetIdMatch[1];

      // Use Twitter's embed endpoint — no login wall, clean rendering
      const embedUrl = `https://platform.twitter.com/embed/Tweet.html?id=${tweetId}&theme=light&dnt=true`;
      await bridge.call('browser_navigate', { url: embedUrl });

      // Wait for embed iframe content to render
      await new Promise((r) => setTimeout(r, 3000));

      const screenshotResult = await bridge.call('browser_take_screenshot');
      // Extract base64 from <<IMAGE_BASE64:mime:data>> marker
      const match = screenshotResult.match(/<<IMAGE_BASE64:([^:]+):([^>]+)>>/);
      if (match) {
        results.push(Buffer.from(match[2], 'base64'));
      } else {
        results.push(null);
      }
    } catch {
      results.push(null);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// PDF Builder
// ---------------------------------------------------------------------------

async function buildResearchPdf(
  topic: string,
  tweets: EnrichedTweet[],
  webResults: SearchResult[],
  fetchedContent: Array<{ url: string; content: string }>,
  profileImages: (Buffer | null)[],
  screenshots: (Buffer | null)[],
  usedTwitterApi: boolean,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // State
  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  // ── Helper functions ───────────────────────────────────────

  function wrapText(text: string, f: typeof font, size: number, maxWidth: number): string[] {
    const words = sanitizeForPdf(text).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (f.widthOfTextAtSize(test, size) > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
    return lines.length > 0 ? lines : [''];
  }

  function ensureSpace(needed: number): void {
    if (y - needed < MARGIN + FOOTER_Y + 10) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  }

  function drawTextLine(text: string, size: number, f: typeof font, x: number, color = COLOR_BODY): void {
    ensureSpace(size * 1.4);
    page.drawText(sanitizeForPdf(text), { x, y: y - size, size, font: f, color });
    y -= size * 1.4;
  }

  function drawWrappedText(text: string, size: number, f: typeof font, indent: number = 0, color = COLOR_BODY): void {
    const maxWidth = CONTENT_W - indent;
    const lines = wrapText(text, f, size, maxWidth);
    for (const line of lines) {
      ensureSpace(size * 1.4);
      page.drawText(line, {
        x: MARGIN + indent,
        y: y - size,
        size,
        font: f,
        color,
      });
      y -= size * 1.4;
    }
  }

  function drawHLine(thickness = 0.5, color = COLOR_LINE): void {
    ensureSpace(10);
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_W - MARGIN, y },
      thickness,
      color,
    });
    y -= 10;
  }

  // ── Cover page ─────────────────────────────────────────────

  const coverPage = page;
  const centerY = PAGE_H / 2 + 80;

  // Title
  const titleLines = wrapText(topic, bold, 26, CONTENT_W);
  let coverY = centerY;
  for (const line of titleLines) {
    const w = bold.widthOfTextAtSize(line, 26);
    coverPage.drawText(line, {
      x: (PAGE_W - w) / 2,
      y: coverY,
      size: 26,
      font: bold,
      color: COLOR_TITLE,
    });
    coverY -= 34;
  }

  // Subtitle
  coverY -= 8;
  const subtitle = 'X/Twitter Research Report';
  const subW = font.widthOfTextAtSize(subtitle, 14);
  coverPage.drawText(subtitle, {
    x: (PAGE_W - subW) / 2,
    y: coverY,
    size: 14,
    font,
    color: COLOR_MUTED,
  });
  coverY -= 30;

  // Decorative line
  coverPage.drawLine({
    start: { x: PAGE_W / 2 - 100, y: coverY },
    end: { x: PAGE_W / 2 + 100, y: coverY },
    thickness: 2,
    color: COLOR_COVER_LINE,
  });
  coverY -= 30;

  // Date
  const dateW = font.widthOfTextAtSize(dateStr, 12);
  coverPage.drawText(dateStr, {
    x: (PAGE_W - dateW) / 2,
    y: coverY,
    size: 12,
    font,
    color: COLOR_MUTED,
  });
  coverY -= 24;

  // Source summary — count search vs timeline tweets
  const searchCount = tweets.filter((t) => t.source !== 'timeline').length;
  const timelineCount = tweets.filter((t) => t.source === 'timeline').length;
  const tweetParts = usedTwitterApi
    ? [`${searchCount} tweets (search)`]
    : [`${searchCount} X posts (DuckDuckGo)`];
  if (timelineCount > 0) tweetParts.push(`${timelineCount} from timeline`);
  const sourceText = `${tweetParts.join(' + ')} \u00B7 ${webResults.length} web sources \u00B7 ${fetchedContent.length} pages analyzed`;
  const srcW = font.widthOfTextAtSize(sourceText, 10);
  coverPage.drawText(sourceText, {
    x: (PAGE_W - srcW) / 2,
    y: coverY,
    size: 10,
    font,
    color: COLOR_MUTED,
  });

  // ── X/Twitter Discussion section ───────────────────────────

  page = doc.addPage([PAGE_W, PAGE_H]);
  y = PAGE_H - MARGIN;

  drawTextLine('X/Twitter Discussion', 16, bold, MARGIN, COLOR_HEADING);
  y -= 4;
  drawHLine(1, COLOR_ACCENT);

  if (tweets.length === 0) {
    drawWrappedText('No X/Twitter posts found for this topic.', 10, font);
  } else {
    // Calculate max metrics for engagement bar scaling
    const maxLikes = Math.max(1, ...tweets.map((t) => t.likes));
    const maxRTs = Math.max(1, ...tweets.map((t) => t.retweets));
    const maxReplies = Math.max(1, ...tweets.map((t) => t.replies));

    for (let i = 0; i < tweets.length; i++) {
      const tweet = tweets[i];
      const profileImg = profileImages[i] ?? null;

      // Calculate card height
      const textLines = wrapText(tweet.text.slice(0, 500), font, 10, CONTENT_W - 20);
      const hasMetrics = usedTwitterApi && (tweet.likes > 0 || tweet.retweets > 0 || tweet.views > 0);
      const headerHeight = 18;
      const textHeight = textLines.length * 14;
      const metricsHeight = hasMetrics ? 30 : 0;
      const timestampHeight = tweet.timestamp ? 14 : 0;
      const cardHeight = 12 + headerHeight + textHeight + metricsHeight + timestampHeight + 12;

      ensureSpace(cardHeight + 8);

      const cardTop = y;
      const cardLeft = MARGIN;
      const cardRight = PAGE_W - MARGIN;

      // Card background
      page.drawRectangle({
        x: cardLeft,
        y: cardTop - cardHeight,
        width: CONTENT_W,
        height: cardHeight,
        color: COLOR_CARD_BG,
      });

      // Left accent bar
      page.drawRectangle({
        x: cardLeft,
        y: cardTop - cardHeight,
        width: 3,
        height: cardHeight,
        color: COLOR_CARD_BORDER,
      });

      let cy = cardTop - 12;

      // Profile image + username
      let textStartX = cardLeft + 12;

      if (profileImg) {
        try {
          // Detect image format and embed
          const embedded = await embedImage(doc, profileImg);
          if (embedded) {
            const imgSize = 22;
            page.drawImage(embedded, {
              x: cardLeft + 10,
              y: cy - imgSize,
              width: imgSize,
              height: imgSize,
            });
            textStartX = cardLeft + 38;
          }
        } catch {
          // Skip image on error
        }
      }

      // Username, display name, and source tag
      const sourceTag = tweet.source === 'timeline' ? ' [timeline]' : '';
      const nameText = sanitizeForPdf(
        tweet.displayName
          ? `@${tweet.username} \u00B7 ${tweet.displayName}${sourceTag}`
          : `@${tweet.username}${sourceTag}`,
      );
      page.drawText(nameText.slice(0, 70), {
        x: textStartX,
        y: cy - 11,
        size: 10,
        font: bold,
        color: COLOR_ACCENT,
      });
      cy -= headerHeight;

      // Tweet text
      for (const line of textLines) {
        page.drawText(line, {
          x: cardLeft + 12,
          y: cy - 10,
          size: 10,
          font,
          color: COLOR_BODY,
        });
        cy -= 14;
      }

      // Engagement metrics + bars
      if (hasMetrics) {
        cy -= 4;

        // Metrics text line
        const metricsText =
          `Likes: ${formatMetric(tweet.likes)}  |  ` +
          `RTs: ${formatMetric(tweet.retweets)}  |  ` +
          `Replies: ${formatMetric(tweet.replies)}  |  ` +
          `Views: ${formatMetric(tweet.views)}`;
        page.drawText(metricsText, {
          x: cardLeft + 12,
          y: cy - 8,
          size: 8,
          font,
          color: COLOR_MUTED,
        });
        cy -= 14;

        // Engagement bars
        const barMaxWidth = 80;
        const barHeight = 4;
        const barY = cy - barHeight;
        const barSpacing = (CONTENT_W - 24) / 4;

        // Likes bar (red)
        const likesW = (tweet.likes / maxLikes) * barMaxWidth;
        page.drawRectangle({
          x: cardLeft + 12,
          y: barY,
          width: Math.max(likesW, 2),
          height: barHeight,
          color: COLOR_LIKES,
        });

        // RTs bar (green)
        const rtsW = (tweet.retweets / maxRTs) * barMaxWidth;
        page.drawRectangle({
          x: cardLeft + 12 + barSpacing,
          y: barY,
          width: Math.max(rtsW, 2),
          height: barHeight,
          color: COLOR_RTS,
        });

        // Replies bar (blue)
        const repliesW = (tweet.replies / maxReplies) * barMaxWidth;
        page.drawRectangle({
          x: cardLeft + 12 + barSpacing * 2,
          y: barY,
          width: Math.max(repliesW, 2),
          height: barHeight,
          color: COLOR_REPLIES,
        });

        // Views bar (gray)
        const maxViews = Math.max(1, ...tweets.map((t) => t.views));
        const viewsW = (tweet.views / maxViews) * barMaxWidth;
        page.drawRectangle({
          x: cardLeft + 12 + barSpacing * 3,
          y: barY,
          width: Math.max(viewsW, 2),
          height: barHeight,
          color: COLOR_VIEWS,
        });

        cy -= barHeight + 4;
      }

      // Timestamp and URL
      if (tweet.timestamp) {
        const ts = tweet.timestamp.length > 10
          ? new Date(tweet.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
          : tweet.timestamp;
        page.drawText(ts, {
          x: cardLeft + 12,
          y: cy - 8,
          size: 7,
          font,
          color: COLOR_MUTED,
        });
      }

      y = cardTop - cardHeight - 8;

      // Optional: embed tweet screenshot below card
      if (screenshots[i]) {
        try {
          const screenshotImg = await embedImage(doc, screenshots[i]!);
          if (screenshotImg) {
            const aspect = screenshotImg.height / screenshotImg.width;
            const imgW = Math.min(CONTENT_W, 400);
            let imgH = imgW * aspect;
            // Cap height to avoid one screenshot consuming the whole page
            if (imgH > 350) {
              imgH = 350;
            }
            ensureSpace(imgH + 10);
            page.drawImage(screenshotImg, {
              x: MARGIN + (CONTENT_W - imgW) / 2,
              y: y - imgH,
              width: imgW,
              height: imgH,
            });
            y -= imgH + 10;
          }
        } catch {
          // Skip screenshot on error
        }
      }
    }
  }

  // ── Web Sources section ────────────────────────────────────

  if (webResults.length > 0) {
    y -= 10;
    ensureSpace(40);
    drawTextLine('Web Sources', 16, bold, MARGIN, COLOR_HEADING);
    y -= 2;
    drawHLine(1, COLOR_ACCENT);

    for (const r of webResults) {
      ensureSpace(60);
      drawWrappedText(r.title, 11, bold, 0, COLOR_HEADING);
      if (r.snippet) {
        drawWrappedText(r.snippet, 9, font, 10);
      }
      drawWrappedText(r.url, 8, font, 10, COLOR_ACCENT);
      y -= 6;
    }
  }

  // ── Source Excerpts section ────────────────────────────────

  if (fetchedContent.length > 0) {
    y -= 10;
    ensureSpace(40);
    drawTextLine('Source Excerpts', 16, bold, MARGIN, COLOR_HEADING);
    y -= 2;
    drawHLine(1, COLOR_ACCENT);

    for (const fc of fetchedContent) {
      ensureSpace(50);
      drawWrappedText(fc.url, 9, bold, 0, COLOR_ACCENT);
      y -= 2;
      const excerpt = fc.content.length > 1500
        ? fc.content.slice(0, 1500) + '...'
        : fc.content;
      drawWrappedText(excerpt, 9, font, 10);
      y -= 10;
    }
  }

  // ── Page numbers and footer ────────────────────────────────

  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];

    // Page number (right)
    const pageLabel = `Page ${i + 1} of ${pages.length}`;
    const labelW = font.widthOfTextAtSize(pageLabel, 8);
    p.drawText(pageLabel, {
      x: PAGE_W - MARGIN - labelW,
      y: FOOTER_Y,
      size: 8,
      font,
      color: COLOR_MUTED,
    });

    // Date (left)
    p.drawText(dateStr, {
      x: MARGIN,
      y: FOOTER_Y,
      size: 8,
      font,
      color: COLOR_MUTED,
    });

    // MoltBot branding (center, skip cover page)
    if (i > 0) {
      const brand = 'Generated by MoltBot';
      const brandW = font.widthOfTextAtSize(brand, 7);
      p.drawText(brand, {
        x: (PAGE_W - brandW) / 2,
        y: FOOTER_Y,
        size: 7,
        font,
        color: COLOR_MUTED,
      });
    }
  }

  return doc.save();
}

// ---------------------------------------------------------------------------
// Image embedding helper
// ---------------------------------------------------------------------------

async function embedImage(doc: PDFDocument, buffer: Buffer) {
  try {
    // Detect format from magic bytes
    if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
      return await doc.embedJpg(buffer);
    }
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      return await doc.embedPng(buffer);
    }
    // Try JPEG as default (Twitter profile images are usually JPEG)
    return await doc.embedJpg(buffer);
  } catch {
    return null;
  }
}
