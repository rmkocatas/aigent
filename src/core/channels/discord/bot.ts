// ============================================================
// OpenClaw Deploy — Discord Bot (WebSocket Gateway)
// ============================================================

import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  ChannelType,
  AttachmentBuilder,
  type Message,
  type Interaction,
  type TextChannel,
  type ThreadChannel,
  type DMChannel,
  type ForumChannel,
  type Guild,
} from 'discord.js';
import type { GatewayRuntimeConfig, GeneratedImage, GeneratedFile } from '../../../types/index.js';
import type { SessionStore } from '../../gateway/session-store.js';
import type { TrainingDataStore } from '../../training/data-collector.js';
import type { ToolRegistry } from '../../tools/registry.js';
import type { ApprovalManager } from '../../services/approval-manager.js';
import type { SkillLoader } from '../../services/skill-loader.js';
import type { AutonomousTaskExecutor } from '../../services/autonomous/task-executor.js';
import { processChatMessage } from '../../gateway/chat-pipeline.js';
import { registerSlashCommands, handleSlashCommand, handleTextCommand } from './commands.js';
import { splitMessage, buildEmbed } from './formatter.js';
import { DiscordStreamingEditor } from './streaming-editor.js';
import { downloadDiscordAttachment } from './file-handler.js';

// ---------------------------------------------------------------------------
// Typing indicator with TTL guardrail
// ---------------------------------------------------------------------------

function createTypingIndicator(
  action: () => void,
  intervalMs: number,
  maxDurationMs = 5 * 60_000,
): { clear: () => void } {
  action(); // fire immediately
  const interval = setInterval(action, intervalMs);
  const timeout = setTimeout(() => clearInterval(interval), maxDurationMs);
  return {
    clear() {
      clearInterval(interval);
      clearTimeout(timeout);
    },
  };
}
import { transcribeAudio } from '../telegram/speech-to-text.js';
import { extractTextFromDocument } from '../telegram/document-handler.js';
import { redactSensitive } from '../../services/log-redactor.js';

// ---------------------------------------------------------------------------
// Deduplication cache — prevents replay on reconnect
// ---------------------------------------------------------------------------

class DedupeCache {
  private readonly cache = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly maxSize: number;

  constructor(ttlMs = 5 * 60_000, maxSize = 2000) {
    this.ttlMs = ttlMs;
    this.maxSize = maxSize;
  }

  seen(key: string): boolean {
    const now = Date.now();
    if (this.cache.size >= this.maxSize) {
      for (const [k, ts] of this.cache) {
        if (now - ts > this.ttlMs) this.cache.delete(k);
      }
    }
    if (this.cache.has(key)) {
      const ts = this.cache.get(key)!;
      if (now - ts < this.ttlMs) return true;
    }
    this.cache.set(key, now);
    return false;
  }
}

// ---------------------------------------------------------------------------
// DiscordBot
// ---------------------------------------------------------------------------

export interface DiscordBotConfig {
  token: string;
  appId: string;
}

export interface DiscordBotDeps {
  config: GatewayRuntimeConfig;
  sessions: SessionStore;
  trainingStore: TrainingDataStore | null;
  toolRegistry?: ToolRegistry;
  approvalManager?: ApprovalManager;
  skillLoader?: SkillLoader;
  memoryEngine?: import('../../services/memory/memory-engine.js').MemoryEngine;
  strategyEngine?: import('../../services/strategies/strategy-engine.js').StrategyEngine;
  costTracker?: import('../../services/cost-tracker.js').CostTracker;
  responseCache?: import('../../gateway/response-cache.js').ResponseCache;
  pipelineHooks?: import('../../services/pipeline-hooks.js').PipelineHooks;
  personaManager?: import('../../services/persona-manager.js').PersonaManager;
}

export class DiscordBot {
  private client: Client;
  private autonomousExecutor: AutonomousTaskExecutor | null = null;
  private readonly dedupe = new DedupeCache();
  private ready = false;

  constructor(
    private readonly botConfig: DiscordBotConfig,
    private readonly deps: DiscordBotDeps,
  ) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
      ],
      partials: [Partials.Channel, Partials.Message],
    });
  }

  // ---------------------------------------------------------------------------
  // Setters
  // ---------------------------------------------------------------------------

  setAutonomousExecutor(executor: AutonomousTaskExecutor): void {
    this.autonomousExecutor = executor;
  }

  isReady(): boolean {
    return this.ready;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async start(): Promise<void> {
    const { config } = this.deps;
    const allowedGuilds = config.discordAllowedGuilds;
    if (!allowedGuilds || allowedGuilds.length === 0) {
      console.warn(
        '\n  [SECURITY WARNING] Discord bot has no allowedGuilds configured.\n' +
        '  The bot will respond in any server it is added to.\n' +
        '  Set discord.allowedGuilds in openclaw.json to restrict access.\n',
      );
    }

    // Register event handlers
    this.client.on(Events.ClientReady, async (client) => {
      this.ready = true;
      console.log(`[discord] Connected as ${client.user.tag}`);

      // Register slash commands (treat failures as recoverable — don't crash startup)
      try {
        await registerSlashCommands(this.botConfig.token, this.botConfig.appId);
      } catch (err) {
        console.error('[discord] Failed to register slash commands (non-fatal):', redactSensitive((err as Error).message));
      }
    });

    this.client.on(Events.ThreadCreate, async (thread, newlyCreated) => {
      if (!newlyCreated) return;
      this.handleNewThread(thread as ThreadChannel).catch((err) => {
        console.error('[discord] Error handling new thread:', redactSensitive((err as Error).message));
      });
    });

    this.client.on(Events.MessageCreate, (message) => {
      this.handleMessage(message).catch((err) => {
        console.error('[discord] Error handling message:', redactSensitive((err as Error).message));
      });
    });

    this.client.on(Events.InteractionCreate, (interaction) => {
      this.handleInteraction(interaction).catch((err) => {
        console.error('[discord] Error handling interaction:', redactSensitive((err as Error).message));
      });
    });

    this.client.on(Events.Error, (error) => {
      console.error('[discord] Client error:', redactSensitive(error.message));
    });

    // Login
    await this.client.login(this.botConfig.token);
  }

  async stop(): Promise<void> {
    this.ready = false;
    this.client.destroy();
    console.log('[discord] Disconnected');
  }

  // ---------------------------------------------------------------------------
  // Guild access control
  // ---------------------------------------------------------------------------

  private isGuildAllowed(guildId: string | null): boolean {
    if (!guildId) return true; // DMs are always allowed
    const allowed = this.deps.config.discordAllowedGuilds;
    if (!allowed || allowed.length === 0) return true; // Empty = allow all
    return allowed.includes(guildId);
  }

  // ---------------------------------------------------------------------------
  // Conversation key mapping
  // ---------------------------------------------------------------------------

  private getConversationKey(message: Message): string {
    // DMs
    if (!message.guild) {
      return `discord:dm:${message.author.id}`;
    }
    // Thread (forum post or text channel thread)
    if (message.channel.isThread()) {
      return `discord:${message.guild.id}:${message.channel.id}`;
    }
    // Regular text channel
    return `discord:${message.guild.id}:${message.channel.id}`;
  }

  // ---------------------------------------------------------------------------
  // New forum thread handler
  // ---------------------------------------------------------------------------

  private async handleNewThread(thread: ThreadChannel): Promise<void> {
    // Only handle forum channel threads
    if (thread.parent?.type !== ChannelType.GuildForum) return;

    // Guild access check
    if (!this.isGuildAllowed(thread.guild?.id ?? null)) return;

    // Join the thread
    if (thread.joinable) {
      await thread.join();
    }

    // Apply auto-archive duration from config (v2026.3.11)
    const archiveDuration = this.deps.config.discordAutoArchiveDuration;
    if (archiveDuration && thread.autoArchiveDuration !== archiveDuration) {
      try {
        await thread.setAutoArchiveDuration(archiveDuration);
      } catch {
        // May lack Manage Threads permission — non-fatal
      }
    }

    // Fetch the starter message
    let starterMessage: Message | null = null;
    try {
      starterMessage = await thread.fetchStarterMessage();
    } catch {
      // Starter message may not be available
      return;
    }
    if (!starterMessage || starterMessage.author.bot) return;

    // Process the starter message
    const text = starterMessage.content?.trim();
    if (!text) return;

    const conversationKey = `discord:${thread.guild.id}:${thread.id}`;
    await this.processAndReply(starterMessage, text, conversationKey);
  }

  // ---------------------------------------------------------------------------
  // Message handler
  // ---------------------------------------------------------------------------

  private async handleMessage(message: Message): Promise<void> {
    // Skip bot messages
    if (message.author.bot) return;

    // Dedup check
    if (this.dedupe.seen(`msg:${message.id}`)) return;

    // Guild access check
    if (!this.isGuildAllowed(message.guild?.id ?? null)) return;

    const conversationKey = this.getConversationKey(message);
    const isDM = !message.guild;
    const isThread = message.channel.isThread();
    const isForumThread = isThread && (message.channel as ThreadChannel).parent?.type === ChannelType.GuildForum;

    // Determine if we should respond
    const autoRespond = this.deps.config.discordAutoRespond;
    const isMentioned = message.mentions.has(this.client.user!, { ignoreRepliedUser: true });
    const isReplyToBot = message.reference?.messageId
      ? await this.isReplyToBot(message)
      : false;

    const shouldRespond = isDM || isForumThread || isThread || isMentioned || isReplyToBot || autoRespond;
    if (!shouldRespond) return;

    // Extract text content
    let text = message.content?.trim() ?? '';

    // Strip bot mention from message
    if (this.client.user) {
      text = text.replace(new RegExp(`<@!?${this.client.user.id}>`, 'g'), '').trim();
    }

    // Handle text commands (! prefix)
    const commandCtx = {
      conversationId: conversationKey,
      channelId: message.channel.id,
      userId: message.author.id,
      config: this.deps.config,
      sessions: this.deps.sessions,
      sendReply: async (reply: string) => { await message.reply(reply); },
      approvalManager: this.deps.approvalManager,
      autonomousExecutor: this.autonomousExecutor ?? undefined,
    };

    const wasCommand = await handleTextCommand(text, commandCtx);
    if (wasCommand) return;

    // Handle attachments
    const images: Array<{ base64: string; mediaType: string }> = [];
    let documentText: string | undefined;
    let isVoiceInput = false;

    for (const attachment of message.attachments.values()) {
      const contentType = attachment.contentType ?? '';

      if (contentType.startsWith('image/')) {
        // Image attachment
        try {
          const downloaded = await downloadDiscordAttachment(attachment.url);
          images.push({
            base64: downloaded.buffer.toString('base64'),
            mediaType: downloaded.mimeType,
          });
        } catch (err) {
          console.error('[discord] Failed to download image:', (err as Error).message);
        }
      } else if (contentType.startsWith('audio/')) {
        // Voice message / audio attachment
        try {
          const downloaded = await downloadDiscordAttachment(attachment.url);
          const config = this.deps.config;
          if (config.whisperApiKey) {
            const transcription = await transcribeAudio(
              downloaded.buffer,
              downloaded.filename,
              config.whisperApiKey,
              config.whisperApiUrl,
              config.whisperModel,
              config.whisperProvider,
            );
            if (transcription) {
              text = transcription;
              isVoiceInput = true;
            }
          }
        } catch (err) {
          console.error('[discord] Failed to transcribe audio:', (err as Error).message);
        }
      } else if (
        contentType === 'application/pdf' ||
        contentType.includes('text/') ||
        attachment.name?.endsWith('.pdf') ||
        attachment.name?.endsWith('.txt') ||
        attachment.name?.endsWith('.md')
      ) {
        // Document attachment
        try {
          const downloaded = await downloadDiscordAttachment(attachment.url);
          const extracted = await extractTextFromDocument(
            downloaded.buffer,
            downloaded.filename,
            downloaded.mimeType,
          );
          if (extracted) {
            documentText = extracted;
          }
        } catch (err) {
          console.error('[discord] Failed to extract document text:', (err as Error).message);
        }
      }
    }

    // Skip if no text content and no attachments
    if (!text && images.length === 0 && !documentText && !isVoiceInput) return;

    await this.processAndReply(message, text, conversationKey, images, documentText, isVoiceInput);
  }

  // ---------------------------------------------------------------------------
  // Core pipeline call
  // ---------------------------------------------------------------------------

  private async processAndReply(
    message: Message,
    text: string,
    conversationKey: string,
    images?: Array<{ base64: string; mediaType: string }>,
    documentText?: string,
    isVoiceInput?: boolean,
  ): Promise<void> {
    // Add processing reaction
    try {
      await message.react('\u23f3'); // hourglass
    } catch {
      // May lack permission to react
    }

    // Typing indicator — refresh every 8s (Discord typing lasts 10s), auto-expires after 5 min
    const typing = createTypingIndicator(
      () => { (message.channel as TextChannel | ThreadChannel).sendTyping?.().catch(() => {}); },
      8000,
    );

    // Stream response progressively via editing a single Discord reply
    const streamingConfig = this.deps.config.discordStreaming;
    const editor = streamingConfig.enabled
      ? new DiscordStreamingEditor(message, {
          throttleMs: streamingConfig.throttleMs,
          minCharsBeforeFirstSend: streamingConfig.minCharsBeforeFirstSend,
          minCharsBeforeEdit: streamingConfig.minCharsBeforeEdit,
        })
      : null;

    try {
      const result = await processChatMessage(
        {
          message: text || '(attachment)',
          conversationId: conversationKey,
          source: 'discord',
          ...(images && images.length > 0 ? { images } : {}),
          ...(documentText ? { documentText } : {}),
          ...(isVoiceInput ? { isVoiceInput } : {}),
        },
        this.deps,
        editor
          ? {
              onChunk: (chunk: string) => {
                editor.addChunk(chunk).catch(() => {});
              },
              onToolUse: (tool: string) => {
                editor.setToolStatus(tool);
              },
              onToolResult: () => {
                editor.setToolStatus(null);
              },
            }
          : undefined,
      );

      typing.clear();
      if (editor) await editor.finalize();

      const fullResponse = result.response ?? '';
      const sentMessage = editor?.getSentMessage() ?? null;

      // Build image attachments
      const imageAttachments: AttachmentBuilder[] = [];
      if (result.generatedImages && result.generatedImages.length > 0) {
        for (const image of result.generatedImages) {
          try {
            let buffer: Buffer;
            if (image.type === 'url') {
              const res = await fetch(image.data, { signal: AbortSignal.timeout(30_000) });
              if (!res.ok) {
                console.error(`[discord] Failed to fetch image URL: HTTP ${res.status}`);
                continue;
              }
              buffer = Buffer.from(await res.arrayBuffer());
            } else {
              buffer = Buffer.from(image.data, 'base64');
            }
            if (buffer.length < 100) {
              console.error(`[discord] Image buffer too small (${buffer.length} bytes), skipping`);
              continue;
            }
            imageAttachments.push(
              new AttachmentBuilder(buffer, {
                name: `image.${image.mimeType?.split('/')[1] ?? 'png'}`,
              }),
            );
          } catch (err) {
            console.error('[discord] Failed to prepare image attachment:', (err as Error).message);
          }
        }
      }

      // Handle long responses: streaming capped at 2000, overflow needs follow-ups
      if (fullResponse.length > 2000) {
        // Replace the streamed message with an embed (supports 4096 chars)
        if (sentMessage) {
          try {
            if (fullResponse.length <= 4096) {
              const embed = buildEmbed('', fullResponse);
              await sentMessage.edit({ content: '', embeds: [embed], ...(imageAttachments.length > 0 ? { files: imageAttachments } : {}) });
            } else {
              const embed = buildEmbed('', fullResponse.slice(0, 4000));
              await sentMessage.edit({ content: '', embeds: [embed], ...(imageAttachments.length > 0 ? { files: imageAttachments } : {}) });
              const chunks = splitMessage(fullResponse.slice(4000));
              for (const chunk of chunks) {
                await message.channel.send(chunk);
              }
            }
          } catch {
            // Edit failed — send as new messages
            const chunks = splitMessage(fullResponse);
            for (const chunk of chunks) {
              await message.channel.send(chunk);
            }
          }
        } else {
          // No streamed message exists — send fresh
          if (fullResponse.length <= 4096) {
            const embed = buildEmbed('', fullResponse);
            await message.reply({ embeds: [embed], ...(imageAttachments.length > 0 ? { files: imageAttachments } : {}) });
          } else {
            const embed = buildEmbed('', fullResponse.slice(0, 4000));
            await message.reply({ embeds: [embed], ...(imageAttachments.length > 0 ? { files: imageAttachments } : {}) });
            const chunks = splitMessage(fullResponse.slice(4000));
            for (const chunk of chunks) {
              await message.channel.send(chunk);
            }
          }
        }
      } else if (imageAttachments.length > 0) {
        // Short response with images — attach images to the streamed message or send new
        if (sentMessage) {
          try {
            await sentMessage.edit({ content: fullResponse || undefined, files: imageAttachments });
          } catch {
            await message.channel.send({ files: imageAttachments });
          }
        } else {
          await message.reply({ content: fullResponse || undefined, files: imageAttachments });
        }
      } else if (!sentMessage && fullResponse) {
        // Streaming never sent a message (edge case) — send the response
        await message.reply(fullResponse);
      }

      // Send generated files as separate messages (PDFs, audio, etc.)
      if (result.generatedFiles && result.generatedFiles.length > 0) {
        await this.sendGeneratedFilesToChannel(message.channel as TextChannel | ThreadChannel | DMChannel, result.generatedFiles);
      }

      // Remove processing reaction
      try {
        const botReaction = message.reactions.cache.get('\u23f3');
        if (botReaction && this.client.user) {
          await botReaction.users.remove(this.client.user.id);
        }
      } catch {
        // Reaction may already be removed
      }
    } catch (err) {
      typing.clear();
      if (editor) await editor.finalize();
      // Add error reaction
      try {
        const botReaction = message.reactions.cache.get('\u23f3');
        if (botReaction && this.client.user) {
          await botReaction.users.remove(this.client.user.id);
        }
        await message.react('\u274c'); // red X
      } catch {
        // Ignore reaction errors
      }
      const rawMsg = err instanceof Error ? err.message : 'An error occurred';
      console.error('[discord] Message handler error:', rawMsg);
      const errMsg = redactSensitive(rawMsg);
      await message.reply(`Error: ${errMsg}`).catch(() => {});
    }
  }

  // ---------------------------------------------------------------------------
  // Interaction handler (slash commands)
  // ---------------------------------------------------------------------------

  private async handleInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isChatInputCommand()) return;

    const conversationKey = interaction.guild
      ? interaction.channel?.isThread()
        ? `discord:${interaction.guild.id}:${interaction.channel.id}`
        : `discord:${interaction.guild.id}:${interaction.channelId}`
      : `discord:dm:${interaction.user.id}`;

    await handleSlashCommand(interaction, {
      conversationId: conversationKey,
      channelId: interaction.channelId,
      userId: interaction.user.id,
      config: this.deps.config,
      sessions: this.deps.sessions,
      sendReply: async (text: string) => {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(text);
        } else {
          await interaction.reply(text);
        }
      },
      approvalManager: this.deps.approvalManager,
      autonomousExecutor: this.autonomousExecutor ?? undefined,
    });
  }

  // ---------------------------------------------------------------------------
  // Utility: check if message is a reply to the bot
  // ---------------------------------------------------------------------------

  private async isReplyToBot(message: Message): Promise<boolean> {
    if (!message.reference?.messageId) return false;
    try {
      const referenced = await message.channel.messages.fetch(message.reference.messageId);
      return referenced.author.id === this.client.user?.id;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Public methods for other services (reminders, triggers, autonomous)
  // ---------------------------------------------------------------------------

  async sendMessage(channelId: string, text: string): Promise<void> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !('send' in channel)) {
      console.error(`[discord] Cannot send to channel ${channelId} — not a text channel`);
      return;
    }
    const textChannel = channel as TextChannel;
    if (text.length <= 2000) {
      await textChannel.send(text);
    } else if (text.length <= 4096) {
      await textChannel.send({ embeds: [buildEmbed('', text)] });
    } else {
      await textChannel.send({ embeds: [buildEmbed('', text.slice(0, 4000))] });
      const chunks = splitMessage(text.slice(4000));
      for (const chunk of chunks) {
        await textChannel.send(chunk);
      }
    }
  }

  async readMessages(channelId: string, limit = 25): Promise<Array<{
    id: string;
    author: string;
    content: string;
    timestamp: string;
    attachments: number;
  }>> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !('messages' in channel)) {
      throw new Error(`Channel ${channelId} not found or not a text-based channel.`);
    }
    const textChannel = channel as TextChannel | ThreadChannel | DMChannel;
    const messages = await textChannel.messages.fetch({ limit: Math.min(limit, 50) });
    return [...messages.values()].reverse().map((m) => ({
      id: m.id,
      author: m.author?.tag ?? 'unknown',
      content: m.content || (m.embeds.length > 0 ? `[embed: ${m.embeds[0].title ?? m.embeds[0].description?.slice(0, 100) ?? 'no title'}]` : '[no content]'),
      timestamp: m.createdAt.toISOString(),
      attachments: m.attachments.size,
    }));
  }

  async sendFiles(channelId: string, files: GeneratedFile[]): Promise<void> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !('send' in channel)) {
      console.error(`[discord] Cannot send files to channel ${channelId} — channel not found or not sendable`);
      return;
    }
    await this.sendGeneratedFilesToChannel(channel as TextChannel | ThreadChannel | DMChannel, files);
  }

  // ---------------------------------------------------------------------------
  // File sending helpers
  // ---------------------------------------------------------------------------

  private async sendGeneratedImages(
    channel: TextChannel | ThreadChannel | DMChannel,
    images: GeneratedImage[],
  ): Promise<void> {
    for (const image of images) {
      try {
        if (image.type === 'url') {
          // Send URL-based images by downloading first
          const res = await fetch(image.data, { signal: AbortSignal.timeout(30_000) });
          if (!res.ok) {
            console.error(`[discord] Failed to fetch image URL: HTTP ${res.status}`);
            continue;
          }
          const buffer = Buffer.from(await res.arrayBuffer());
          const attachment = new AttachmentBuilder(buffer, {
            name: `image.${image.mimeType?.split('/')[1] ?? 'png'}`,
          });
          await channel.send({ files: [attachment] });
        } else {
          // Base64-encoded image
          const buffer = Buffer.from(image.data, 'base64');
          const attachment = new AttachmentBuilder(buffer, {
            name: `image.${image.mimeType?.split('/')[1] ?? 'png'}`,
          });
          await channel.send({ files: [attachment] });
        }
      } catch (err) {
        console.error('[discord] Failed to send image:', (err as Error).message);
      }
    }
  }

  private async sendGeneratedFilesToChannel(
    channel: TextChannel | ThreadChannel | DMChannel,
    files: GeneratedFile[],
  ): Promise<void> {
    // Discord upload limit: 25 MB for non-boosted servers
    const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

    for (const file of files) {
      try {
        // GeneratedFile.data is already a Buffer
        const buffer = Buffer.isBuffer(file.data)
          ? file.data
          : Buffer.from(file.data as unknown as string, 'base64');

        if (buffer.length > MAX_UPLOAD_BYTES) {
          const sizeMB = (buffer.length / 1024 / 1024).toFixed(1);
          console.error(`[discord] File too large for Discord: ${file.filename} (${sizeMB} MB > 25 MB limit)`);
          await channel.send(`The generated file **${file.filename}** (${sizeMB} MB) exceeds Discord's 25 MB upload limit.`);
          continue;
        }

        const attachment = new AttachmentBuilder(buffer, {
          name: file.filename,
        });
        await channel.send({
          content: file.caption ?? file.filename,
          files: [attachment],
        });
      } catch (err) {
        const errMsg = redactSensitive((err as Error).message);
        console.error(`[discord] Failed to send file "${file.filename}":`, errMsg);
        // Surface the error to the user so they know what went wrong
        try {
          await channel.send(`Failed to send file **${file.filename}**: ${errMsg}`);
        } catch {
          // Can't even send the error message — permissions issue
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // DM channel creation (for autonomous/trigger delivery to Discord users)
  // ---------------------------------------------------------------------------

  async getDmChannelId(userId: string): Promise<string | null> {
    try {
      const user = await this.client.users.fetch(userId);
      const dm = await user.createDM();
      return dm.id;
    } catch (err) {
      console.error(`[discord] Failed to create DM channel for user ${userId}:`, (err as Error).message);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Server management (used by discord tools)
  // ---------------------------------------------------------------------------

  async createForumPost(
    channelId: string,
    title: string,
    content: string,
  ): Promise<{ threadId: string; url: string }> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildForum) {
      throw new Error(`Channel ${channelId} is not a forum channel.`);
    }
    const forum = channel as ForumChannel;
    const thread = await forum.threads.create({
      name: title,
      message: { content },
    });
    return {
      threadId: thread.id,
      url: `https://discord.com/channels/${forum.guild.id}/${thread.id}`,
    };
  }

  async createChannel(
    guildId: string,
    name: string,
    type: 'text' | 'forum',
    topic?: string,
    categoryId?: string,
  ): Promise<{ channelId: string; url: string }> {
    let guild: Guild;
    try {
      guild = this.client.guilds.cache.get(guildId) ?? await this.client.guilds.fetch(guildId);
    } catch (err) {
      throw new Error(`Failed to fetch server ${guildId}: ${redactSensitive((err as Error).message)}`);
    }
    if (!guild) throw new Error(`Server ${guildId} not found.`);

    const channelType = type === 'forum' ? ChannelType.GuildForum : ChannelType.GuildText;
    const channel = await guild.channels.create({
      name,
      type: channelType,
      ...(topic ? { topic } : {}),
      ...(categoryId ? { parent: categoryId } : {}),
    });

    return {
      channelId: channel.id,
      url: `https://discord.com/channels/${guildId}/${channel.id}`,
    };
  }

  async listChannels(
    guildId?: string,
  ): Promise<Array<{
    id: string;
    name: string;
    type: string;
    topic?: string;
    parentName?: string;
    guildId: string;
    guildName: string;
  }>> {
    let guild: Guild;
    if (guildId) {
      try {
        guild = this.client.guilds.cache.get(guildId) ?? await this.client.guilds.fetch(guildId);
      } catch (err) {
        console.error(`[discord] Failed to fetch guild ${guildId}:`, redactSensitive((err as Error).message));
        return [];
      }
    } else {
      const first = this.client.guilds.cache.first();
      if (!first) return [];
      guild = first;
    }

    const channels = await guild.channels.fetch();
    const result: Array<{
      id: string;
      name: string;
      type: string;
      topic?: string;
      parentName?: string;
      guildId: string;
      guildName: string;
    }> = [];

    // Categories first, then channels sorted by position
    const sorted = [...channels.values()]
      .filter((ch) => ch !== null)
      .sort((a, b) => (a!.rawPosition ?? 0) - (b!.rawPosition ?? 0));

    for (const ch of sorted) {
      if (!ch) continue;
      const typeMap: Record<number, string> = {
        [ChannelType.GuildText]: 'text',
        [ChannelType.GuildForum]: 'forum',
        [ChannelType.GuildVoice]: 'voice',
        [ChannelType.GuildCategory]: 'category',
        [ChannelType.GuildAnnouncement]: 'announcement',
        [ChannelType.GuildStageVoice]: 'stage',
      };
      result.push({
        id: ch.id,
        name: ch.name,
        type: typeMap[ch.type] ?? 'other',
        topic: 'topic' in ch ? (ch.topic ?? undefined) : undefined,
        parentName: ch.parent?.name ?? undefined,
        guildId: guild.id,
        guildName: guild.name,
      });
    }

    return result;
  }
}
