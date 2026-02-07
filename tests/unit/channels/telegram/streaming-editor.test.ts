import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TelegramStreamingEditor } from '../../../../src/core/channels/telegram/streaming-editor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetch(messageId = 42) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ result: { message_id: messageId } }),
  });
}

function parsedBody(call: unknown[]): Record<string, unknown> {
  const init = call[1] as RequestInit;
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

function calledUrl(call: unknown[]): string {
  return call[0] as string;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TelegramStreamingEditor', () => {
  const CHAT_ID = 12345;
  const BOT_TOKEN = 'test-bot-token';

  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // First chunk sends a new message
  // -----------------------------------------------------------------------

  it('sends a new message on the first chunk and captures message_id', async () => {
    const fetchMock = mockFetch(99);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const editor = new TelegramStreamingEditor(CHAT_ID, BOT_TOKEN);
    await editor.addChunk('Hello');

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const url = calledUrl(fetchMock.mock.calls[0]);
    expect(url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`);

    const body = parsedBody(fetchMock.mock.calls[0]);
    expect(body.chat_id).toBe(CHAT_ID);
    expect(body.text).toBe('Hello');
  });

  // -----------------------------------------------------------------------
  // Subsequent chunks trigger debounced edit
  // -----------------------------------------------------------------------

  it('debounces editMessageText for subsequent chunks', async () => {
    const fetchMock = mockFetch(42);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const editor = new TelegramStreamingEditor(CHAT_ID, BOT_TOKEN);

    // First chunk — sends message
    await editor.addChunk('Hello');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second chunk — schedules debounced edit
    await editor.addChunk(' world');
    // No immediate edit call
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Third chunk before timer fires — timer resets
    await editor.addChunk('!');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Advance past the debounce interval
    await vi.advanceTimersByTimeAsync(1600);

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const url = calledUrl(fetchMock.mock.calls[1]);
    expect(url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`);

    const body = parsedBody(fetchMock.mock.calls[1]);
    expect(body.chat_id).toBe(CHAT_ID);
    expect(body.message_id).toBe(42);
    expect(body.text).toBe('Hello world!');
  });

  // -----------------------------------------------------------------------
  // Finalize sends final edit
  // -----------------------------------------------------------------------

  it('finalize sends the final edit with complete text', async () => {
    const fetchMock = mockFetch(42);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const editor = new TelegramStreamingEditor(CHAT_ID, BOT_TOKEN);

    await editor.addChunk('Hello');
    await editor.addChunk(' world');

    // Clear call count after setup
    fetchMock.mockClear();

    await editor.finalize();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const url = calledUrl(fetchMock.mock.calls[0]);
    expect(url).toContain('/editMessageText');

    const body = parsedBody(fetchMock.mock.calls[0]);
    expect(body.text).toBe('Hello world');
  });

  it('finalize clears any pending timer', async () => {
    const fetchMock = mockFetch(42);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const editor = new TelegramStreamingEditor(CHAT_ID, BOT_TOKEN);

    await editor.addChunk('Hello');
    await editor.addChunk(' world'); // Schedules a timer

    await editor.finalize();

    fetchMock.mockClear();

    // Advancing timers should not cause additional calls
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  // -----------------------------------------------------------------------
  // Content over 4000 chars creates a new message
  // -----------------------------------------------------------------------

  it('starts a new message when content exceeds 4000 chars', async () => {
    const fetchMock = mockFetch(42);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const editor = new TelegramStreamingEditor(CHAT_ID, BOT_TOKEN);

    // First chunk — sends initial message
    const longText = 'x'.repeat(3900);
    await editor.addChunk(longText);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second chunk pushes past 4000 — triggers edit of current message
    // and resets for a new message
    await editor.addChunk('y'.repeat(200));

    // Should have called editMessageText to finalize the current message
    // (the addChunk detects overflow and flushes)
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchMock).toHaveBeenCalledTimes(2); // sendMessage + editMessageText

    const editUrl = calledUrl(fetchMock.mock.calls[1]);
    expect(editUrl).toContain('/editMessageText');

    // Now sending another chunk should create a new message
    fetchMock.mockClear();
    // Reset mock to return a new message_id
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: { message_id: 43 } }),
    });

    await editor.addChunk('New message content');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const newUrl = calledUrl(fetchMock.mock.calls[0]);
    expect(newUrl).toContain('/sendMessage');
  });

  // -----------------------------------------------------------------------
  // API errors are handled gracefully
  // -----------------------------------------------------------------------

  it('handles sendMessage failure gracefully', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const editor = new TelegramStreamingEditor(CHAT_ID, BOT_TOKEN);

    // Should not throw
    await expect(editor.addChunk('Hello')).resolves.toBeUndefined();
  });

  it('handles editMessageText failure gracefully', async () => {
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // sendMessage succeeds
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ result: { message_id: 42 } }),
        });
      }
      // editMessageText fails
      return Promise.resolve({ ok: false, status: 400 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const editor = new TelegramStreamingEditor(CHAT_ID, BOT_TOKEN);

    await editor.addChunk('Hello');
    await editor.addChunk(' world');

    // Advance timer to trigger edit
    await vi.advanceTimersByTimeAsync(1600);

    // Should not throw — error is caught
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // -----------------------------------------------------------------------
  // Double finalize is safe
  // -----------------------------------------------------------------------

  it('calling finalize twice is safe', async () => {
    const fetchMock = mockFetch(42);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const editor = new TelegramStreamingEditor(CHAT_ID, BOT_TOKEN);
    await editor.addChunk('Hello');

    await editor.finalize();
    fetchMock.mockClear();

    // Second finalize should be a no-op
    await editor.finalize();
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  // -----------------------------------------------------------------------
  // Chunks after finalize are ignored
  // -----------------------------------------------------------------------

  it('ignores chunks added after finalize', async () => {
    const fetchMock = mockFetch(42);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const editor = new TelegramStreamingEditor(CHAT_ID, BOT_TOKEN);
    await editor.addChunk('Hello');
    await editor.finalize();

    fetchMock.mockClear();

    await editor.addChunk('should be ignored');
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
});
