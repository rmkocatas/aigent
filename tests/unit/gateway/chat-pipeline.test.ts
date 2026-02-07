import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processChatMessage } from '../../../src/core/gateway/chat-pipeline.js';
import type { ChatPipelineDeps } from '../../../src/core/gateway/chat-pipeline.js';
import { SessionStore } from '../../../src/core/gateway/session-store.js';
import type { GatewayRuntimeConfig } from '../../../src/types/index.js';

// Mock providers
vi.mock('../../../src/core/gateway/ollama-client.js', () => ({
  streamOllamaChat: vi.fn(async function* () {
    yield { content: 'Hello', done: false, provider: 'ollama', model: 'test' };
    yield { content: ' world', done: false, provider: 'ollama', model: 'test' };
    yield { content: '', done: true, provider: 'ollama', model: 'test' };
  }),
}));

vi.mock('../../../src/core/gateway/anthropic-client.js', () => ({
  streamAnthropicChat: vi.fn(async function* () {
    yield { content: 'Claude says hi', done: false, provider: 'anthropic', model: 'test' };
    yield { content: '', done: true, provider: 'anthropic', model: 'test' };
  }),
}));

function makeConfig(overrides: Partial<GatewayRuntimeConfig> = {}): GatewayRuntimeConfig {
  return {
    bind: '127.0.0.1',
    port: 18789,
    token: 'test',
    systemPrompt: null,
    channels: [],
    telegramBotToken: null,
    telegramAllowedUsers: [],
    ollama: { baseUrl: 'http://localhost:11434', model: 'llama3.3:70b' },
    anthropicApiKey: null,
    routing: { mode: 'single', primary: 'ollama', rules: [] },
    training: null,
    tools: { deny: [], sandboxMode: 'off', workspaceDir: '/tmp', maxExecutionMs: 30000 },
    session: { idleTimeoutMinutes: 30, maxConcurrent: 100 },
    whisperApiKey: null,
    ...overrides,
  };
}

describe('processChatMessage', () => {
  let sessions: SessionStore;
  let deps: ChatPipelineDeps;

  beforeEach(() => {
    sessions = new SessionStore(30, 100);
    deps = {
      config: makeConfig(),
      sessions,
      trainingStore: null,
    };
  });

  it('returns full response from provider', async () => {
    const result = await processChatMessage(
      { message: 'hi', source: 'webchat' },
      deps,
    );
    expect(result.response).toBe('Hello world');
    expect(result.provider).toBe('ollama');
  });

  it('creates a conversation and returns its ID', async () => {
    const result = await processChatMessage(
      { message: 'hi', source: 'webchat' },
      deps,
    );
    expect(result.conversationId).toBeTruthy();
  });

  it('uses provided conversationId', async () => {
    const result = await processChatMessage(
      { message: 'hi', conversationId: 'test-conv', source: 'webchat' },
      deps,
    );
    expect(result.conversationId).toBe('test-conv');
  });

  it('calls onChunk for each streaming chunk', async () => {
    const chunks: string[] = [];
    await processChatMessage(
      { message: 'hi', source: 'webchat' },
      deps,
      { onChunk: (c) => chunks.push(c) },
    );
    expect(chunks).toEqual(['Hello', ' world']);
  });

  it('calls onMeta with classification info', async () => {
    let meta: unknown = null;
    await processChatMessage(
      { message: 'hi', source: 'webchat' },
      deps,
      { onMeta: (m) => { meta = m; } },
    );
    expect(meta).toMatchObject({
      provider: 'ollama',
      classification: expect.any(String),
    });
  });

  it('works without callbacks (telegram mode)', async () => {
    const result = await processChatMessage(
      { message: 'hi', source: 'telegram' },
      deps,
    );
    expect(result.response).toBe('Hello world');
  });

  it('saves messages to session store', async () => {
    const result = await processChatMessage(
      { message: 'hi', conversationId: 'sess1', source: 'webchat' },
      deps,
    );
    const conv = sessions.getConversation(result.conversationId);
    expect(conv?.messages).toHaveLength(2); // user + assistant
    expect(conv?.messages[0].role).toBe('user');
    expect(conv?.messages[1].role).toBe('assistant');
  });

  it('includes classification in result', async () => {
    const result = await processChatMessage(
      { message: 'hello', source: 'webchat' },
      deps,
    );
    expect(['simple', 'complex', 'coding', 'default']).toContain(result.classification);
  });

  it('returns fallbackUsed = false normally', async () => {
    const result = await processChatMessage(
      { message: 'hi', source: 'webchat' },
      deps,
    );
    expect(result.fallbackUsed).toBe(false);
  });
});
