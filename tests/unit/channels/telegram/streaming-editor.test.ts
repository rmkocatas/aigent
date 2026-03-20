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

// Chunks long enough to exceed the minCharsBeforeFirstSend (40) threshold
const FIRST_CHUNK = 'This is a sufficiently long first chunk for streaming.'; // 54 chars
// Enough new chars (80+) to trigger a debounced edit
const SECOND_CHUNK = ' Here is additional content that should push us past the minimum character threshold for edits.'; // 95 chars

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
  // First chunk sends a new message (once buffer exceeds 40 chars)
  // -----------------------------------------------------------------------

  it('sends a new message once buffer exceeds minCharsBeforeFirstSend', async () => {
    const fetchMock = mockFetch(99);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const editor = new TelegramStreamingEditor(CHAT_ID, BOT_TOKEN);
    await editor.addChunk(FIRST_CHUNK);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const url = calledUrl(fetchMock.mock.calls[0]);
    expect(url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`);

    const body = parsedBody(fetchMock.mock.calls[0]);
    expect(body.chat_id).toBe(CHAT_ID);
    expect(body.text).toBe(FIRST_CHUNK);
  });

  it('buffers short chunks until threshold is reached', async () => {
    const fetchMock = mockFetch(99);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const editor = new TelegramStreamingEditor(CHAT_ID, BOT_TOKEN);

    // Short chunk — below 40 chars, should be buffered
    await editor.addChunk('Hello');
    expect(fetchMock).toHaveBeenCalledTimes(0);

    // Add more to exceed threshold
    await editor.addChunk(' world, this is a longer message now!!!');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const body = parsedBody(fetchMock.mock.calls[0]);
    expect(body.text).toBe('Hello world, this is a longer message now!!!');
  });

  // -----------------------------------------------------------------------
  // Subsequent chunks trigger debounced edit (after 80+ new chars)
  // -----------------------------------------------------------------------

  it('debounces editMessageText for subsequent chunks with enough content', async () => {
    const fetchMock = mockFetch(42);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const editor = new TelegramStreamingEditor(CHAT_ID, BOT_TOKEN);

    // First chunk — sends message
    await editor.addChunk(FIRST_CHUNK);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second chunk with 80+ new chars — schedules debounced edit
    await editor.addChunk(SECOND_CHUNK);
    // No immediate edit call
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Advance past the debounce interval (3000ms)
    await vi.advanceTimersByTimeAsync(3100);

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const url = calledUrl(fetchMock.mock.calls[1]);
    expect(url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`);

    const body = parsedBody(fetchMock.mock.calls[1]);
    expect(body.chat_id).toBe(CHAT_ID);
    expect(body.message_id).toBe(42);
    expect(body.text).toBe(FIRST_CHUNK + SECOND_CHUNK);
  });

  it('does not schedule edit for small incremental chunks', async () => {
    const fetchMock = mockFetch(42);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const editor = new TelegramStreamingEditor(CHAT_ID, BOT_TOKEN);

    await editor.addChunk(FIRST_CHUNK);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Small chunks — below 80 new chars, no edit scheduled
    await editor.addChunk(' short');
    await editor.addChunk(' bits');

    await vi.advanceTimersByTimeAsync(5000);
    // Only the initial sendMessage, no edits
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Finalize sends final edit
  // -----------------------------------------------------------------------

  it('finalize sends the final edit with complete text', async () => {
    const fetchMock = mockFetch(42);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const editor = new TelegramStreamingEditor(CHAT_ID, BOT_TOKEN);

    await editor.addChunk(FIRST_CHUNK);
    await editor.addChunk(' more');

    // Clear call count after setup
    fetchMock.mockClear();

    await editor.finalize();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const url = calledUrl(fetchMock.mock.calls[0]);
    expect(url).toContain('/editMessageText');

    const body = parsedBody(fetchMock.mock.calls[0]);
    expect(body.text).toBe(FIRST_CHUNK + ' more');
  });

  it('finalize sends short response as new message if never sent', async () => {
    const fetchMock = mockFetch(42);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const editor = new TelegramStreamingEditor(CHAT_ID, BOT_TOKEN);

    // Short text — below threshold, never sent
    await editor.addChunk('Hi!');
    expect(fetchMock).toHaveBeenCalledTimes(0);

    await editor.finalize();

    // finalize should send the buffered text as a new message
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = calledUrl(fetchMock.mock.calls[0]);
    expect(url).toContain('/sendMessage');

    const body = parsedBody(fetchMock.mock.calls[0]);
    expect(body.text).toBe('Hi!');
  });

  it('finalize clears any pending timer', async () => {
    const fetchMock = mockFetch(42);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const editor = new TelegramStreamingEditor(CHAT_ID, BOT_TOKEN);

    await editor.addChunk(FIRST_CHUNK);
    await editor.addChunk(SECOND_CHUNK); // Schedules a timer

    await editor.finalize();

    fetchMock.mockClear();

    // Advancing timers should not cause additional calls
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  // -----------------------------------------------------------------------
  // Content over 4000 chars creates a new message
  // -----------------------------------------------------------------------

  it('starts a new message when content exceeds 4000 chars', async () => {
    const fetchMock = mockFetch(42);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const editor = new TelegramStreamingEditor(CHAT_ID, BOT_TOKEN);

    // First chunk — sends initial message (well above 40 char threshold)
    const longText = 'x'.repeat(3900);
    await editor.addChunk(longText);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second chunk pushes past 4000 — triggers edit of current message
    // and resets for a new message
    await editor.addChunk('y'.repeat(200));

    // Should have called editMessageText to finalize the current message
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchMock).toHaveBeenCalledTimes(2); // sendMessage + editMessageText

    const editUrl = calledUrl(fetchMock.mock.calls[1]);
    expect(editUrl).toContain('/editMessageText');

    // Now sending another chunk should create a new message
    fetchMock.mockClear();
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: { message_id: 43 } }),
    });

    // Chunk must exceed minCharsBeforeFirstSend (40) for new message
    await editor.addChunk('New message content that is long enough to send.');
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
    await expect(editor.addChunk(FIRST_CHUNK)).resolves.toBeUndefined();
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

    await editor.addChunk(FIRST_CHUNK);
    await editor.addChunk(SECOND_CHUNK);

    // Advance timer to trigger edit (3000ms interval)
    await vi.advanceTimersByTimeAsync(3100);

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
    await editor.addChunk(FIRST_CHUNK);

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
    await editor.addChunk(FIRST_CHUNK);
    await editor.finalize();

    fetchMock.mockClear();

    await editor.addChunk('should be ignored');
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
});
