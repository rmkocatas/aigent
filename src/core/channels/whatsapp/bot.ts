// ============================================================
// OpenClaw Deploy — WhatsApp Bot
// ============================================================

import type {
  GatewayRuntimeConfig,
  WhatsAppMessage,
} from '../../../types/index.js';
import type { SessionStore } from '../../gateway/session-store.js';
import type { TrainingDataStore } from '../../training/data-collector.js';
import type { ToolRegistry } from '../../tools/registry.js';
import type { ApprovalManager } from '../../services/approval-manager.js';
import { processChatMessage } from '../../gateway/chat-pipeline.js';
import { handleCommand } from './commands.js';
import { formatResponse, splitMessage, stripMarkdown } from './formatter.js';
import { downloadWhatsAppMedia } from './media-downloader.js';
import { extractTextFromDocument } from '../telegram/document-handler.js';
import { transcribeAudio } from '../telegram/speech-to-text.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WhatsAppBotConfig {
  accessToken: string;
  phoneNumberId: string;
  verifyToken: string;
}

export interface WhatsAppBotDeps {
  config: GatewayRuntimeConfig;
  sessions: SessionStore;
  trainingStore: TrainingDataStore | null;
  toolRegistry?: ToolRegistry;
  approvalManager?: ApprovalManager;
}

const API_BASE = 'https://graph.facebook.com/v21.0';

// ---------------------------------------------------------------------------
// Bot class
// ---------------------------------------------------------------------------

export class WhatsAppBot {
  constructor(
    private readonly botConfig: WhatsAppBotConfig,
    private readonly deps: WhatsAppBotDeps,
  ) {}

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  async handleIncomingMessage(message: WhatsAppMessage): Promise<void> {
    const from = message.from;

    if (!this.isNumberAllowed(from)) return;

    try {
      switch (message.type) {
        case 'text':
          if (message.text?.body) {
            const text = message.text.body;
            if (text.startsWith('/')) {
              await handleCommand(text, {
                from,
                config: this.deps.config,
                sessions: this.deps.sessions,
                sendMessage: (to, msg) => this.sendTextMessage(to, msg),
                approvalManager: this.deps.approvalManager,
              });
            } else {
              await this.handleChatMessage(from, text);
            }
          }
          break;

        case 'image':
          if (message.image) {
            await this.handleImageMessage(
              from,
              message.image.id,
              message.image.mime_type,
              message.image.caption,
            );
          }
          break;

        case 'audio':
          if (message.audio) {
            await this.handleAudioMessage(from, message.audio.id);
          }
          break;

        case 'document':
          if (message.document) {
            await this.handleDocumentMessage(
              from,
              message.document.id,
              message.document.filename,
              message.document.mime_type,
            );
          }
          break;

        default:
          // Unsupported message types silently ignored
          break;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      await this.sendTextMessage(from, `Error: ${errMsg}`).catch(() => {});
    }
  }

  async sendTextMessage(to: string, text: string): Promise<void> {
    await this.callApi(`${this.botConfig.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: text },
    });
  }

  async markAsRead(messageId: string): Promise<void> {
    await this.callApi(`${this.botConfig.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    }).catch(() => {});
  }

  // -----------------------------------------------------------------------
  // Message handlers
  // -----------------------------------------------------------------------

  private async handleChatMessage(from: string, text: string): Promise<void> {
    // Send typing indicator
    await this.sendReaction(from, '').catch(() => {});

    const result = await processChatMessage(
      {
        message: text,
        conversationId: `whatsapp:${from}`,
        source: 'whatsapp',
      },
      this.deps,
    );

    const formatted = formatResponse(result.response);
    const chunks = splitMessage(formatted, 4096);

    for (const chunk of chunks) {
      try {
        await this.sendTextMessage(from, chunk);
      } catch {
        await this.sendTextMessage(from, stripMarkdown(chunk));
      }
    }
  }

  private async handleImageMessage(
    from: string,
    mediaId: string,
    mimeType?: string,
    caption?: string,
  ): Promise<void> {
    const buffer = await downloadWhatsAppMedia(
      this.botConfig.accessToken,
      mediaId,
    );

    const base64 = buffer.toString('base64');
    const mediaType = mimeType ?? 'image/jpeg';

    const result = await processChatMessage(
      {
        message: caption || 'What is in this image?',
        conversationId: `whatsapp:${from}`,
        source: 'whatsapp',
        images: [{ base64, mediaType }],
      },
      this.deps,
    );

    const formatted = formatResponse(result.response);
    const chunks = splitMessage(formatted, 4096);
    for (const chunk of chunks) {
      await this.sendTextMessage(from, chunk);
    }
  }

  private async handleAudioMessage(from: string, mediaId: string): Promise<void> {
    const whisperKey = this.deps.config.whisperApiKey;
    if (!whisperKey) {
      await this.sendTextMessage(from, 'Voice messages require a Whisper API key. Set GROQ_API_KEY (free) or OPENAI_API_KEY.');
      return;
    }

    const buffer = await downloadWhatsAppMedia(
      this.botConfig.accessToken,
      mediaId,
      25 * 1024 * 1024,
    );

    const transcription = await transcribeAudio(buffer, whisperKey, {
      apiUrl: this.deps.config.whisperApiUrl,
      model: this.deps.config.whisperModel,
      provider: this.deps.config.whisperProvider,
    });
    await this.handleChatMessage(from, transcription);
  }

  private async handleDocumentMessage(
    from: string,
    mediaId: string,
    filename?: string,
    mimeType?: string,
  ): Promise<void> {
    const buffer = await downloadWhatsAppMedia(
      this.botConfig.accessToken,
      mediaId,
      10 * 1024 * 1024,
    );

    try {
      const documentText = extractTextFromDocument(
        buffer,
        filename ?? 'document',
        mimeType,
      );

      const result = await processChatMessage(
        {
          message: 'Please analyze this document.',
          conversationId: `whatsapp:${from}`,
          source: 'whatsapp',
          documentText,
        },
        this.deps,
      );

      const formatted = formatResponse(result.response);
      const chunks = splitMessage(formatted, 4096);
      for (const chunk of chunks) {
        await this.sendTextMessage(from, chunk);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      if (errMsg.includes('Unsupported document format')) {
        await this.sendTextMessage(
          from,
          'Unsupported file format. Please send text files, code, or PDFs.',
        );
      } else {
        throw err;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Security
  // -----------------------------------------------------------------------

  private isNumberAllowed(phoneNumber: string): boolean {
    const allowed = this.deps.config.whatsappAllowedNumbers;
    if (!allowed || allowed.length === 0) return true;
    return allowed.includes(phoneNumber);
  }

  // -----------------------------------------------------------------------
  // WhatsApp Cloud API helpers
  // -----------------------------------------------------------------------

  private async callApi(endpoint: string, body: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(`${API_BASE}/${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.botConfig.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`WhatsApp API error ${response.status}: ${text}`);
    }

    return response.json();
  }

  private async sendReaction(_to: string, _emoji: string): Promise<void> {
    // WhatsApp doesn't have a typing indicator via Cloud API,
    // so this is a no-op placeholder for interface compatibility
  }
}
