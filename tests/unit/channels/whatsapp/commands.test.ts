import { describe, it, expect, vi } from 'vitest';
import { handleCommand } from '../../../../src/core/channels/whatsapp/commands.js';
import type { WhatsAppCommandContext } from '../../../../src/core/channels/whatsapp/commands.js';
import type { GatewayRuntimeConfig } from '../../../../src/types/index.js';

function makeContext(overrides: Partial<WhatsAppCommandContext> = {}): WhatsAppCommandContext {
  return {
    from: '1234567890',
    config: {
      channels: [{ id: 'webchat', enabled: true }],
    } as GatewayRuntimeConfig,
    sessions: {
      reset: vi.fn(),
      getConversation: vi.fn().mockReturnValue({ messages: [] }),
    } as never,
    sendMessage: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('handleCommand', () => {
  it('responds to /start with welcome message', async () => {
    const ctx = makeContext();
    await handleCommand('/start', ctx);
    expect(ctx.sendMessage).toHaveBeenCalledOnce();
    const msg = (ctx.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(msg).toContain('Welcome');
  });

  it('responds to /help with available commands', async () => {
    const ctx = makeContext();
    await handleCommand('/help', ctx);
    const msg = (ctx.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(msg).toContain('/help');
    expect(msg).toContain('/reset');
  });

  it('resets session on /reset', async () => {
    const ctx = makeContext();
    await handleCommand('/reset', ctx);
    expect(ctx.sessions.reset).toHaveBeenCalledWith('whatsapp:1234567890');
    const msg = (ctx.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(msg).toContain('reset');
  });

  it('responds to /info with session info', async () => {
    const ctx = makeContext();
    await handleCommand('/info', ctx);
    const msg = (ctx.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(msg).toContain('Messages in session');
  });

  it('handles unknown command', async () => {
    const ctx = makeContext();
    await handleCommand('/unknown', ctx);
    const msg = (ctx.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(msg).toContain('Unknown command');
  });

  it('handles /approve without approval manager', async () => {
    const ctx = makeContext();
    await handleCommand('/approve', ctx);
    const msg = (ctx.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(msg).toContain('not enabled');
  });
});
