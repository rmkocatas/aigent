import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApprovalManager } from '../../../src/core/services/approval-manager.js';

describe('ApprovalManager', () => {
  let manager: ApprovalManager;
  let sendFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new ApprovalManager();
    sendFn = vi.fn(async () => {});
    manager.setSendFunction(sendFn);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Helper to flush microtask queue so that awaited promises inside
  // requestApproval can resolve (the sendFn mock resolves asynchronously)
  async function flushMicrotasks(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
  }

  it('requestApproval sends formatted message', async () => {
    const promise = manager.requestApproval('user1', 12345, 'deploy', 'Deploy to production');
    await flushMicrotasks();

    expect(sendFn).toHaveBeenCalledOnce();
    const sentText = sendFn.mock.calls[0][1] as string;
    expect(sentText).toContain('Approval Required');
    expect(sentText).toContain('Action: deploy');
    expect(sentText).toContain('Deploy to production');
    expect(sentText).toContain('/approve');
    expect(sentText).toContain('/deny');
    expect(sentText).toContain('5 minutes');
    expect(sendFn.mock.calls[0][0]).toBe(12345);

    // Clean up: resolve the pending approval
    manager.handleResponse('user1', true);
    await promise;
  });

  it('handleResponse with approve resolves promise with approved', async () => {
    const promise = manager.requestApproval('user1', 12345, 'deploy', 'Details');
    await flushMicrotasks();

    const handled = manager.handleResponse('user1', true);
    expect(handled).toBe(true);

    const result = await promise;
    expect(result).toBe('approved');
  });

  it('handleResponse with deny resolves promise with denied', async () => {
    const promise = manager.requestApproval('user1', 12345, 'deploy', 'Details');
    await flushMicrotasks();

    const handled = manager.handleResponse('user1', false);
    expect(handled).toBe(true);

    const result = await promise;
    expect(result).toBe('denied');
  });

  it('timeout auto-denies after 5 minutes', async () => {
    const promise = manager.requestApproval('user1', 12345, 'deploy', 'Details');
    await flushMicrotasks();

    // Advance time by 5 minutes
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    const result = await promise;
    expect(result).toBe('timeout');

    // Should have sent a timeout message
    expect(sendFn).toHaveBeenCalledTimes(2);
    const timeoutMsg = sendFn.mock.calls[1][1] as string;
    expect(timeoutMsg).toContain('timed out');
    expect(timeoutMsg).toContain('cancelled');
  });

  it('only one pending approval per user — second is auto-denied', async () => {
    const promise1 = manager.requestApproval('user1', 12345, 'deploy', 'First');
    await flushMicrotasks();

    const result2 = await manager.requestApproval('user1', 12345, 'delete', 'Second');

    expect(result2).toBe('denied');

    // First should still be pending
    expect(manager.hasPending('user1')).toBe(true);

    // Clean up
    manager.handleResponse('user1', true);
    await promise1;
  });

  it('hasPending returns true when user has pending approval', async () => {
    expect(manager.hasPending('user1')).toBe(false);

    const promise = manager.requestApproval('user1', 12345, 'deploy', 'Details');
    await flushMicrotasks();

    expect(manager.hasPending('user1')).toBe(true);

    manager.handleResponse('user1', true);
    await promise;

    expect(manager.hasPending('user1')).toBe(false);
  });

  it('getPending returns the pending approval for a user', async () => {
    expect(manager.getPending('user1')).toBeUndefined();

    const promise = manager.requestApproval('user1', 12345, 'deploy', 'Some details');
    await flushMicrotasks();

    const pending = manager.getPending('user1');
    expect(pending).toBeDefined();
    expect(pending!.userId).toBe('user1');
    expect(pending!.chatId).toBe(12345);
    expect(pending!.action).toBe('deploy');
    expect(pending!.details).toBe('Some details');

    manager.handleResponse('user1', true);
    await promise;
  });

  it('handleResponse returns false when no pending approval exists', () => {
    const handled = manager.handleResponse('nonexistent', true);
    expect(handled).toBe(false);
  });

  it('timeout removes user from pending map', async () => {
    const promise = manager.requestApproval('user1', 12345, 'deploy', 'Details');
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    await promise;

    expect(manager.hasPending('user1')).toBe(false);
    expect(manager.getPending('user1')).toBeUndefined();
  });

  it('handleResponse clears the timeout timer', async () => {
    const promise = manager.requestApproval('user1', 12345, 'deploy', 'Details');
    await flushMicrotasks();

    manager.handleResponse('user1', true);
    await promise;

    // Advance time past 5 minutes — should not trigger timeout
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    // Only the initial request message should have been sent (no timeout message)
    expect(sendFn).toHaveBeenCalledOnce();
  });

  it('works with string chatId', async () => {
    const promise = manager.requestApproval('user1', '12345', 'deploy', 'Details');
    await flushMicrotasks();

    expect(sendFn.mock.calls[0][0]).toBe(12345);

    manager.handleResponse('user1', true);
    await promise;
  });

  it('works without a send function set', async () => {
    const noSendManager = new ApprovalManager();
    const promise = noSendManager.requestApproval('user1', 12345, 'deploy', 'Details');
    await flushMicrotasks();

    // Should not throw, even without sendFn
    noSendManager.handleResponse('user1', true);
    const result = await promise;
    expect(result).toBe('approved');
  });
});
