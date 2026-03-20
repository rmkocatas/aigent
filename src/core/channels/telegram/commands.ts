// ============================================================
// OpenClaw Deploy — Telegram Bot Commands
// ============================================================

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
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

// ---------------------------------------------------------------------------
// Bookmark/Pin storage
// ---------------------------------------------------------------------------

interface Bookmark {
  id: number;
  text: string;
  createdAt: string;
}

function getBookmarksPath(config: GatewayRuntimeConfig, chatId: number): string {
  const baseDir = config.tools.workspaceDir ?? '.';
  return join(baseDir, 'bookmarks', `${chatId}.json`);
}

async function loadBookmarks(config: GatewayRuntimeConfig, chatId: number): Promise<Bookmark[]> {
  try {
    const content = await readFile(getBookmarksPath(config, chatId), 'utf-8');
    return JSON.parse(content) as Bookmark[];
  } catch {
    return [];
  }
}

async function saveBookmarks(config: GatewayRuntimeConfig, chatId: number, bookmarks: Bookmark[]): Promise<void> {
  const filePath = getBookmarksPath(config, chatId);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(bookmarks, null, 2), 'utf-8');
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
    case '/pin': {
      const pinText = text.slice(text.indexOf(' ') + 1).trim();
      if (!pinText || pinText === '/pin') {
        await ctx.sendMessage(ctx.chatId, 'Usage: /pin <text to bookmark>');
        break;
      }
      const bookmarks = await loadBookmarks(ctx.config, ctx.chatId);
      const nextId = bookmarks.length > 0 ? Math.max(...bookmarks.map((b) => b.id)) + 1 : 1;
      bookmarks.push({ id: nextId, text: pinText, createdAt: new Date().toISOString() });
      await saveBookmarks(ctx.config, ctx.chatId, bookmarks);
      await ctx.sendMessage(ctx.chatId, `Bookmarked (#${nextId}).`);
      break;
    }
    case '/pins': {
      const bookmarks = await loadBookmarks(ctx.config, ctx.chatId);
      if (bookmarks.length === 0) {
        await ctx.sendMessage(ctx.chatId, 'No bookmarks saved. Use /pin <text> to add one.');
        break;
      }
      const lines = bookmarks.map((b) => {
        const date = new Date(b.createdAt).toLocaleDateString();
        return `#${b.id} [${date}] ${b.text}`;
      });
      await ctx.sendMessage(ctx.chatId, `Bookmarks:\n${lines.join('\n')}`);
      break;
    }
    case '/unpin': {
      const idStr = text.slice(text.indexOf(' ') + 1).trim();
      const unpinId = parseInt(idStr, 10);
      if (isNaN(unpinId)) {
        await ctx.sendMessage(ctx.chatId, 'Usage: /unpin <bookmark-number>');
        break;
      }
      const bookmarks = await loadBookmarks(ctx.config, ctx.chatId);
      const idx = bookmarks.findIndex((b) => b.id === unpinId);
      if (idx === -1) {
        await ctx.sendMessage(ctx.chatId, `Bookmark #${unpinId} not found.`);
        break;
      }
      bookmarks.splice(idx, 1);
      await saveBookmarks(ctx.config, ctx.chatId, bookmarks);
      await ctx.sendMessage(ctx.chatId, `Bookmark #${unpinId} removed.`);
      break;
    }
    default:
      await ctx.sendMessage(ctx.chatId, `Unknown command: ${cmd}\nType /help for available commands.`);
  }
}

function getWelcomeMessage(config: GatewayRuntimeConfig): string {
  const name = config.systemPrompt ? 'MoltBot' : 'OpenClaw Bot';
  const lines = [
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
    '',
    'Bookmarks:',
    '/pin <text> - Save a bookmark',
    '/pins       - List bookmarks',
    '/unpin <#>  - Remove a bookmark',
    '/briefing   - Get a daily summary now',
  ];
  if (config.autonomous?.enabled) {
    lines.push(
      '',
      'Autonomous:',
      '/auto <goal>   - Start autonomous task',
      '/auto_status   - Show active tasks',
      '/kill [taskId] - Emergency stop',
      '/auto_resume   - Re-enable after kill',
    );
  }
  if (config.personas?.enabled) {
    lines.push(
      '',
      'Personas & Voice:',
      '/persona <id>  - Switch persona',
      '/personas      - List all personas',
      '/voice         - Toggle voice reply mode',
    );
  }
  return lines.join('\n');
}

function getHelpMessage(): string {
  return [
    'Available commands:',
    '',
    '/start        - Welcome message',
    '/help         - This help text',
    '/reset        - Clear conversation history',
    '/info         - Show system info',
    '/approve      - Approve a pending action',
    '/deny         - Deny a pending action',
    '/pending      - Show pending approval',
    '',
    'Autonomous:',
    '/auto <goal>  - Start autonomous task',
    '/auto_status  - Show active tasks',
    '/tasks        - Show active tasks',
    '/kill [id]    - Emergency stop (all or one)',
    '/auto_resume  - Re-enable after kill switch',
    '',
    'Bookmarks:',
    '/pin <text>   - Save a bookmark',
    '/pins         - List bookmarks',
    '/unpin <#>    - Remove a bookmark',
    '/briefing     - Daily summary on demand',
    '',
    'Personas & Voice:',
    '/persona <id>  - Switch persona',
    '/personas      - List all personas',
    '/voice         - Toggle voice reply mode',
    '',
    'Just type a message to chat!',
    'In groups, @mention me or reply to my messages.',
  ].join('\n');
}

function getInfoMessage(ctx: CommandContext): string {
  const conv = ctx.sessions.getConversation(`telegram:${ctx.chatId}`);
  const msgCount = conv?.messages.length ?? 0;
  const routingMode = ctx.config.routing?.mode ?? 'single';
  const localModel = ctx.config.ollama?.model ?? 'none';
  const cloudProviders: string[] = [];
  if (ctx.config.anthropicApiKey) cloudProviders.push('Anthropic');
  if (ctx.config.openaiApiKey) cloudProviders.push('OpenAI');
  const cloudConfigured = cloudProviders.length > 0 ? cloudProviders.join(', ') : 'none';

  return [
    'System Info:',
    `  Routing: ${routingMode}`,
    `  Local model: ${localModel}`,
    `  Cloud API: ${cloudConfigured}`,
    `  Messages in context: ${msgCount}`,
  ].join('\n');
}
