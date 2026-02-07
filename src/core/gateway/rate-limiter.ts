// ============================================================
// OpenClaw Deploy — Per-User Rate Limiter (Sliding Window)
// ============================================================

export class RateLimiter {
  private readonly windows = new Map<string, number[]>();

  constructor(
    private readonly maxRequests: number = 30,
    private readonly windowMs: number = 60_000,
  ) {}

  /**
   * Check if a request from this user is allowed.
   * Returns true if allowed, false if rate-limited.
   */
  isAllowed(userId: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    let timestamps = this.windows.get(userId);
    if (!timestamps) {
      timestamps = [];
      this.windows.set(userId, timestamps);
    }

    // Remove expired timestamps
    while (timestamps.length > 0 && timestamps[0] <= cutoff) {
      timestamps.shift();
    }

    if (timestamps.length >= this.maxRequests) {
      return false;
    }

    timestamps.push(now);
    return true;
  }

  /**
   * Get remaining requests for a user in the current window.
   */
  remaining(userId: string): number {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const timestamps = this.windows.get(userId);
    if (!timestamps) return this.maxRequests;

    const active = timestamps.filter((t) => t > cutoff);
    return Math.max(0, this.maxRequests - active.length);
  }

  /**
   * Clean up entries for users with no recent activity.
   */
  cleanup(): void {
    const cutoff = Date.now() - this.windowMs;
    for (const [userId, timestamps] of this.windows) {
      if (timestamps.length === 0 || timestamps[timestamps.length - 1] <= cutoff) {
        this.windows.delete(userId);
      }
    }
  }
}
