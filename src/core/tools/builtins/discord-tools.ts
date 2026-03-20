// ============================================================
// OpenClaw Deploy — Discord Server Management Tools
// ============================================================
//
// Provides the LLM with Discord server management capabilities:
// create forum posts, channels, send messages to channels, list channels.
// ============================================================

import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';
import type { DiscordBot } from '../../channels/discord/bot.js';

// Module-level reference set by server.ts at startup
let discordBot: DiscordBot | null = null;

export function setDiscordBot(bot: DiscordBot): void {
  discordBot = bot;
}

export function getDiscordBot(): DiscordBot | null {
  return discordBot;
}

function ensureBot(): DiscordBot {
  if (!discordBot || !discordBot.isReady()) {
    throw new Error('Discord bot is not connected. Check discord configuration.');
  }
  return discordBot;
}

// ── discord_create_forum_post ──────────────────────────────

export const discordCreateForumPostDefinition: ToolDefinition = {
  name: 'discord_create_forum_post',
  description:
    'Create a new forum post (thread) in a Discord forum channel. ' +
    'Use this to start a new topic or discussion. Returns the thread ID and URL.',
  parameters: {
    type: 'object',
    properties: {
      channel_id: {
        type: 'string',
        description: 'The forum channel ID to create the post in. Use discord_list_channels to find forum channels.',
      },
      title: {
        type: 'string',
        description: 'The title of the forum post (thread name). Max 100 characters.',
      },
      content: {
        type: 'string',
        description: 'The initial message content of the forum post. Supports Discord markdown.',
      },
    },
    required: ['channel_id', 'title', 'content'],
  },
  routing: { useWhen: ['create a forum post', 'start a discussion', 'new topic', 'create a thread'] },
  categories: ['media'],
};

export const discordCreateForumPostHandler: ToolHandler = async (input) => {
  const bot = ensureBot();
  const channelId = String(input.channel_id);
  const title = String(input.title).slice(0, 100);
  const content = String(input.content);

  if (!title) throw new Error('title is required');
  if (!content) throw new Error('content is required');

  const result = await bot.createForumPost(channelId, title, content);
  return `Forum post created: "${title}"\nThread ID: ${result.threadId}\nURL: ${result.url}`;
};

// ── discord_create_channel ──────────────────────────────────

export const discordCreateChannelDefinition: ToolDefinition = {
  name: 'discord_create_channel',
  description:
    'Create a new channel in the Discord server. Supports text channels and forum channels. ' +
    'Forum channels allow users to create individual posts/threads for separate conversations.',
  parameters: {
    type: 'object',
    properties: {
      guild_id: {
        type: 'string',
        description: 'The server (guild) ID. Use discord_list_channels to see available servers.',
      },
      name: {
        type: 'string',
        description: 'Channel name (lowercase, hyphens for spaces, e.g., "code-help").',
      },
      type: {
        type: 'string',
        enum: ['text', 'forum'],
        description: 'Channel type: "text" for regular chat, "forum" for threaded discussions.',
      },
      topic: {
        type: 'string',
        description: 'Channel description/topic shown at the top.',
      },
      category_id: {
        type: 'string',
        description: 'Optional category (parent) ID to place the channel under.',
      },
    },
    required: ['guild_id', 'name', 'type'],
  },
  routing: { useWhen: ['create a channel', 'create a forum', 'add a channel', 'new channel'] },
  categories: ['media'],
};

export const discordCreateChannelHandler: ToolHandler = async (input) => {
  const bot = ensureBot();
  const guildId = String(input.guild_id);
  const name = String(input.name).toLowerCase().replace(/\s+/g, '-').slice(0, 100);
  const type = String(input.type) as 'text' | 'forum';
  const topic = input.topic ? String(input.topic) : undefined;
  const categoryId = input.category_id ? String(input.category_id) : undefined;

  if (!['text', 'forum'].includes(type)) throw new Error('type must be "text" or "forum"');

  const result = await bot.createChannel(guildId, name, type, topic, categoryId);
  return `Channel created: #${name} (${type})\nChannel ID: ${result.channelId}\nURL: ${result.url}`;
};

// ── discord_send_channel_message ────────────────────────────

export const discordSendMessageDefinition: ToolDefinition = {
  name: 'discord_send_message',
  description:
    'Send a message to a specific Discord channel or thread. ' +
    'Use this to post announcements, updates, or start conversations in specific channels.',
  parameters: {
    type: 'object',
    properties: {
      channel_id: {
        type: 'string',
        description: 'The channel or thread ID to send the message to.',
      },
      content: {
        type: 'string',
        description: 'The message content. Supports Discord markdown.',
      },
    },
    required: ['channel_id', 'content'],
  },
  routing: { useWhen: ['send a message to', 'post in channel', 'announce'] },
  categories: ['media'],
};

export const discordSendMessageHandler: ToolHandler = async (input) => {
  const bot = ensureBot();
  const channelId = String(input.channel_id);
  const content = String(input.content);

  if (!content) throw new Error('content is required');

  await bot.sendMessage(channelId, content);
  return `Message sent to channel ${channelId}.`;
};

// ── discord_list_channels ───────────────────────────────────

export const discordListChannelsDefinition: ToolDefinition = {
  name: 'discord_list_channels',
  description:
    'List all channels in a Discord server. Shows channel names, IDs, types (text/forum/voice/category), ' +
    'and parent categories. Use this to find channel IDs for other Discord tools.',
  parameters: {
    type: 'object',
    properties: {
      guild_id: {
        type: 'string',
        description: 'The server (guild) ID. If omitted, lists channels from the first available server.',
      },
    },
    required: [],
  },
  routing: { useWhen: ['list channels', 'show channels', 'what channels', 'server channels'] },
  categories: ['media'],
};

export const discordListChannelsHandler: ToolHandler = async (input) => {
  const bot = ensureBot();
  const guildId = input.guild_id ? String(input.guild_id) : undefined;

  const channels = await bot.listChannels(guildId);
  if (channels.length === 0) return 'No channels found (or bot is not in any servers).';

  const lines = channels.map((ch) => {
    const indent = ch.parentName ? '  ' : '';
    const typeLabel = ch.type === 'category' ? `[CATEGORY]` : `(${ch.type})`;
    return `${indent}${typeLabel} #${ch.name} — ID: ${ch.id}${ch.topic ? ` — ${ch.topic}` : ''}`;
  });

  return `**Server: ${channels[0].guildName}** (ID: ${channels[0].guildId})\n\n${lines.join('\n')}`;
};

// ── discord_read_messages ─────────────────────────────────

export const discordReadMessagesDefinition: ToolDefinition = {
  name: 'discord_read_messages',
  description:
    'Read recent messages from a Discord channel or thread. Returns messages with author, content, ' +
    'timestamp, and attachment count. Use discord_list_channels to find channel IDs first.',
  parameters: {
    type: 'object',
    properties: {
      channel_id: {
        type: 'string',
        description: 'The channel or thread ID to read messages from.',
      },
      limit: {
        type: 'number',
        description: 'Number of messages to fetch (1-50, default 25).',
      },
    },
    required: ['channel_id'],
  },
  routing: { useWhen: ['read discord', 'check discord', 'discord messages', 'what was said in'] },
  categories: ['media'],
};

export const discordReadMessagesHandler: ToolHandler = async (input) => {
  const bot = ensureBot();
  const channelId = String(input.channel_id);
  const limit = input.limit ? Math.max(1, Math.min(50, Number(input.limit))) : 25;

  const messages = await bot.readMessages(channelId, limit);
  if (messages.length === 0) return 'No messages found in this channel.';

  const lines = messages.map((m) => {
    const attach = m.attachments > 0 ? ` [${m.attachments} attachment(s)]` : '';
    const time = m.timestamp.replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
    return `[${time}] **${m.author}**: ${m.content}${attach}`;
  });

  return `**${messages.length} message(s):**\n\n${lines.join('\n')}`;
};
