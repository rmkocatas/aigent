// ============================================================
// OpenClaw Deploy — Approval Manager Service
// ============================================================

export interface PendingApproval {
  id: string;
  userId: string;
  chatId: number | string;
  action: string;
  details: string;
  resolve: (result: 'approved' | 'denied' | 'timeout') => void;
  timer: ReturnType<typeof setTimeout>;
}

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export class ApprovalManager {
  private pending = new Map<string, PendingApproval>();
  private sendFn: ((chatId: number, text: string) => Promise<void>) | null = null;

  setSendFunction(fn: (chatId: number, text: string) => Promise<void>): void {
    this.sendFn = fn;
  }

  async requestApproval(
    userId: string,
    chatId: number | string,
    action: string,
    details: string,
  ): Promise<'approved' | 'denied' | 'timeout'> {
    // If user already has a pending approval, auto-deny the new one
    if (this.pending.has(userId)) {
      return 'denied';
    }

    // Send formatted message to Telegram
    const message = [
      '\u{1F512} Approval Required',
      '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500',
      `Action: ${action}`,
      '',
      details,
      '',
      'Reply /approve to allow or /deny to cancel.',
      'Auto-denies in 5 minutes.',
    ].join('\n');

    if (this.sendFn) {
      const numericChatId = typeof chatId === 'string' ? Number(chatId) : chatId;
      await this.sendFn(numericChatId, message);
    }

    // Create a Promise that resolves when user replies or on timeout
    return new Promise<'approved' | 'denied' | 'timeout'>((resolve) => {
      const id = `${userId}-${Date.now()}`;

      const timer = setTimeout(() => {
        const entry = this.pending.get(userId);
        if (entry) {
          this.pending.delete(userId);
          // Send timeout message
          if (this.sendFn) {
            const numericChatId = typeof chatId === 'string' ? Number(chatId) : chatId;
            this.sendFn(numericChatId, 'Approval timed out, action cancelled.').catch(() => {});
          }
          resolve('timeout');
        }
      }, TIMEOUT_MS);

      const approval: PendingApproval = {
        id,
        userId,
        chatId,
        action,
        details,
        resolve,
        timer,
      };

      this.pending.set(userId, approval);
    });
  }

  handleResponse(userId: string, approved: boolean): boolean {
    const entry = this.pending.get(userId);
    if (!entry) {
      return false;
    }

    clearTimeout(entry.timer);
    this.pending.delete(userId);
    entry.resolve(approved ? 'approved' : 'denied');
    return true;
  }

  getPending(userId: string): PendingApproval | undefined {
    return this.pending.get(userId);
  }

  hasPending(userId: string): boolean {
    return this.pending.has(userId);
  }
}
