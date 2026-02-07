import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleCommand } from '../../../../src/core/channels/telegram/commands.js';
import type { CommandContext } from '../../../../src/core/channels/telegram/commands.js';
import { SessionStore } from '../../../../src/core/gateway/session-store.js';
import type { GatewayRuntimeConfig } from '../../../../src/types/index.js';

function makeConfig(): GatewayRuntimeConfig {
  return {
    bind: '127.0.0.1',
    port: 18789,
    token: 'test',
    systemPrompt: 'You are MoltBot.',
    channels: [{ id: 'webchat', enabled: true }],
    telegramBotToken: null,
    telegramAllowedUsers: [],
    ollama: { baseUrl: 'http://localhost:11434', model: 'llama3.3:70b' },
    anthropicApiKey: 'sk-test',
    routing: { mode: 'hybrid', primary: 'ollama', rules: [] },
    training: null,
    tools: { deny: [], sandboxMode: 'off', workspaceDir: '/tmp', maxExecutionMs: 30000 },
    session: { idleTimeoutMinutes: 30, maxConcurrent: 100 },
    whisperApiKey: null,
  };
}

describe('handleCommand', () => {
  let sessions: SessionStore;
  let sentMessages: string[];
  let ctx: CommandContext;

  beforeEach(() => {
    sessions = new SessionStore(30, 100);
    sentMessages = [];
    ctx = {
      chatId: 12345,
      config: makeConfig(),
      sessions,
      sendMessage: vi.fn(async (_id: number, msg: string) => {
        sentMessages.push(msg);
      }),
    };
  });

  it('/start sends welcome message', async () => {
    await handleCommand('/start', ctx);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toContain('Welcome');
    expect(sentMessages[0]).toContain('/help');
  });

  it('/help sends help text', async () => {
    await handleCommand('/help', ctx);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toContain('Available commands');
    expect(sentMessages[0]).toContain('/reset');
  });

  it('/reset clears conversation', async () => {
    // Create a conversation with messages
    await sessions.getOrCreate('telegram:12345');
    sessions.addMessage('telegram:12345', {
      role: 'user',
      content: 'test',
      timestamp: new Date().toISOString(),
    });

    await handleCommand('/reset', ctx);
    expect(sentMessages[0]).toContain('reset');

    const conv = sessions.getConversation('telegram:12345');
    expect(conv?.messages).toHaveLength(0);
  });

  it('/info shows system info', async () => {
    await handleCommand('/info', ctx);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toContain('hybrid');
    expect(sentMessages[0]).toContain('llama3.3:70b');
  });

  it('unknown command returns help suggestion', async () => {
    await handleCommand('/unknown', ctx);
    expect(sentMessages[0]).toContain('Unknown command');
    expect(sentMessages[0]).toContain('/help');
  });

  it('handles @botname suffix in commands', async () => {
    await handleCommand('/help@QuerquoBot', ctx);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toContain('Available commands');
  });
});
