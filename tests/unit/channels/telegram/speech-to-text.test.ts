import { describe, it, expect, vi, afterEach } from 'vitest';
import { transcribeAudio } from '../../../../src/core/channels/telegram/speech-to-text.js';

describe('transcribeAudio', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns transcription text on success', async () => {
    const mockResponse = { text: 'Hello, this is a test transcription.' };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    const buffer = Buffer.from('fake-audio-data');
    const result = await transcribeAudio(buffer, 'sk-test-key');

    expect(result).toBe('Hello, this is a test transcription.');

    // Verify fetch was called with correct parameters
    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(fetchCall[0]).toBe('https://api.openai.com/v1/audio/transcriptions');

    const options = fetchCall[1] as RequestInit;
    expect(options.method).toBe('POST');
    expect((options.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer sk-test-key',
    );

    // Verify FormData was sent with the correct fields
    const body = options.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('model')).toBe('whisper-1');
    expect(body.get('file')).toBeInstanceOf(Blob);
  });

  it('throws on API error response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":"Invalid API key"}',
    });

    const buffer = Buffer.from('fake-audio-data');
    await expect(transcribeAudio(buffer, 'bad-key')).rejects.toThrow(
      'Whisper API error 401',
    );
  });

  it('throws when file exceeds 25MB limit', async () => {
    const largeBuffer = Buffer.alloc(26 * 1024 * 1024); // 26 MB

    await expect(transcribeAudio(largeBuffer, 'sk-test-key')).rejects.toThrow(
      'exceeds 25MB limit',
    );
  });

  it('uses custom API URL and model when config provided', async () => {
    const mockResponse = { text: 'Groq transcription' };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    const buffer = Buffer.from('fake-audio-data');
    const result = await transcribeAudio(buffer, 'gsk-test-key', {
      apiUrl: 'https://api.groq.com/openai/v1/audio/transcriptions',
      model: 'whisper-large-v3-turbo',
    });

    expect(result).toBe('Groq transcription');

    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(fetchCall[0]).toBe('https://api.groq.com/openai/v1/audio/transcriptions');

    const body = (fetchCall[1] as RequestInit).body as FormData;
    expect(body.get('model')).toBe('whisper-large-v3-turbo');
  });

  it('throws on timeout', async () => {
    // Simulate what happens when AbortSignal.timeout fires:
    // fetch rejects with a TimeoutError (a DOMException with name "TimeoutError")
    globalThis.fetch = vi.fn().mockImplementation(
      (_url: string, _init: RequestInit | undefined) => {
        return Promise.reject(
          new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
        );
      },
    );

    const buffer = Buffer.from('fake-audio-data');
    await expect(transcribeAudio(buffer, 'sk-test-key')).rejects.toThrow(
      'The operation was aborted due to timeout',
    );
  });
});
