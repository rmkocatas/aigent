import { describe, it, expect, vi, beforeEach } from 'vitest';
import { webSearchHandler } from '../../../src/core/tools/builtins/web-search.js';
import type { ToolContext } from '../../../src/core/tools/registry.js';

const context: ToolContext = {
  workspaceDir: '/tmp',
  memoryDir: '/tmp/memory',
  conversationId: 'test',
  userId: 'test-user',
  maxExecutionMs: 15000,
};

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

const SAMPLE_HTML = `
<html><body>
<div class="result__body">
  <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fpage1">Example Page 1</a>
  <a class="result__snippet">This is the first result snippet.</a>
</div>
<div class="result__body">
  <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fpage2">Example Page 2</a>
  <a class="result__snippet">This is the second result snippet.</a>
</div>
</body></html>
`;

describe('web_search tool', () => {
  it('returns formatted search results', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => SAMPLE_HTML,
    });

    const result = await webSearchHandler({ query: 'test query' }, context);
    expect(result).toContain('Example Page 1');
    expect(result).toContain('example.com/page1');
    expect(result).toContain('first result snippet');
  });

  it('handles no results', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '<html><body></body></html>',
    });

    const result = await webSearchHandler({ query: 'obscure query' }, context);
    expect(result).toContain('No search results');
  });

  it('throws on fetch failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    await expect(
      webSearchHandler({ query: 'test' }, context),
    ).rejects.toThrow('Search request failed');
  });

  it('throws on missing query', async () => {
    await expect(
      webSearchHandler({}, context),
    ).rejects.toThrow('Missing search query');
  });

  it('respects max_results parameter', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => SAMPLE_HTML,
    });

    const result = await webSearchHandler(
      { query: 'test', max_results: 1 },
      context,
    );
    // Should only have "1." but not "2."
    expect(result).toContain('1.');
    expect(result).not.toContain('2.');
  });
});
