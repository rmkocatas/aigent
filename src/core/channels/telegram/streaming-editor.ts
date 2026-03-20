// ============================================================
// OpenClaw Deploy — Telegram Streaming Editor
// ============================================================
// Manages progressive message editing during LLM streaming,
// sending the first chunk as a new message and debouncing
// subsequent edits to avoid Telegram rate limits and flicker.
// ============================================================

import { escapeMarkdownV2 } from './formatter.js';

/** Convert snake_case tool name to readable form: "web_search" → "Web Search" */
function humanizeToolName(name: string): string {
  return name.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export interface TelegramStreamingOptions {
  throttleMs?: number;
  minCharsBeforeFirstSend?: number;
  minCharsBeforeEdit?: number;
  /** Use sendMessageDraft for DM typing previews (Telegram Bot API) */
  useDraft?: boolean;
  /** Whether this chat is a DM (private chat) */
  isDM?: boolean;
}

export class TelegramStreamingEditor {
  private messageId: number | null = null;
  private buffer = '';
  private lastEditedText = '';
  private lastEditTime = 0;
  private editTimer: ReturnType<typeof setTimeout> | null = null;
  private firstSendPromise: Promise<void> | null = null; // Awaitable first-message send
  private readonly editIntervalMs: number;
  private readonly minCharsBeforeEdit: number;
  private readonly minCharsBeforeFirstSend: number;
  private readonly maxMessageLength = 4000;
  private finalized = false;
  private pendingHighSurrogate: number | null = null; // Holds incomplete surrogate pair
  private toolStatusLine = '';    // Current tool status footer appended to buffer
  private hasToolStatus = false;  // Whether buffer currently includes a tool status suffix
  private formatFailed = false;   // Sticky: once MarkdownV2 fails, stay on plain text

  // --- sendMessageDraft support ---
  private draftId: number | null = null;
  /** null = untested, true/false = probed */
  private draftAvailable: boolean | null = null;
  private readonly useDraft: boolean;
  private readonly isDM: boolean;

  /** Get the current message ID (for post-finalize editing). */
  getMessageId(): number | null {
    return this.messageId;
  }

  /** Get the current buffer content. */
  getBuffer(): string {
    return this.buffer;
  }

  constructor(
    private readonly chatId: number,
    private readonly botToken: string,
    private readonly options?: TelegramStreamingOptions,
  ) {
    this.editIntervalMs = options?.throttleMs ?? 1500;
    this.minCharsBeforeFirstSend = options?.minCharsBeforeFirstSend ?? 20;
    this.minCharsBeforeEdit = options?.minCharsBeforeEdit ?? 40;
    this.useDraft = options?.useDraft ?? false;
    this.isDM = options?.isDM ?? false;
  }

  /** Show or clear a tool activity footer (e.g., "🔧 Web Search..."). */
  setToolStatus(toolName: string | null): void {
    if (this.finalized) return;

    // Strip existing tool status from buffer
    if (this.hasToolStatus) {
      this.buffer = this.buffer.slice(0, this.buffer.length - this.toolStatusLine.length);
      this.hasToolStatus = false;
      this.toolStatusLine = '';
    }

    if (toolName) {
      this.toolStatusLine = `\n\n🔧 ${humanizeToolName(toolName)}...`;
      this.buffer += this.toolStatusLine;
      this.hasToolStatus = true;

      // Show tool status: send a new message, update draft, or edit existing
      if (this.messageId === null && this.draftAvailable !== true) {
        if (!this.firstSendPromise) {
          this.firstSendPromise = this.sendFirstMessage();
        }
      } else {
        this.scheduleEdit();
      }
    }
  }

  async addChunk(text: string): Promise<void> {
    if (this.finalized) return;

    // Strip tool status before appending new content
    if (this.hasToolStatus) {
      this.buffer = this.buffer.slice(0, this.buffer.length - this.toolStatusLine.length);
      this.hasToolStatus = false;
      this.toolStatusLine = '';
    }

    this.buffer += this.filterPartialToken(text);

    // If content exceeds max length, finalize current message and start fresh
    const hasActiveMessage = this.messageId !== null || this.draftAvailable === true;
    if (this.buffer.length > this.maxMessageLength && hasActiveMessage) {
      await this.flushEdit();
      this.messageId = null;
      this.firstSendPromise = null;
      this.draftAvailable = false;
      this.draftId = null;
      this.buffer = '';
      this.lastEditedText = '';
      return;
    }

    if (this.messageId === null && this.draftAvailable !== true) {
      // Wait for enough content before sending the first message
      // to avoid sending a tiny fragment that immediately gets edited
      if (this.buffer.length < this.minCharsBeforeFirstSend) {
        return;
      }

      // Prevent concurrent first-message sends — while the API call is
      // in-flight, more chunks arrive and would each try to sendMessage,
      // producing duplicate messages (the "stuttering" bug).
      if (this.firstSendPromise) return;

      this.firstSendPromise = this.sendFirstMessage();
    } else {
      // Only schedule an edit if enough new content has accumulated
      const newChars = this.buffer.length - this.lastEditedText.length;
      if (newChars >= this.minCharsBeforeEdit) {
        this.scheduleEdit();
      }
    }
  }

  async finalize(): Promise<void> {
    if (this.finalized) return;
    this.finalized = true;

    // Strip tool status before final edit
    if (this.hasToolStatus) {
      this.buffer = this.buffer.slice(0, this.buffer.length - this.toolStatusLine.length);
      this.hasToolStatus = false;
    }

    // Flush any pending high surrogate
    if (this.pendingHighSurrogate !== null) {
      this.buffer += String.fromCharCode(this.pendingHighSurrogate);
      this.pendingHighSurrogate = null;
    }

    if (this.editTimer !== null) {
      clearTimeout(this.editTimer);
      this.editTimer = null;
    }

    // Wait for any in-flight first-message send to complete
    if (this.firstSendPromise) {
      await this.firstSendPromise;
    }

    // Draft mode: send the real message (replaces the ephemeral draft)
    if (this.draftAvailable === true && this.draftId !== null && this.buffer.length > 0) {
      try {
        const formatted = this.formatForTelegram(this.buffer);
        const response = await this.callApi('sendMessage', {
          chat_id: this.chatId,
          text: formatted.text,
          ...(formatted.parseMode ? { parse_mode: formatted.parseMode } : {}),
        });
        if (response) {
          const data = response as { result: { message_id: number } };
          this.messageId = data.result.message_id;
          this.lastEditedText = this.buffer;
        }
      } catch {
        // Silently continue
      }
      return;
    }

    // If we never sent a first message (short response), send now
    if (this.messageId === null && this.buffer.length > 0) {
      try {
        const formatted = this.formatForTelegram(this.buffer);
        const response = await this.callApi('sendMessage', {
          chat_id: this.chatId,
          text: formatted.text,
          ...(formatted.parseMode ? { parse_mode: formatted.parseMode } : {}),
        });
        if (response) {
          const data = response as { result: { message_id: number } };
          this.messageId = data.result.message_id;
          this.lastEditedText = this.buffer;
        }
      } catch {
        // Silently continue
      }
      return;
    }

    // Final edit with complete text (only if it changed)
    if (this.messageId !== null && this.buffer !== this.lastEditedText) {
      await this.flushEdit();
    }
  }

  /**
   * Filters incomplete surrogate pairs from streaming chunks.
   * When the LLM splits a chunk mid-emoji, the last char may be a high
   * surrogate (0xD800–0xDBFF) without its low surrogate pair — hold it
   * until the next chunk completes it.
   */
  private filterPartialToken(text: string): string {
    if (!text) return text;

    // Prepend any pending high surrogate from the previous chunk
    if (this.pendingHighSurrogate !== null) {
      text = String.fromCharCode(this.pendingHighSurrogate) + text;
      this.pendingHighSurrogate = null;
    }

    // Check if the last character is a high surrogate without a low pair
    const lastChar = text.charCodeAt(text.length - 1);
    if (lastChar >= 0xD800 && lastChar <= 0xDBFF) {
      this.pendingHighSurrogate = lastChar;
      return text.slice(0, -1);
    }

    return text;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /** Format buffer for Telegram MarkdownV2, falling back to plain text on failure. */
  private formatForTelegram(text: string): { text: string; parseMode?: 'MarkdownV2' } {
    if (this.formatFailed) return { text };
    try {
      return { text: escapeMarkdownV2(text), parseMode: 'MarkdownV2' };
    } catch {
      this.formatFailed = true;
      return { text };
    }
  }

  /** Whether draft mode is active for this message. */
  private shouldUseDraft(): boolean {
    return this.useDraft && this.isDM && this.draftAvailable !== false;
  }

  private async sendFirstMessage(): Promise<void> {
    // Try sendMessageDraft for DMs when configured
    if (this.shouldUseDraft() && this.draftAvailable === null) {
      try {
        this.draftId = Math.floor(Math.random() * 2_147_483_647);
        await this.callApi('sendMessageDraft', {
          chat_id: this.chatId,
          draft_id: this.draftId,
          text: this.buffer,
        });
        // Draft succeeded — no messageId (drafts are ephemeral)
        this.draftAvailable = true;
        this.lastEditedText = this.buffer;
        this.lastEditTime = Date.now();
        return;
      } catch (err) {
        // Method not available — fall back to regular sendMessage
        this.draftAvailable = false;
        this.draftId = null;
        console.log('[telegram] sendMessageDraft not available, falling back to sendMessage+editMessageText');
      }
    }

    if (this.shouldUseDraft() && this.draftAvailable === true) {
      // Draft already probed and available — send draft update
      try {
        await this.callApi('sendMessageDraft', {
          chat_id: this.chatId,
          draft_id: this.draftId,
          text: this.buffer,
        });
        this.lastEditedText = this.buffer;
        this.lastEditTime = Date.now();
        return;
      } catch {
        // Draft failed mid-stream — fall through to regular send
        this.draftAvailable = false;
      }
    }

    // Regular sendMessage flow
    try {
      const formatted = this.formatForTelegram(this.buffer);
      const response = await this.callApi('sendMessage', {
        chat_id: this.chatId,
        text: formatted.text,
        ...(formatted.parseMode ? { parse_mode: formatted.parseMode } : {}),
      });
      if (!response) {
        // Rate limited — reset so finalize() or next chunk can retry
        this.firstSendPromise = null;
        return;
      }
      const data = response as { result: { message_id: number } };
      this.messageId = data.result.message_id;
      this.lastEditedText = this.buffer;
      this.lastEditTime = Date.now();
    } catch {
      // Reset so finalize() can retry
      this.firstSendPromise = null;
    }
  }

  private scheduleEdit(): void {
    // Don't stack timers — one pending edit is enough
    if (this.editTimer !== null) return;

    const elapsed = Date.now() - this.lastEditTime;
    const delay = Math.max(0, this.editIntervalMs - elapsed);

    this.editTimer = setTimeout(() => {
      this.editTimer = null;
      this.flushEdit().catch(() => {});
    }, delay);
  }

  private async flushEdit(): Promise<void> {
    if (this.buffer.length === 0) return;
    if (this.buffer === this.lastEditedText) return;

    // Draft mode: update the draft preview
    if (this.draftAvailable === true && this.draftId !== null) {
      try {
        await this.callApi('sendMessageDraft', {
          chat_id: this.chatId,
          draft_id: this.draftId,
          text: this.buffer,
        });
        this.lastEditedText = this.buffer;
        this.lastEditTime = Date.now();
        return;
      } catch {
        // Draft broke mid-stream — fall through to regular edit
        this.draftAvailable = false;
      }
    }

    if (this.messageId === null) return;

    try {
      const formatted = this.formatForTelegram(this.buffer);
      await this.callApi('editMessageText', {
        chat_id: this.chatId,
        message_id: this.messageId,
        text: formatted.text,
        ...(formatted.parseMode ? { parse_mode: formatted.parseMode } : {}),
      });
      this.lastEditedText = this.buffer;
      this.lastEditTime = Date.now();
    } catch {
      // Silently continue — edit may fail if message not modified
    }
  }

  private async callApi(
    method: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const res = await fetch(
      `https://api.telegram.org/bot${this.botToken}/${method}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      // Rate limited — don't throw, the debounce timer will naturally retry
      if (res.status === 429) return null;

      // sendMessageDraft not available — signal via error so caller can fall back
      if ((res.status === 400 || res.status === 404) && method === 'sendMessageDraft') {
        throw new Error(`sendMessageDraft not available: ${res.status}`);
      }

      // MarkdownV2 parse error — retry with raw text (no escaping)
      if (res.status === 400 && body.parse_mode === 'MarkdownV2') {
        this.formatFailed = true;
        const plainBody = { ...body };
        delete plainBody.parse_mode;
        // Replace escaped text with raw buffer content
        if (typeof plainBody.text === 'string') {
          plainBody.text = this.buffer;
        }
        const retryRes = await fetch(
          `https://api.telegram.org/bot${this.botToken}/${method}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(plainBody),
          },
        );
        if (!retryRes.ok) {
          throw new Error(`Telegram ${method} failed: ${retryRes.status}`);
        }
        return retryRes.json();
      }

      throw new Error(`Telegram ${method} failed: ${res.status}`);
    }

    return res.json();
  }
}
