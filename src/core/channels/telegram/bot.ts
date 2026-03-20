// ============================================================
// OpenClaw Deploy — Telegram Bot (Long Polling)
// ============================================================

import type { GatewayRuntimeConfig, TelegramPhotoSize, TelegramVoice, TelegramDocument, GeneratedImage, GeneratedFile } from '../../../types/index.js';
import type { SessionStore } from '../../gateway/session-store.js';
import type { TrainingDataStore } from '../../training/data-collector.js';
import type { ToolRegistry } from '../../tools/registry.js';
import type { ApprovalManager } from '../../services/approval-manager.js';
import type { SkillLoader } from '../../services/skill-loader.js';
import { processChatMessage } from '../../gateway/chat-pipeline.js';
import { handleCommand } from './commands.js';
import { handleAutonomousCommand } from './autonomous-commands.js';
import { handlePersonaCommand } from './persona-commands.js';
import { generateSpeech } from '../../services/tts-provider.js';
import type { AutonomousTaskExecutor } from '../../services/autonomous/task-executor.js';
import { formatResponse, splitMessage, stripMarkdown } from './formatter.js';
import { TelegramStreamingEditor } from './streaming-editor.js';
import { downloadTelegramFile } from './file-downloader.js';
import { transcribeAudio } from './speech-to-text.js';
import { extractTextFromDocument } from './document-handler.js';
import type { DeliveryQueue } from './delivery-queue.js';
import { redactSensitive } from '../../services/log-redactor.js';

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

// ---------------------------------------------------------------------------
// Telegram API types (minimal)
// ---------------------------------------------------------------------------

interface TelegramMessage {
  message_id: number;
  from: { id: number; first_name: string; username?: string };
  chat: { id: number; type: 'private' | 'group' | 'supergroup' | 'channel' };
  text?: string;
  photo?: TelegramPhotoSize[];
  voice?: TelegramVoice;
  document?: TelegramDocument;
  caption?: string;
  date: number;
  message_thread_id?: number;
  is_topic_message?: boolean;
  reply_to_message?: { message_id: number; from?: { id: number } };
  entities?: Array<{ type: string; offset: number; length: number }>;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
  inline_query?: {
    id: string;
    from: { id: number; first_name: string; username?: string };
    query: string;
    offset: string;
  };
}

// ---------------------------------------------------------------------------
// Deduplication cache — prevents replay on crash/restart
// ---------------------------------------------------------------------------

class DedupeCache {
  private readonly cache = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly maxSize: number;

  constructor(ttlMs = 5 * 60_000, maxSize = 2000) {
    this.ttlMs = ttlMs;
    this.maxSize = maxSize;
  }

  /** Returns true if the key was already seen (duplicate). */
  seen(key: string): boolean {
    const now = Date.now();
    // Lazy evict expired entries when nearing capacity
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

function buildUpdateKey(update: TelegramUpdate): string | undefined {
  // Prefer Telegram's native update_id
  if (typeof update.update_id === 'number') {
    return `update:${update.update_id}`;
  }
  // Fallback: message-based key (handles channel_post too)
  const msg = update.message ?? update.channel_post;
  if (msg) {
    return `message:${msg.chat.id}:${msg.message_id}`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Topic target parsing — supports chatId:topic:threadId format
// ---------------------------------------------------------------------------

export interface TelegramTarget {
  chatId: string;
  messageThreadId?: number;
}

export function parseTelegramTarget(to: string): TelegramTarget {
  // Strip telegram: prefix if present
  const normalized = to.replace(/^telegram:/i, '');

  // Explicit topic marker: chatId:topic:threadId
  const topicMatch = /^(.+?):topic:(\d+)$/.exec(normalized);
  if (topicMatch) {
    return {
      chatId: topicMatch[1],
      messageThreadId: Number.parseInt(topicMatch[2], 10),
    };
  }

  return { chatId: normalized };
}

// ---------------------------------------------------------------------------
// TelegramBot
// ---------------------------------------------------------------------------

export interface TelegramBotConfig {
  token: string;
  pollingTimeoutSeconds: number;
}

export interface TelegramBotDeps {
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

export class TelegramBot {
  private running = false;
  private offset = 0;
  private abortController: AbortController | null = null;
  private readonly apiBase: string;
  private autonomousExecutor: AutonomousTaskExecutor | null = null;
  private deliveryQueue: DeliveryQueue | null = null;
  private botUsername = '';
  private readonly dedupe = new DedupeCache();

  constructor(
    private readonly botConfig: TelegramBotConfig,
    private readonly deps: TelegramBotDeps,
  ) {
    this.apiBase = `https://api.telegram.org/bot${botConfig.token}`;
  }

  setAutonomousExecutor(executor: AutonomousTaskExecutor): void {
    this.autonomousExecutor = executor;
  }

  setDeliveryQueue(queue: DeliveryQueue): void {
    this.deliveryQueue = queue;
  }

  async start(): Promise<void> {
    // Security warning for open bots
    const allowed = this.deps.config.telegramAllowedUsers;
    if (!allowed || allowed.length === 0) {
      console.warn(
        '\n  [SECURITY WARNING] Telegram bot has no allowedUsers configured.\n' +
        '  Any Telegram user can interact with your bot.\n' +
        '  Set telegram.allowedUsers in openclaw.json to restrict access.\n',
      );
    }

    // Fetch bot username for @mention detection in groups
    try {
      const me = (await this.callApi('getMe', {})) as { result?: { username?: string } };
      this.botUsername = (me.result?.username ?? '').toLowerCase();
      console.log(`[telegram] Bot username: @${this.botUsername}`);
    } catch {
      console.warn('[telegram] Could not fetch bot username — group @mention detection disabled');
    }

    // Replay pending messages from delivery queue (crash recovery)
    if (this.deliveryQueue) {
      try {
        const pending = await this.deliveryQueue.getPending();
        if (pending.length > 0) {
          console.log(`[telegram] Replaying ${pending.length} pending message(s) from delivery queue`);
          for (const msg of pending) {
            try {
              await this.callApi('sendMessage', {
                chat_id: msg.chatId,
                text: msg.text,
                ...(msg.parseMode ? { parse_mode: msg.parseMode } : {}),
              });
              await this.deliveryQueue.markDelivered(msg.id);
            } catch (err) {
              await this.deliveryQueue.markFailed(
                msg.id,
                (err as Error).message,
                msg.attempts + 1,
              );
            }
          }
        }
        await this.deliveryQueue.cleanup();
      } catch (err) {
        console.error('[telegram] Delivery queue replay failed:', redactSensitive((err as Error).message));
      }
    }

    this.running = true;
    this.pollLoop().catch(() => {});
  }

  async stop(): Promise<void> {
    this.running = false;
    this.abortController?.abort();
  }

  // Exposed for commands.ts
  async sendMessage(chatId: number, text: string, parseMode?: 'MarkdownV2'): Promise<void> {
    // Write-ahead: persist to queue before attempting delivery
    let queueId: string | undefined;
    if (this.deliveryQueue) {
      try {
        queueId = await this.deliveryQueue.enqueue(chatId, text, parseMode);
      } catch {
        // Queue write failed — still try to send directly
      }
    }

    try {
      await this.callApi('sendMessage', {
        chat_id: chatId,
        text,
        ...(parseMode ? { parse_mode: parseMode } : {}),
      });
      if (queueId && this.deliveryQueue) {
        this.deliveryQueue.markDelivered(queueId).catch(() => {});
      }
    } catch {
      // If MarkdownV2 fails, retry as plain text
      if (parseMode) {
        try {
          await this.callApi('sendMessage', {
            chat_id: chatId,
            text: stripMarkdown(text),
          });
          if (queueId && this.deliveryQueue) {
            this.deliveryQueue.markDelivered(queueId).catch(() => {});
          }
        } catch (err) {
          if (queueId && this.deliveryQueue) {
            this.deliveryQueue.markFailed(queueId, (err as Error).message, 1).catch(() => {});
          }
        }
      } else if (queueId && this.deliveryQueue) {
        this.deliveryQueue.markFailed(queueId, 'send failed', 1).catch(() => {});
      }
    }
  }

  // -----------------------------------------------------------------------
  // Polling
  // -----------------------------------------------------------------------

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const updates = await this.getUpdates();
        for (const update of updates) {
          this.offset = update.update_id + 1;
          // Fire-and-forget — don't block polling while a message processes.
          // This prevents a slow API call or tool execution from freezing
          // the entire bot (no new messages, no typing indicators).
          this.handleUpdate(update).catch((err) => {
            if (this.running) {
              console.error('[telegram] Update handling error:', redactSensitive((err as Error).message));
            }
          });
        }
      } catch (err) {
        if (!this.running) return;
        // Backoff on error
        await this.sleep(5000);
      }
    }
  }

  private async getUpdates(): Promise<TelegramUpdate[]> {
    this.abortController = new AbortController();
    const timeoutMs = (this.botConfig.pollingTimeoutSeconds + 5) * 1000;

    const res = await fetch(`${this.apiBase}/getUpdates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        offset: this.offset,
        timeout: this.botConfig.pollingTimeoutSeconds,
        allowed_updates: ['message', 'channel_post', 'inline_query'],
      }),
      signal: AbortSignal.any([
        this.abortController.signal,
        AbortSignal.timeout(timeoutMs),
      ]),
    });

    if (!res.ok) {
      throw new Error(`Telegram API error: ${res.status}`);
    }

    const data = (await res.json()) as { ok: boolean; result: TelegramUpdate[] };
    if (!data.ok) {
      throw new Error('Telegram API returned not ok');
    }

    return data.result;
  }

  // -----------------------------------------------------------------------
  // Message handling
  // -----------------------------------------------------------------------

  private isUserAllowed(userId: number): boolean {
    const allowed = this.deps.config.telegramAllowedUsers;
    // Empty or missing list = everyone allowed
    if (!allowed || allowed.length === 0) return true;
    return allowed.includes(userId);
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    // Deduplication — prevent replay on crash/restart or duplicate webhook delivery
    const dedupeKey = buildUpdateKey(update);
    if (dedupeKey && this.dedupe.seen(dedupeKey)) {
      return; // Already processed
    }

    // Handle inline queries (@bot <query> in any chat)
    if (update.inline_query) {
      await this.handleInlineQuery(update.inline_query);
      return;
    }

    // Unify message and channel_post into a single pipeline
    const message = update.message ?? update.channel_post;
    if (!message) return;

    // Channel posts may not have a `from` field — synthesize one from the chat
    if (!message.from && update.channel_post) {
      message.from = { id: message.chat.id, first_name: 'Channel' };
    }
    if (!message.from) return;

    const chatId = message.chat.id;
    const userId = message.from.id;

    // Private bot: reject unauthorized users
    if (!this.isUserAllowed(userId)) {
      return; // Silently ignore
    }

    // Group chat: only respond to @mentions or replies to bot messages
    const chatType = message.chat.type;
    if (chatType === 'group' || chatType === 'supergroup') {
      const isMentioned = this.botUsername && message.entities?.some(
        (e) => e.type === 'mention' &&
          message.text?.slice(e.offset, e.offset + e.length).toLowerCase() === `@${this.botUsername}`,
      );
      const isReplyToBot = message.reply_to_message?.from?.id !== undefined; // simplified — would need bot id check
      if (!isMentioned && !isReplyToBot && !message.text?.startsWith('/')) {
        return; // Ignore messages not directed at bot in groups
      }
    }

    const messageId = message.message_id;

    const threadId = message.message_thread_id;

    // Dispatch: photo message
    if (message.photo && message.photo.length > 0) {
      await this.handlePhotoMessage(chatId, messageId, message.photo, message.caption, threadId);
      return;
    }

    // Dispatch: voice message
    if (message.voice) {
      await this.handleVoiceMessage(chatId, messageId, message.voice, threadId);
      return;
    }

    // Dispatch: document message
    if (message.document) {
      await this.handleDocumentMessage(chatId, messageId, message.document, message.caption, threadId);
      return;
    }

    // Dispatch: text message
    if (!message.text) return;
    const text = message.text;

    // Intercept /approve and /deny early — they work even without the full command handler
    if (this.deps.approvalManager) {
      const lowerText = text.toLowerCase().replace(/@\w+$/, '');
      if (lowerText === '/approve' || lowerText === '/deny') {
        const approved = lowerText === '/approve';
        const userIdStr = String(userId);
        const handled = this.deps.approvalManager.handleResponse(userIdStr, approved);
        if (handled) {
          const label = approved ? 'Approved' : 'Denied';
          await this.sendMessage(chatId, `${label}.`);
        } else {
          await this.sendMessage(chatId, 'No pending approval to respond to.');
        }
        return;
      }
    }

    // Route autonomous commands (/auto, /kill, /tasks, /auto_status, /auto_resume)
    if (text.startsWith('/')) {
      const cmdName = text.split(' ')[0].toLowerCase().replace(/@\w+$/, '');
      const autonomousCmds = ['/auto', '/auto_status', '/auto_resume', '/kill', '/tasks'];
      if (autonomousCmds.includes(cmdName)) {
        if (this.autonomousExecutor) {
          await handleAutonomousCommand(text, {
            chatId,
            userId: String(userId),
            executor: this.autonomousExecutor,
            sendMessage: (id, msg) => this.sendMessage(id, msg),
          });
        } else {
          await this.sendMessage(chatId, 'Autonomous operations are not enabled in this instance.');
        }
        return;
      }

      // Persona & voice commands
      const personaCmds = ['/persona', '/personas', '/voice'];
      if (personaCmds.includes(cmdName)) {
        if (this.deps.personaManager) {
          await handlePersonaCommand(text, {
            chatId,
            personaManager: this.deps.personaManager,
            sendMessage: (id, msg) => this.sendMessage(id, msg),
          });
        } else {
          await this.sendMessage(chatId, 'Persona system is not enabled.');
        }
        return;
      }

      // /briefing → route through chat pipeline with briefing prompt
      if (cmdName === '/briefing') {
        const briefingPrompt =
          'Give me a concise daily briefing. Include: current date/time, weather (if available), ' +
          'any active reminders, recent conversation highlights, and anything else useful. ' +
          'Keep it focused and actionable.';
        await this.handleChatMessage(chatId, messageId, briefingPrompt);
        return;
      }

      await handleCommand(text, {
        chatId,
        config: this.deps.config,
        sessions: this.deps.sessions,
        sendMessage: (id, msg) => this.sendMessage(id, msg),
        approvalManager: this.deps.approvalManager,
      });
      return;
    }

    // Strip @botname mention from the text in groups
    let cleanText = text;
    if (this.botUsername) {
      cleanText = text.replace(new RegExp(`@${this.botUsername}\\b`, 'gi'), '').trim();
    }
    if (!cleanText) return;

    await this.handleChatMessage(chatId, messageId, cleanText, message.message_thread_id);
  }

  private async handleInlineQuery(query: NonNullable<TelegramUpdate['inline_query']>): Promise<void> {
    if (!this.isUserAllowed(query.from.id)) return;
    if (!query.query.trim()) {
      // Empty query — show usage hint
      try {
        await this.callApi('answerInlineQuery', {
          inline_query_id: query.id,
          results: [],
          switch_pm_text: 'Type a question to ask MoltBot',
          switch_pm_parameter: 'inline',
          cache_time: 1,
        });
      } catch { /* ignore */ }
      return;
    }

    try {
      const result = await processChatMessage(
        {
          message: query.query,
          conversationId: `inline:${query.from.id}`,
          source: 'telegram',
        },
        this.deps,
      );

      const responseText = result.response || 'No response generated.';
      // Truncate for inline result (Telegram limit is 4096 for message content)
      const truncated = responseText.length > 4000
        ? responseText.slice(0, 4000) + '...'
        : responseText;

      await this.callApi('answerInlineQuery', {
        inline_query_id: query.id,
        results: [
          {
            type: 'article',
            id: '1',
            title: query.query.slice(0, 64),
            description: truncated.slice(0, 200),
            input_message_content: {
              message_text: truncated,
            },
          },
        ],
        cache_time: 10,
      });
    } catch (err) {
      console.error('[inline] Error:', redactSensitive((err as Error).message));
      try {
        await this.callApi('answerInlineQuery', {
          inline_query_id: query.id,
          results: [{
            type: 'article',
            id: '1',
            title: 'Error',
            description: 'Failed to generate response',
            input_message_content: { message_text: 'Sorry, I encountered an error processing your query.' },
          }],
          cache_time: 1,
        });
      } catch { /* ignore */ }
    }
  }

  private async handleChatMessage(chatId: number, messageId: number, text: string, threadId?: number): Promise<void> {
    // React with processing emoji to acknowledge receipt
    await this.setReaction(chatId, messageId, this.deps.config.telegramReactions.processing);

    // Keep typing indicator alive while processing (auto-expires after 5 min)
    const typing = createTypingIndicator(
      () => { this.sendChatAction(chatId, 'typing').catch(() => {}); },
      4000,
    );

    // Build topic-aware conversation key: separate sessions per topic thread
    const conversationKey = threadId != null
      ? `telegram:${chatId}:topic:${threadId}`
      : `telegram:${chatId}`;

    // Stream response progressively via editing a single Telegram message
    const streamingConfig = this.deps.config.telegramStreaming;
    const editor = streamingConfig.enabled
      ? new TelegramStreamingEditor(chatId, this.botConfig.token, {
          throttleMs: streamingConfig.throttleMs,
          minCharsBeforeFirstSend: streamingConfig.minCharsBeforeFirstSend,
          minCharsBeforeEdit: streamingConfig.minCharsBeforeEdit,
          useDraft: streamingConfig.useDraftForDMs,
          isDM: threadId == null,
        })
      : null;

    try {
      const result = await processChatMessage(
        {
          message: text,
          conversationId: conversationKey,
          source: 'telegram',
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

      if (!result.response) {
        await this.sendMessage(chatId, 'No response generated.');
      } else if (!editor) {
        // Streaming disabled — send the full response at once
        const formatted = formatResponse(result.response);
        const chunks = splitMessage(formatted, 4096);
        for (const chunk of chunks) {
          await this.sendMessage(chatId, chunk, 'MarkdownV2');
        }
      }

      // Send generated images as photos + clean up the streamed text
      if (result.generatedImages && result.generatedImages.length > 0) {
        // Edit the streamed message to remove raw image URLs
        const editorMsgId = editor?.getMessageId();
        if (editorMsgId && result.response) {
          const cleanText = result.response.trim();
          if (cleanText && cleanText !== editor?.getBuffer()?.trim()) {
            try {
              await this.callApi('editMessageText', {
                chat_id: chatId,
                message_id: editorMsgId,
                text: cleanText || 'Here you go!',
              });
            } catch {
              // Edit may fail if text hasn't changed enough
            }
          }
        }
        await this.sendGeneratedImages(chatId, result.generatedImages);
      }

      // Send generated files as documents
      if (result.generatedFiles && result.generatedFiles.length > 0) {
        await this.sendGeneratedFiles(chatId, result.generatedFiles);
      }

      // Send polls
      if (result.polls && result.polls.length > 0) {
        for (const poll of result.polls) {
          try {
            await this.callApi('sendPoll', {
              chat_id: chatId,
              question: poll.question,
              options: poll.options,
              is_anonymous: poll.isAnonymous ?? true,
              allows_multiple_answers: poll.allowsMultipleAnswers ?? false,
              type: poll.type ?? 'regular',
              ...(poll.correctOptionId != null ? { correct_option_id: poll.correctOptionId } : {}),
            });
          } catch (err) {
            console.error('[poll] Failed to send poll:', redactSensitive((err as Error).message));
            await this.sendMessage(chatId, `Failed to create poll: ${(err as Error).message}`);
          }
        }
      }

      // Mark message as done
      await this.removeReaction(chatId, messageId);
    } catch (err) {
      typing.clear();
      if (editor) await editor.finalize();
      await this.setReaction(chatId, messageId, this.deps.config.telegramReactions.error);
      const errMsg = err instanceof Error ? err.message : 'An error occurred';
      await this.sendMessage(chatId, `Error: ${errMsg}`);
    }
  }

  private async handlePhotoMessage(
    chatId: number,
    messageId: number,
    photos: TelegramPhotoSize[],
    caption?: string,
    threadId?: number,
  ): Promise<void> {
    await this.setReaction(chatId, messageId, this.deps.config.telegramReactions.processing);

    // Keep typing indicator alive while processing (auto-expires after 5 min)
    const typing = createTypingIndicator(
      () => { this.sendChatAction(chatId, 'typing').catch(() => {}); },
      4000,
    );

    try {
      // Pick the largest photo (last in array per Telegram API convention)
      const largest = photos[photos.length - 1];

      // Download the photo (max 5 MB)
      const { buffer, filePath } = await downloadTelegramFile(
        this.botConfig.token,
        largest.file_id,
      );

      // Determine media type from file extension
      const ext = filePath.split('.').pop()?.toLowerCase() ?? 'jpg';
      const mediaTypeMap: Record<string, string> = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
      };
      const mediaType = mediaTypeMap[ext] ?? 'image/jpeg';

      // Base64 encode the image
      const base64 = buffer.toString('base64');

      const userMessage = caption ?? 'What is in this image?';

      const conversationKey = threadId != null
        ? `telegram:${chatId}:topic:${threadId}`
        : `telegram:${chatId}`;

      const result = await processChatMessage(
        {
          message: userMessage,
          conversationId: conversationKey,
          source: 'telegram',
          images: [{ base64, mediaType }],
        },
        this.deps,
      );

      typing.clear();

      if (!result.response) {
        await this.sendMessage(chatId, 'No response generated.');
        return;
      }

      // Format and split for Telegram
      const formatted = formatResponse(result.response);
      const chunks = splitMessage(formatted, 4096);

      for (const chunk of chunks) {
        await this.sendMessage(chatId, chunk, 'MarkdownV2');
      }
      await this.removeReaction(chatId, messageId);
    } catch (err) {
      typing.clear();
      await this.setReaction(chatId, messageId, this.deps.config.telegramReactions.error);
      const errMsg = err instanceof Error ? err.message : 'An error occurred';
      await this.sendMessage(chatId, `Error: ${errMsg}`);
    }
  }

  private async handleVoiceMessage(chatId: number, messageId: number, voiceMsg: TelegramVoice, threadId?: number): Promise<void> {
    const whisperKey = this.deps.config.whisperApiKey;
    if (!whisperKey) {
      await this.sendMessage(
        chatId,
        'Voice messages are not enabled. Set GROQ_API_KEY (free) or OPENAI_API_KEY in your .env file.',
      );
      return;
    }

    await this.setReaction(chatId, messageId, this.deps.config.telegramReactions.processing);

    try {
      const { buffer } = await downloadTelegramFile(
        this.botConfig.token,
        voiceMsg.file_id,
        25 * 1024 * 1024,
      );

      const transcription = await transcribeAudio(buffer, whisperKey, {
        apiUrl: this.deps.config.whisperApiUrl,
        model: this.deps.config.whisperModel,
        provider: this.deps.config.whisperProvider,
      });

      // Check if voice mode is enabled (auto-voice-reply)
      const chatKey = threadId != null
        ? `telegram:${chatId}:topic:${threadId}`
        : `telegram:${chatId}`;
      const voiceMode = this.deps.personaManager?.isVoiceModeEnabled(chatKey) ?? false;

      if (!voiceMode) {
        // Standard flow: transcribe → text reply
        await this.handleChatMessage(chatId, messageId, transcription, threadId);
        return;
      }

      // Voice mode: process with voice-aware flag, then auto-TTS the response
      // Keep record_voice indicator alive (auto-expires after 5 min)
      const typing = createTypingIndicator(
        () => { this.sendChatAction(chatId, 'record_voice').catch(() => {}); },
        4000,
      );

      try {
        const result = await processChatMessage(
          { message: transcription, conversationId: chatKey, source: 'telegram', isVoiceInput: true },
          this.deps,
        );

        typing.clear();

        if (!result.response) {
          await this.sendMessage(chatId, 'No response generated.');
          await this.removeReaction(chatId, messageId);
          return;
        }

        // Auto-TTS the response with persona's preferred voice
        const persona = this.deps.personaManager?.getActivePersona(chatKey);
        const ttsVoice = persona?.preferredVoice ?? 'nova';
        const ttsText = result.response.slice(0, 4000);
        const audioBuffer = await generateSpeech(ttsText, ttsVoice);

        if (audioBuffer) {
          await this.sendVoiceBuffer(chatId, audioBuffer);
        }

        // Also send text for longer responses or if TTS failed
        if (result.response.length > 100 || !audioBuffer) {
          await this.sendMessage(chatId, result.response);
        }

        // Send generated images/files/polls
        if (result.generatedImages?.length) {
          await this.sendGeneratedImages(chatId, result.generatedImages);
        }
        if (result.generatedFiles?.length) {
          await this.sendGeneratedFiles(chatId, result.generatedFiles);
        }
        if (result.polls?.length) {
          for (const poll of result.polls) {
            try {
              await this.callApi('sendPoll', {
                chat_id: chatId,
                question: poll.question,
                options: poll.options,
                is_anonymous: poll.isAnonymous ?? true,
                allows_multiple_answers: poll.allowsMultipleAnswers ?? false,
                type: poll.type ?? 'regular',
                ...(poll.correctOptionId != null ? { correct_option_id: poll.correctOptionId } : {}),
              });
            } catch { /* ignore poll errors */ }
          }
        }

        await this.removeReaction(chatId, messageId);
      } catch (err) {
        typing.clear();
        throw err;
      }
    } catch (err) {
      await this.setReaction(chatId, messageId, this.deps.config.telegramReactions.error);
      const errMsg = err instanceof Error ? err.message : 'Failed to process voice message';
      await this.sendMessage(chatId, `Error: ${errMsg}`);
    }
  }

  private async handleDocumentMessage(
    chatId: number,
    messageId: number,
    document: TelegramDocument,
    caption?: string,
    threadId?: number,
  ): Promise<void> {
    await this.setReaction(chatId, messageId, this.deps.config.telegramReactions.processing);

    // Keep typing indicator alive while processing (auto-expires after 5 min)
    const typing = createTypingIndicator(
      () => { this.sendChatAction(chatId, 'typing').catch(() => {}); },
      4000,
    );

    try {
      // Download the document (max 10 MB)
      const { buffer } = await downloadTelegramFile(
        this.botConfig.token,
        document.file_id,
        10 * 1024 * 1024,
      );

      // Extract text from the document
      const fileName = document.file_name ?? 'unknown';
      const documentText = extractTextFromDocument(buffer, fileName, document.mime_type);

      // Use the caption as the user message, or a default prompt
      const userMessage = caption ?? 'Please review this document.';

      const conversationKey = threadId != null
        ? `telegram:${chatId}:topic:${threadId}`
        : `telegram:${chatId}`;

      const result = await processChatMessage(
        {
          message: userMessage,
          conversationId: conversationKey,
          source: 'telegram',
          documentText,
        },
        this.deps,
      );

      typing.clear();

      if (!result.response) {
        await this.sendMessage(chatId, 'No response generated.');
        return;
      }

      // Format and split for Telegram
      const formatted = formatResponse(result.response);
      const chunks = splitMessage(formatted, 4096);

      for (const chunk of chunks) {
        await this.sendMessage(chatId, chunk, 'MarkdownV2');
      }
      await this.removeReaction(chatId, messageId);
    } catch (err) {
      typing.clear();
      await this.setReaction(chatId, messageId, this.deps.config.telegramReactions.error);
      const errMsg = err instanceof Error ? err.message : 'An error occurred';
      if (errMsg.includes('Unsupported document format')) {
        await this.sendMessage(
          chatId,
          'Unsupported file format. Please send a text-based document (.txt, .md, .csv, .json, .pdf, etc.).',
        );
      } else {
        await this.sendMessage(chatId, `Error: ${errMsg}`);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Photo sending
  // -----------------------------------------------------------------------

  private async sendPhotoByUrl(chatId: number, url: string): Promise<void> {
    // Dynamic image generators (Pollinations) must be downloaded first —
    // Telegram can't wait for on-the-fly generation (15-30s).
    console.log(`[image] Downloading image from: ${url.slice(0, 100)}...`);
    const buffer = await this.downloadImage(url);
    if (buffer) {
      console.log(`[image] Downloaded ${buffer.length} bytes, uploading to Telegram...`);
      await this.sendPhotoBuffer(chatId, buffer);
      return;
    }

    // If download failed, try letting Telegram fetch it directly
    console.log('[image] Download failed, trying Telegram direct fetch...');
    try {
      await this.callApi('sendPhoto', {
        chat_id: chatId,
        photo: url,
      });
    } catch (err) {
      console.error('[image] Telegram sendPhoto also failed:', redactSensitive((err as Error).message));
      // Send URL as text so user can at least click it
      await this.sendMessage(chatId, `Here's the image link: ${url}`);
    }
  }

  private async downloadImage(url: string): Promise<Buffer | null> {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(90_000),
        redirect: 'follow',
      });
      console.log(`[image] Fetch response: ${res.status} ${res.headers.get('content-type')}`);
      if (!res.ok) return null;
      const arrayBuf = await res.arrayBuffer();
      if (arrayBuf.byteLength < 100) {
        console.log(`[image] Response too small (${arrayBuf.byteLength} bytes), likely not an image`);
        return null;
      }
      return Buffer.from(arrayBuf);
    } catch (err) {
      console.error('[image] Download error:', redactSensitive((err as Error).message));
      return null;
    }
  }

  private async sendPhotoBuffer(chatId: number, buffer: Buffer): Promise<void> {
    await this.withRetry(async () => {
      const formData = new FormData();
      formData.set('chat_id', String(chatId));
      formData.set('photo', new Blob([buffer], { type: 'image/png' }), 'image.png');

      const res = await fetch(`${this.apiBase}/sendPhoto`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Telegram sendPhoto failed: ${res.status} ${text}`);
      }
      console.log('[image] Photo sent successfully');
    }, 'sendPhoto');
  }

  private async sendGeneratedImages(chatId: number, images: GeneratedImage[]): Promise<void> {
    console.log(`[image] Sending ${images.length} generated image(s)...`);
    for (const img of images) {
      try {
        await this.sendChatAction(chatId, 'upload_photo');
        if (img.type === 'url') {
          await this.sendPhotoByUrl(chatId, img.data);
        } else {
          const buffer = Buffer.from(img.data, 'base64');
          console.log(`[image] Uploading base64 image (${buffer.length} bytes)...`);
          await this.sendPhotoBuffer(chatId, buffer);
        }
      } catch (err) {
        console.error('[image] Failed to send image:', redactSensitive((err as Error).message));
        // Send the URL as text so user isn't left with nothing
        if (img.type === 'url') {
          await this.sendMessage(chatId, `Image link: ${img.data}`).catch(() => {});
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Document sending
  // -----------------------------------------------------------------------

  private async sendDocumentBuffer(
    chatId: number,
    buffer: Buffer,
    filename: string,
    mimeType: string,
    caption?: string,
  ): Promise<void> {
    await this.withRetry(async () => {
      const formData = new FormData();
      formData.set('chat_id', String(chatId));
      formData.set(
        'document',
        new Blob([buffer], { type: mimeType }),
        filename,
      );
      if (caption) {
        formData.set('caption', caption.slice(0, 1024));
      }

      const res = await fetch(`${this.apiBase}/sendDocument`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Telegram sendDocument failed: ${res.status} ${text}`);
      }
      console.log(`[file] Document "${filename}" sent successfully`);
    }, 'sendDocument');
  }

  async sendGeneratedFiles(chatId: number, files: GeneratedFile[]): Promise<void> {
    console.log(`[file] Sending ${files.length} file(s)...`);
    for (const file of files) {
      try {
        // Send audio files as voice messages
        if (file.mimeType.startsWith('audio/')) {
          await this.sendChatAction(chatId, 'upload_voice');
          await this.sendVoiceBuffer(chatId, file.data);
        } else {
          await this.sendChatAction(chatId, 'upload_document');
          await this.sendDocumentBuffer(
            chatId,
            file.data,
            file.filename,
            file.mimeType,
            file.caption,
          );
        }
      } catch (err) {
        console.error(`[file] Failed to send "${file.filename}":`, redactSensitive((err as Error).message));
        await this.sendMessage(
          chatId,
          `Failed to send file "${file.filename}": ${(err as Error).message}`,
        ).catch(() => {});
      }
    }
  }

  private async sendVoiceBuffer(chatId: number, buffer: Buffer): Promise<void> {
    await this.withRetry(async () => {
      const form = new FormData();
      form.append('chat_id', String(chatId));
      form.append('voice', new Blob([buffer], { type: 'audio/ogg' }), 'voice.ogg');

      const res = await fetch(`${this.apiBase}/sendVoice`, {
        method: 'POST',
        body: form,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`sendVoice failed: ${res.status} ${text}`);
      }
    }, 'sendVoice');
  }

  // -----------------------------------------------------------------------
  // Telegram API helpers
  // -----------------------------------------------------------------------

  private async setReaction(chatId: number, messageId: number, emoji: string): Promise<void> {
    try {
      await this.callApi('setMessageReaction', {
        chat_id: chatId,
        message_id: messageId,
        reaction: [{ type: 'emoji', emoji }],
      });
    } catch {
      // Non-critical — reactions may not be supported in all chats
    }
  }

  private async removeReaction(chatId: number, messageId: number): Promise<void> {
    try {
      await this.callApi('setMessageReaction', {
        chat_id: chatId,
        message_id: messageId,
        reaction: [],
      });
    } catch {
      // Non-critical
    }
  }

  private async sendChatAction(chatId: number, action: string): Promise<void> {
    try {
      await this.callApi('sendChatAction', {
        chat_id: chatId,
        action,
      });
    } catch {
      // Non-critical
    }
  }

  private async callApi(method: string, body: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(`${this.apiBase}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Telegram ${method} failed: ${res.status} ${text}`);
    }

    return res.json();
  }

  private async withRetry<T>(
    fn: () => Promise<T>,
    label: string,
    maxRetries = 1,
    baseDelayMs = 2000,
  ): Promise<T> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxRetries) {
          const delay = baseDelayMs * Math.pow(2, attempt);
          console.warn(`[telegram] ${label} failed (attempt ${attempt + 1}), retrying in ${delay}ms: ${lastError.message}`);
          await this.sleep(delay);
        }
      }
    }
    throw lastError;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
