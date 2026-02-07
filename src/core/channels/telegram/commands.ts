// ============================================================
// OpenClaw Deploy — Telegram Bot Commands
// ============================================================

import type { GatewayRuntimeConfig } from '../../../types/index.js';
import type { SessionStore } from '../../gateway/session-store.js';
import type { ApprovalManager } from '../../services/approval-manager.js';

export interface CommandContext {
  chatId: number;
  config: GatewayRuntimeConfig;
  sessions: SessionStore;
  sendMessage: (chatId: number, text: string) => Promise<void>;
  approvalManager?: ApprovalManager;
}

export async function handleCommand(
  text: string,
  ctx: CommandContext,
): Promise<void> {
  const [rawCmd] = text.split(' ');
  const cmd = rawCmd.toLowerCase().replace(/@\w+$/, ''); // strip @botname suffix

  switch (cmd) {
    case '/start':
      await ctx.sendMessage(ctx.chatId, getWelcomeMessage(ctx.config));
      break;
    case '/help':
      await ctx.sendMessage(ctx.chatId, getHelpMessage());
      break;
    case '/reset':
      ctx.sessions.reset(`telegram:${ctx.chatId}`);
      await ctx.sendMessage(ctx.chatId, 'Conversation reset. Starting fresh.');
      break;
    case '/info':
      await ctx.sendMessage(ctx.chatId, getInfoMessage(ctx));
      break;
    case '/approve': {
      if (!ctx.approvalManager) {
        await ctx.sendMessage(ctx.chatId, 'Approval system is not available.');
        break;
      }
      const userId = String(ctx.chatId);
      const handled = ctx.approvalManager.handleResponse(userId, true);
      if (handled) {
        await ctx.sendMessage(ctx.chatId, 'Approved.');
      } else {
        await ctx.sendMessage(ctx.chatId, 'No pending approval to respond to.');
      }
      break;
    }
    case '/deny': {
      if (!ctx.approvalManager) {
        await ctx.sendMessage(ctx.chatId, 'Approval system is not available.');
        break;
      }
      const userId = String(ctx.chatId);
      const handled = ctx.approvalManager.handleResponse(userId, false);
      if (handled) {
        await ctx.sendMessage(ctx.chatId, 'Denied.');
      } else {
        await ctx.sendMessage(ctx.chatId, 'No pending approval to respond to.');
      }
      break;
    }
    case '/pending': {
      if (!ctx.approvalManager) {
        await ctx.sendMessage(ctx.chatId, 'Approval system is not available.');
        break;
      }
      const userId = String(ctx.chatId);
      const pending = ctx.approvalManager.getPending(userId);
      if (pending) {
        await ctx.sendMessage(
          ctx.chatId,
          `Pending approval:\nAction: ${pending.action}\n${pending.details}`,
        );
      } else {
        await ctx.sendMessage(ctx.chatId, 'No pending approvals.');
      }
      break;
    }
    default:
      await ctx.sendMessage(ctx.chatId, `Unknown command: ${cmd}\nType /help for available commands.`);
  }
}

function getWelcomeMessage(config: GatewayRuntimeConfig): string {
  const name = config.systemPrompt ? 'MoltBot' : 'OpenClaw Bot';
  return [
    `Welcome to ${name}!`,
    '',
    "I'm your AI assistant. Send me a message and I'll respond.",
    '',
    'Commands:',
    '/help    - Show available commands',
    '/reset   - Clear conversation history',
    '/info    - Show system info',
    '/approve - Approve a pending action',
    '/deny    - Deny a pending action',
    '/pending - Show pending approval',
  ].join('\n');
}

function getHelpMessage(): string {
  return [
    'Available commands:',
    '',
    '/start   - Welcome message',
    '/help    - This help text',
    '/reset   - Clear conversation history',
    '/info    - Show system info',
    '/approve - Approve a pending action',
    '/deny    - Deny a pending action',
    '/pending - Show pending approval',
    '',
    'Just type a message to chat!',
  ].join('\n');
}

function getInfoMessage(ctx: CommandContext): string {
  const conv = ctx.sessions.getConversation(`telegram:${ctx.chatId}`);
  const msgCount = conv?.messages.length ?? 0;
  const routingMode = ctx.config.routing?.mode ?? 'single';
  const localModel = ctx.config.ollama?.model ?? 'none';
  const cloudConfigured = ctx.config.anthropicApiKey ? 'yes' : 'no';

  return [
    'System Info:',
    `  Routing: ${routingMode}`,
    `  Local model: ${localModel}`,
    `  Cloud API: ${cloudConfigured}`,
    `  Messages in context: ${msgCount}`,
  ].join('\n');
}
