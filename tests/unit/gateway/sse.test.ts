import { describe, it, expect, vi } from 'vitest';
import { initSSE, writeSSE, endSSE, errorSSE } from '../../../src/core/gateway/sse.js';
import type { ServerResponse } from 'node:http';

function mockRes() {
  const chunks: string[] = [];
  return {
    writeHead: vi.fn(),
    write: vi.fn((data: string) => { chunks.push(data); return true; }),
    end: vi.fn(),
    chunks,
  } as unknown as ServerResponse & { chunks: string[] };
}

describe('SSE utilities', () => {
  it('initSSE sets correct headers', () => {
    const res = mockRes();
    initSSE(res);
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    }));
  });

  it('writeSSE formats event + data correctly', () => {
    const res = mockRes();
    writeSSE(res, { event: 'chunk', data: '{"content":"hi"}' });
    expect(res.chunks[0]).toContain('event: chunk');
    expect(res.chunks[0]).toContain('data: {"content":"hi"}');
    expect(res.chunks[0]).toMatch(/\n\n$/);
  });

  it('writeSSE works without event name', () => {
    const res = mockRes();
    writeSSE(res, { data: 'test' });
    expect(res.chunks[0]).not.toContain('event:');
    expect(res.chunks[0]).toContain('data: test');
  });

  it('endSSE sends done event', () => {
    const res = mockRes();
    endSSE(res);
    expect(res.chunks[0]).toContain('event: done');
    expect(res.chunks[0]).toContain('data: [DONE]');
    expect(res.end).toHaveBeenCalled();
  });

  it('errorSSE sends error event', () => {
    const res = mockRes();
    errorSSE(res, 'something failed');
    expect(res.chunks[0]).toContain('event: error');
    expect(res.chunks[0]).toContain('something failed');
    expect(res.end).toHaveBeenCalled();
  });
});
