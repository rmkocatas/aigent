import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipLookupHandler } from '../../../src/core/tools/builtins/ip-lookup.js';
import type { ToolContext } from '../../../src/core/tools/registry.js';

const ctx: ToolContext = {
  workspaceDir: '/tmp', memoryDir: '/tmp/mem', conversationId: 'test', userId: 'u1', maxExecutionMs: 5000,
};

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => { mockFetch.mockReset(); });

const sampleResponse = {
  status: 'success',
  country: 'United States',
  regionName: 'California',
  city: 'San Francisco',
  zip: '94102',
  lat: 37.7749,
  lon: -122.4194,
  timezone: 'America/Los_Angeles',
  isp: 'Cloudflare Inc',
  org: 'Cloudflare',
};

describe('ip_lookup tool', () => {
  it('looks up a public IP', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(sampleResponse) });
    const r = await ipLookupHandler({ ip: '1.1.1.1' }, ctx);
    expect(r).toContain('1.1.1.1');
    expect(r).toContain('United States');
    expect(r).toContain('San Francisco');
    expect(r).toContain('Cloudflare');
  });

  it('throws for private 10.x IP', async () => {
    await expect(ipLookupHandler({ ip: '10.0.0.1' }, ctx)).rejects.toThrow('private');
  });

  it('throws for private 192.168.x IP', async () => {
    await expect(ipLookupHandler({ ip: '192.168.1.1' }, ctx)).rejects.toThrow('private');
  });

  it('throws for localhost', async () => {
    await expect(ipLookupHandler({ ip: '127.0.0.1' }, ctx)).rejects.toThrow('private');
  });

  it('throws for private 172.16.x IP', async () => {
    await expect(ipLookupHandler({ ip: '172.16.0.1' }, ctx)).rejects.toThrow('private');
  });

  it('throws for invalid format', async () => {
    await expect(ipLookupHandler({ ip: 'not-an-ip' }, ctx)).rejects.toThrow('Invalid IPv4');
  });

  it('throws for octet > 255', async () => {
    await expect(ipLookupHandler({ ip: '256.1.1.1' }, ctx)).rejects.toThrow('0-255');
  });

  it('throws for missing IP', async () => {
    await expect(ipLookupHandler({}, ctx)).rejects.toThrow('Missing');
  });

  it('handles API failure response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ status: 'fail', message: 'reserved range' }) });
    await expect(ipLookupHandler({ ip: '8.8.8.8' }, ctx)).rejects.toThrow('reserved range');
  });
});
