import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dictionaryHandler } from '../../../src/core/tools/builtins/dictionary.js';
import type { ToolContext } from '../../../src/core/tools/registry.js';

const ctx: ToolContext = {
  workspaceDir: '/tmp', memoryDir: '/tmp/mem', conversationId: 'test', userId: 'u1', maxExecutionMs: 5000,
};

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => { mockFetch.mockReset(); });

const sampleResponse = [{
  word: 'hello',
  phonetic: '/həˈloʊ/',
  meanings: [{
    partOfSpeech: 'exclamation',
    definitions: [
      { definition: 'Used as a greeting.', example: 'Hello, how are you?' },
      { definition: 'Used to express surprise.' },
    ],
  }, {
    partOfSpeech: 'noun',
    definitions: [{ definition: 'An utterance of hello; a greeting.' }],
  }],
}];

describe('dictionary tool', () => {
  it('returns definition for a word', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(sampleResponse) });
    const r = await dictionaryHandler({ word: 'hello' }, ctx);
    expect(r).toContain('hello');
    expect(r).toContain('/həˈloʊ/');
    expect(r).toContain('exclamation');
    expect(r).toContain('greeting');
  });

  it('includes examples', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(sampleResponse) });
    const r = await dictionaryHandler({ word: 'hello' }, ctx);
    expect(r).toContain('Hello, how are you?');
  });

  it('handles word not found', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    const r = await dictionaryHandler({ word: 'xyzzy' }, ctx);
    expect(r).toContain('Word not found');
  });

  it('throws for API error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(dictionaryHandler({ word: 'test' }, ctx)).rejects.toThrow('Dictionary API error');
  });

  it('throws for missing word', async () => {
    await expect(dictionaryHandler({}, ctx)).rejects.toThrow('Missing word');
  });

  it('throws for invalid characters', async () => {
    await expect(dictionaryHandler({ word: 'hello123' }, ctx)).rejects.toThrow('Invalid word');
  });

  it('throws for word too long', async () => {
    await expect(dictionaryHandler({ word: 'a'.repeat(101) }, ctx)).rejects.toThrow('too long');
  });

  it('handles multiple parts of speech', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(sampleResponse) });
    const r = await dictionaryHandler({ word: 'hello' }, ctx);
    expect(r).toContain('[exclamation]');
    expect(r).toContain('[noun]');
  });

  it('trims and lowercases input', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(sampleResponse) });
    await dictionaryHandler({ word: '  Hello  ' }, ctx);
    expect(mockFetch.mock.calls[0][0]).toContain('/hello');
  });
});
