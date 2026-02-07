// ============================================================
// OpenClaw Deploy — Telegram Streaming Editor
// ============================================================
// Manages progressive message editing during LLM streaming,
// sending the first chunk as a new message and debouncing
// subsequent edits to avoid Telegram rate limits.
// ============================================================

export class TelegramStreamingEditor {
  private messageId: number | null = null;
  private buffer = '';
  private lastEditTime = 0;
  private editTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly editIntervalMs = 1500;
  private readonly maxMessageLength = 4000;
  private finalized = false;

  constructor(
    private readonly chatId: number,
    private readonly botToken: string,
  ) {}

  async addChunk(text: string): Promise<void> {
    if (this.finalized) return;

    this.buffer += text;

    // If content exceeds max length, finalize current message and start fresh
    if (this.buffer.length > this.maxMessageLength && this.messageId !== null) {
      await this.flushEdit();
      this.messageId = null;
      this.buffer = '';
      // The overflow text starts a new message on the next chunk
      // We keep the current chunk's text that caused the overflow
      // by not returning early — next addChunk will send a new message
      return;
    }

    if (this.messageId === null) {
      // First chunk → send a new message
      try {
        const response = await this.callApi('sendMessage', {
          chat_id: this.chatId,
          text: this.buffer,
        });
        const data = response as { result: { message_id: number } };
        this.messageId = data.result.message_id;
        this.lastEditTime = Date.now();
      } catch {
        // Silently continue — message sending failed
      }
    } else {
      // Subsequent chunks → debounced edit
      this.scheduleEdit();
    }
  }

  async finalize(): Promise<void> {
    if (this.finalized) return;
    this.finalized = true;

    // Clear any pending timer
    if (this.editTimer !== null) {
      clearTimeout(this.editTimer);
      this.editTimer = null;
    }

    // Final edit with complete text
    if (this.messageId !== null && this.buffer.length > 0) {
      await this.flushEdit();
    }
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private scheduleEdit(): void {
    // If a timer is already pending, reset it
    if (this.editTimer !== null) {
      clearTimeout(this.editTimer);
      this.editTimer = null;
    }

    const elapsed = Date.now() - this.lastEditTime;
    const delay = Math.max(0, this.editIntervalMs - elapsed);

    this.editTimer = setTimeout(() => {
      this.editTimer = null;
      this.flushEdit().catch(() => {});
    }, delay);
  }

  private async flushEdit(): Promise<void> {
    if (this.messageId === null || this.buffer.length === 0) return;

    try {
      await this.callApi('editMessageText', {
        chat_id: this.chatId,
        message_id: this.messageId,
        text: this.buffer,
      });
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
      throw new Error(`Telegram ${method} failed: ${res.status}`);
    }

    return res.json();
  }
}
