// ============================================================
// OpenClaw Deploy — WhatsApp Command Handler
// ============================================================

import type { GatewayRuntimeConfig } from '../../../types/index.js';
import type { SessionStore } from '../../gateway/session-store.js';
import type { ApprovalManager } from '../../services/approval-manager.js';

export interface WhatsAppCommandContext {
  from: string;
  config: GatewayRuntimeConfig;
  sessions: SessionStore;
  sendMessage: (to: string, text: string) => Promise<void>;
  approvalManager?: ApprovalManager;
}

export async function handleCommand(
  text: string,
  ctx: WhatsAppCommandContext,
): Promise<void> {
  const [rawCmd] = text.split(' ');
  const cmd = rawCmd.toLowerCase();

  switch (cmd) {
    case '/start':
    case '/hello':
      await ctx.sendMessage(ctx.from, getWelcomeMessage(ctx.config));
      break;

    case '/help':
      await ctx.sendMessage(ctx.from, getHelpMessage());
      break;

    case '/reset':
      ctx.sessions.reset(`whatsapp:${ctx.from}`);
      await ctx.sendMessage(ctx.from, 'Conversation reset. Starting fresh.');
      break;

    case '/info':
      await ctx.sendMessage(ctx.from, getInfoMessage(ctx));
      break;

    case '/approve': {
      if (!ctx.approvalManager) {
        await ctx.sendMessage(ctx.from, 'Approval system is not enabled.');
        break;
      }
      const handled = ctx.approvalManager.handleResponse(ctx.from, true);
      await ctx.sendMessage(
        ctx.from,
        handled ? 'Approved.' : 'No pending approval found.',
      );
      break;
    }

    case '/deny': {
      if (!ctx.approvalManager) {
        await ctx.sendMessage(ctx.from, 'Approval system is not enabled.');
        break;
      }
      const handled = ctx.approvalManager.handleResponse(ctx.from, false);
      await ctx.sendMessage(
        ctx.from,
        handled ? 'Denied.' : 'No pending approval found.',
      );
      break;
    }

    case '/pending': {
      if (!ctx.approvalManager) {
        await ctx.sendMessage(ctx.from, 'Approval system is not enabled.');
        break;
      }
      const pending = ctx.approvalManager.getPending(ctx.from);
      if (!pending) {
        await ctx.sendMessage(ctx.from, 'No pending approvals.');
      } else {
        await ctx.sendMessage(
          ctx.from,
          `Pending approval:\n1. ${pending.details}`,
        );
      }
      break;
    }

    default:
      await ctx.sendMessage(
        ctx.from,
        `Unknown command: ${cmd}\nType /help for available commands.`,
      );
      break;
  }
}

function getWelcomeMessage(config: GatewayRuntimeConfig): string {
  const channelCount = config.channels?.filter((ch) => ch.enabled).length ?? 1;
  return [
    'Welcome to OpenClaw!',
    '',
    `This bot is running with ${channelCount} active channel(s).`,
    'Send a message to start chatting, or type /help for commands.',
  ].join('\n');
}

function getHelpMessage(): string {
  return [
    'Available commands:',
    '',
    '/help — Show this message',
    '/reset — Clear conversation history',
    '/info — Show bot information',
    '/approve — Approve pending action',
    '/deny — Deny pending action',
    '/pending — List pending approvals',
  ].join('\n');
}

function getInfoMessage(ctx: WhatsAppCommandContext): string {
  const lines: string[] = ['Bot Info:'];
  const session = ctx.sessions.getConversation(`whatsapp:${ctx.from}`);
  const msgCount = session?.messages.length ?? 0;
  lines.push(`Messages in session: ${msgCount}`);
  return lines.join('\n');
}
