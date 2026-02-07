import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from '../../../src/core/gateway/rate-limiter.js';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests within limit', () => {
    const limiter = new RateLimiter(3, 60_000);
    expect(limiter.isAllowed('user1')).toBe(true);
    expect(limiter.isAllowed('user1')).toBe(true);
    expect(limiter.isAllowed('user1')).toBe(true);
  });

  it('blocks requests over limit', () => {
    const limiter = new RateLimiter(3, 60_000);
    limiter.isAllowed('user1');
    limiter.isAllowed('user1');
    limiter.isAllowed('user1');
    expect(limiter.isAllowed('user1')).toBe(false);
  });

  it('tracks users independently', () => {
    const limiter = new RateLimiter(2, 60_000);
    limiter.isAllowed('user1');
    limiter.isAllowed('user1');
    expect(limiter.isAllowed('user1')).toBe(false);
    expect(limiter.isAllowed('user2')).toBe(true);
  });

  it('resets after window expires', () => {
    const limiter = new RateLimiter(2, 60_000);
    limiter.isAllowed('user1');
    limiter.isAllowed('user1');
    expect(limiter.isAllowed('user1')).toBe(false);

    vi.advanceTimersByTime(61_000);
    expect(limiter.isAllowed('user1')).toBe(true);
  });

  it('reports remaining correctly', () => {
    const limiter = new RateLimiter(5, 60_000);
    expect(limiter.remaining('user1')).toBe(5);
    limiter.isAllowed('user1');
    limiter.isAllowed('user1');
    expect(limiter.remaining('user1')).toBe(3);
  });

  it('cleanup removes expired entries', () => {
    const limiter = new RateLimiter(5, 60_000);
    limiter.isAllowed('old-user');
    vi.advanceTimersByTime(61_000);
    limiter.cleanup();
    expect(limiter.remaining('old-user')).toBe(5);
  });
});
