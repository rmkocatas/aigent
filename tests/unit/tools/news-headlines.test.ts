import { describe, it, expect, vi, beforeEach } from 'vitest';
import { newsHeadlinesHandler } from '../../../src/core/tools/builtins/news-headlines.js';
import type { ToolContext } from '../../../src/core/tools/registry.js';

const ctx: ToolContext = {
  workspaceDir: '/tmp', memoryDir: '/tmp/mem', conversationId: 'test', userId: 'u1', maxExecutionMs: 5000,
};

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => { mockFetch.mockReset(); });

const sampleRss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>BBC News</title>
<item><title>Breaking: Major Event</title><link>https://bbc.co.uk/1</link></item>
<item><title>Tech &amp; Science Update</title><link>https://bbc.co.uk/2</link></item>
<item><title><![CDATA[Economy Report]]></title><link>https://bbc.co.uk/3</link></item>
</channel>
</rss>`;

describe('news_headlines tool', () => {
  it('fetches and parses BBC headlines', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(sampleRss) });
    const r = await newsHeadlinesHandler({ source: 'bbc' }, ctx);
    expect(r).toContain('BBC News');
    expect(r).toContain('Breaking: Major Event');
    expect(r).toContain('Tech & Science Update');
  });

  it('handles CDATA in titles', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(sampleRss) });
    const r = await newsHeadlinesHandler({ source: 'bbc' }, ctx);
    expect(r).toContain('Economy Report');
  });

  it('defaults to BBC', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(sampleRss) });
    const r = await newsHeadlinesHandler({}, ctx);
    expect(r).toContain('BBC News');
  });

  it('respects max_items', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(sampleRss) });
    const r = await newsHeadlinesHandler({ max_items: 1 }, ctx);
    expect(r).toContain('Major Event');
    expect(r).not.toContain('Science');
  });

  it('throws for unknown source', async () => {
    await expect(newsHeadlinesHandler({ source: 'unknown' }, ctx)).rejects.toThrow('Unknown source');
  });

  it('throws when fetch fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(newsHeadlinesHandler({ source: 'bbc' }, ctx)).rejects.toThrow('Failed to fetch');
  });

  it('handles empty feed', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('<rss><channel></channel></rss>') });
    const r = await newsHeadlinesHandler({}, ctx);
    expect(r).toContain('No headlines');
  });

  it('includes links in output', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(sampleRss) });
    const r = await newsHeadlinesHandler({}, ctx);
    expect(r).toContain('https://bbc.co.uk/1');
  });

  it('limits to 15 items max', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(sampleRss) });
    const r = await newsHeadlinesHandler({ max_items: 100 }, ctx);
    // Only 3 items in our mock RSS
    expect(r).toContain('3.');
  });

  it('clamps max_items minimum to 1', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(sampleRss) });
    const r = await newsHeadlinesHandler({ max_items: 0 }, ctx);
    expect(r).toContain('1.');
  });

  it('accepts hackernews source', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(sampleRss) });
    const r = await newsHeadlinesHandler({ source: 'hackernews' }, ctx);
    expect(r).toContain('Hacker News');
  });
});
