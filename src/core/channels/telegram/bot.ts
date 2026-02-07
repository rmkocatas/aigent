// ============================================================
// OpenClaw Deploy — Telegram Bot (Long Polling)
// ============================================================

import type { GatewayRuntimeConfig, TelegramPhotoSize, TelegramVoice, TelegramDocument } from '../../../types/index.js';
import type { SessionStore } from '../../gateway/session-store.js';
import type { TrainingDataStore } from '../../training/data-collector.js';
import type { ToolRegistry } from '../../tools/registry.js';
import type { ApprovalManager } from '../../services/approval-manager.js';
import { processChatMessage } from '../../gateway/chat-pipeline.js';
import { handleCommand } from './commands.js';
import { formatResponse, splitMessage, stripMarkdown } from './formatter.js';
import { TelegramStreamingEditor } from './streaming-editor.js';
import { downloadTelegramFile } from './file-downloader.js';
import { transcribeAudio } from './speech-to-text.js';
import { extractTextFromDocument } from './document-handler.js';

// ---------------------------------------------------------------------------
// Telegram API types (minimal)
// ---------------------------------------------------------------------------

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: { id: number; first_name: string; username?: string };
    chat: { id: number; type: 'private' | 'group' | 'supergroup' | 'channel' };
    text?: string;
    photo?: TelegramPhotoSize[];
    voice?: TelegramVoice;
    document?: TelegramDocument;
    caption?: string;
    date: number;
  };
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
}

export class TelegramBot {
  private running = false;
  private offset = 0;
  private abortController: AbortController | null = null;
  private readonly apiBase: string;

  constructor(
    private readonly botConfig: TelegramBotConfig,
    private readonly deps: TelegramBotDeps,
  ) {
    this.apiBase = `https://api.telegram.org/bot${botConfig.token}`;
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

    this.running = true;
    this.pollLoop().catch(() => {});
  }

  async stop(): Promise<void> {
    this.running = false;
    this.abortController?.abort();
  }

  // Exposed for commands.ts
  async sendMessage(chatId: number, text: string, parseMode?: 'MarkdownV2'): Promise<void> {
    try {
      await this.callApi('sendMessage', {
        chat_id: chatId,
        text,
        ...(parseMode ? { parse_mode: parseMode } : {}),
      });
    } catch {
      // If MarkdownV2 fails, retry as plain text
      if (parseMode) {
        try {
          await this.callApi('sendMessage', {
            chat_id: chatId,
            text: stripMarkdown(text),
          });
        } catch {
          // Give up silently
        }
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
          await this.handleUpdate(update);
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
        allowed_updates: ['message'],
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
    const message = update.message;
    if (!message) return;

    const chatId = message.chat.id;
    const userId = message.from.id;

    // Private bot: reject unauthorized users
    if (!this.isUserAllowed(userId)) {
      return; // Silently ignore
    }

    // Dispatch: photo message
    if (message.photo && message.photo.length > 0) {
      await this.handlePhotoMessage(chatId, message.photo, message.caption);
      return;
    }

    // Dispatch: voice message
    if (message.voice) {
      await this.handleVoiceMessage(chatId, message.voice);
      return;
    }

    // Dispatch: document message
    if (message.document) {
      await this.handleDocumentMessage(chatId, message.document, message.caption);
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

    if (text.startsWith('/')) {
      await handleCommand(text, {
        chatId,
        config: this.deps.config,
        sessions: this.deps.sessions,
        sendMessage: (id, msg) => this.sendMessage(id, msg),
        approvalManager: this.deps.approvalManager,
      });
      return;
    }

    await this.handleChatMessage(chatId, text);
  }

  private async handleChatMessage(chatId: number, text: string): Promise<void> {
    // Send typing indicator
    await this.sendChatAction(chatId, 'typing');

    // Keep typing indicator alive while processing
    const typingInterval = setInterval(() => {
      this.sendChatAction(chatId, 'typing').catch(() => {});
    }, 4000);

    // Stream response progressively via editing a single Telegram message
    const editor = new TelegramStreamingEditor(chatId, this.botConfig.token);

    try {
      const result = await processChatMessage(
        {
          message: text,
          conversationId: `telegram:${chatId}`,
          source: 'telegram',
        },
        this.deps,
        {
          onChunk: (chunk: string) => {
            editor.addChunk(chunk).catch(() => {});
          },
        },
      );

      clearInterval(typingInterval);
      await editor.finalize();

      if (!result.response) {
        await this.sendMessage(chatId, 'No response generated.');
      }
    } catch (err) {
      clearInterval(typingInterval);
      await editor.finalize();
      const errMsg = err instanceof Error ? err.message : 'An error occurred';
      await this.sendMessage(chatId, `Error: ${errMsg}`);
    }
  }

  private async handlePhotoMessage(
    chatId: number,
    photos: TelegramPhotoSize[],
    caption?: string,
  ): Promise<void> {
    await this.sendChatAction(chatId, 'typing');

    const typingInterval = setInterval(() => {
      this.sendChatAction(chatId, 'typing').catch(() => {});
    }, 4000);

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

      const result = await processChatMessage(
        {
          message: userMessage,
          conversationId: `telegram:${chatId}`,
          source: 'telegram',
          images: [{ base64, mediaType }],
        },
        this.deps,
      );

      clearInterval(typingInterval);

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
    } catch (err) {
      clearInterval(typingInterval);
      const errMsg = err instanceof Error ? err.message : 'An error occurred';
      await this.sendMessage(chatId, `Error: ${errMsg}`);
    }
  }

  private async handleVoiceMessage(chatId: number, voice: TelegramVoice): Promise<void> {
    const whisperKey = this.deps.config.whisperApiKey;
    if (!whisperKey) {
      await this.sendMessage(
        chatId,
        'Voice messages are not enabled. Set GROQ_API_KEY (free) or OPENAI_API_KEY in your .env file.',
      );
      return;
    }

    await this.sendChatAction(chatId, 'typing');

    try {
      const { buffer } = await downloadTelegramFile(
        this.botConfig.token,
        voice.file_id,
        25 * 1024 * 1024,
      );

      const transcription = await transcribeAudio(buffer, whisperKey, {
        apiUrl: this.deps.config.whisperApiUrl,
        model: this.deps.config.whisperModel,
      });

      await this.handleChatMessage(chatId, transcription);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to process voice message';
      await this.sendMessage(chatId, `Error: ${errMsg}`);
    }
  }

  private async handleDocumentMessage(
    chatId: number,
    document: TelegramDocument,
    caption?: string,
  ): Promise<void> {
    await this.sendChatAction(chatId, 'typing');

    const typingInterval = setInterval(() => {
      this.sendChatAction(chatId, 'typing').catch(() => {});
    }, 4000);

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

      const result = await processChatMessage(
        {
          message: userMessage,
          conversationId: `telegram:${chatId}`,
          source: 'telegram',
          documentText,
        },
        this.deps,
      );

      clearInterval(typingInterval);

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
    } catch (err) {
      clearInterval(typingInterval);
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
  // Telegram API helpers
  // -----------------------------------------------------------------------

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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
