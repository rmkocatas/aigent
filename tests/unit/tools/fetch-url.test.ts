import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchUrlHandler, validateUrlSafety } from '../../../src/core/tools/builtins/fetch-url.js';
import type { ToolContext } from '../../../src/core/tools/registry.js';

// Mock dns lookup
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn().mockResolvedValue({ address: '93.184.216.34', family: 4 }),
}));

const context: ToolContext = {
  workspaceDir: '/tmp',
  memoryDir: '/tmp/memory',
  conversationId: 'test',
  userId: 'test-user',
  maxExecutionMs: 15000,
};

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe('fetch_url tool', () => {
  it('returns page content with HTML stripped', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Map([['content-type', 'text/html']]),
      text: async () => '<html><body><h1>Title</h1><p>Hello world</p></body></html>',
    });

    const result = await fetchUrlHandler({ url: 'https://example.com' }, context);
    expect(result).toContain('Title');
    expect(result).toContain('Hello world');
    expect(result).not.toContain('<h1>');
  });

  it('returns JSON as-is for JSON responses', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => '{"name":"test","value":42}',
    });

    const result = await fetchUrlHandler({ url: 'https://api.example.com/data' }, context);
    expect(result).toContain('"name": "test"');
    expect(result).toContain('"value": 42');
  });

  it('rejects invalid URLs', async () => {
    await expect(
      fetchUrlHandler({ url: 'ftp://example.com' }, context),
    ).rejects.toThrow('must start with http');
  });

  it('rejects missing URL', async () => {
    await expect(
      fetchUrlHandler({}, context),
    ).rejects.toThrow('Missing URL');
  });

  it('throws on fetch failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    await expect(
      fetchUrlHandler({ url: 'https://example.com/missing' }, context),
    ).rejects.toThrow('Failed to fetch');
  });

  it('truncates long content', async () => {
    const longContent = 'x'.repeat(40000);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Map([['content-type', 'text/plain']]),
      text: async () => longContent,
    });

    const result = await fetchUrlHandler({ url: 'https://example.com/big' }, context);
    expect(result).toContain('[Content truncated');
    expect(result.length).toBeLessThan(35000);
  });
});

describe('SSRF protection', () => {
  it('blocks localhost (127.0.0.1)', async () => {
    const { lookup } = await import('node:dns/promises');
    (lookup as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ address: '127.0.0.1', family: 4 });

    await expect(
      validateUrlSafety('https://localhost/admin'),
    ).rejects.toThrow('SSRF blocked');
  });

  it('blocks private 10.x range', async () => {
    const { lookup } = await import('node:dns/promises');
    (lookup as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ address: '10.0.0.1', family: 4 });

    await expect(
      validateUrlSafety('https://internal.corp/api'),
    ).rejects.toThrow('SSRF blocked');
  });

  it('blocks private 192.168.x range', async () => {
    const { lookup } = await import('node:dns/promises');
    (lookup as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ address: '192.168.1.1', family: 4 });

    await expect(
      validateUrlSafety('https://router.local'),
    ).rejects.toThrow('SSRF blocked');
  });

  it('blocks private 172.16-31.x range', async () => {
    const { lookup } = await import('node:dns/promises');
    (lookup as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ address: '172.16.0.1', family: 4 });

    await expect(
      validateUrlSafety('https://docker-internal'),
    ).rejects.toThrow('SSRF blocked');
  });

  it('blocks IPv6 loopback ::1', async () => {
    const { lookup } = await import('node:dns/promises');
    (lookup as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ address: '::1', family: 6 });

    await expect(
      validateUrlSafety('https://localhost6'),
    ).rejects.toThrow('SSRF blocked');
  });

  it('allows public IPs', async () => {
    const { lookup } = await import('node:dns/promises');
    (lookup as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ address: '93.184.216.34', family: 4 });

    await expect(
      validateUrlSafety('https://example.com'),
    ).resolves.toBeUndefined();
  });
});
