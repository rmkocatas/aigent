// ============================================================
// OpenClaw Deploy — Discord Streaming Editor
// ============================================================
// Manages progressive message editing during LLM streaming,
// sending the first chunk as a reply and debouncing subsequent
// edits to avoid Discord rate limits and flicker.
// ============================================================

import type { Message } from 'discord.js';

/** Convert snake_case tool name to readable form: "web_search" → "Web Search" */
function humanizeToolName(name: string): string {
  return name.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export interface DiscordStreamingOptions {
  throttleMs?: number;
  minCharsBeforeFirstSend?: number;
  minCharsBeforeEdit?: number;
}

export class DiscordStreamingEditor {
  private sentMessage: Message | null = null;
  private buffer = '';
  private lastEditedText = '';
  private lastEditTime = 0;
  private editTimer: ReturnType<typeof setTimeout> | null = null;
  private firstSendPromise: Promise<void> | null = null;
  private readonly editIntervalMs: number;
  private readonly minCharsBeforeEdit: number;
  private readonly minCharsBeforeFirstSend: number;
  private readonly maxMessageLength = 2000;
  private finalized = false;
  private toolStatusLine = '';
  private hasToolStatus = false;

  constructor(
    private readonly sourceMessage: Message,
    options?: DiscordStreamingOptions,
  ) {
    this.editIntervalMs = options?.throttleMs ?? 1500;
    this.minCharsBeforeFirstSend = options?.minCharsBeforeFirstSend ?? 20;
    this.minCharsBeforeEdit = options?.minCharsBeforeEdit ?? 40;
  }

  /** Get the full raw buffer (for post-finalize processing). */
  getBuffer(): string {
    return this.buffer;
  }

  /** Get the sent reply message (for post-finalize editing). */
  getSentMessage(): Message | null {
    return this.sentMessage;
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

      // Show tool status: either send a new message or edit the existing one
      if (this.sentMessage === null) {
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

    this.buffer += text;

    // Cap edits at maxMessageLength — remainder handled by finalize caller
    if (this.buffer.length > this.maxMessageLength && this.sentMessage !== null) {
      // Flush what we have, then stop editing (caller handles overflow)
      await this.flushEdit();
      return;
    }

    if (this.sentMessage === null) {
      if (this.buffer.length < this.minCharsBeforeFirstSend) {
        return;
      }
      if (this.firstSendPromise) return;
      this.firstSendPromise = this.sendFirstMessage();
    } else {
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

    if (this.editTimer !== null) {
      clearTimeout(this.editTimer);
      this.editTimer = null;
    }

    // Wait for any in-flight first-message send to complete
    if (this.firstSendPromise) {
      await this.firstSendPromise;
    }

    // If we never sent a first message (short response), send now
    if (this.sentMessage === null && this.buffer.length > 0) {
      try {
        const displayText = this.buffer.slice(0, this.maxMessageLength);
        this.sentMessage = await this.sourceMessage.reply(displayText);
        this.lastEditedText = displayText;
      } catch {
        // Silently continue
      }
      return;
    }

    // Final edit with complete text (only if it changed, capped at 2000)
    if (this.sentMessage !== null) {
      const displayText = this.buffer.slice(0, this.maxMessageLength);
      if (displayText !== this.lastEditedText) {
        try {
          await this.sentMessage.edit(displayText);
          this.lastEditedText = displayText;
        } catch {
          // Silently continue
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private async sendFirstMessage(): Promise<void> {
    try {
      const displayText = this.buffer.slice(0, this.maxMessageLength);
      this.sentMessage = await this.sourceMessage.reply(displayText);
      this.lastEditedText = displayText;
      this.lastEditTime = Date.now();
    } catch {
      // Reset so finalize() can retry
      this.firstSendPromise = null;
    }
  }

  private scheduleEdit(): void {
    if (this.editTimer !== null) return;

    const elapsed = Date.now() - this.lastEditTime;
    const delay = Math.max(0, this.editIntervalMs - elapsed);

    this.editTimer = setTimeout(() => {
      this.editTimer = null;
      this.flushEdit().catch(() => {});
    }, delay);
  }

  private async flushEdit(): Promise<void> {
    if (this.sentMessage === null || this.buffer.length === 0) return;

    const displayText = this.buffer.slice(0, this.maxMessageLength);
    if (displayText === this.lastEditedText) return;

    try {
      await this.sentMessage.edit(displayText);
      this.lastEditedText = displayText;
      this.lastEditTime = Date.now();
    } catch {
      // Silently continue — edit may fail if message not modified
    }
  }
}
