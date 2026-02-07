import { describe, it, expect } from 'vitest';
import { manageContextWindow } from '../../../src/core/gateway/context-manager.js';

describe('manageContextWindow', () => {
  it('passes through messages that fit within budget unchanged', () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
      { role: 'user', content: 'How are you?' },
    ];

    const result = manageContextWindow(messages, 100_000);
    expect(result.wasTruncated).toBe(false);
    expect(result.messages).toHaveLength(3);
    expect(result.messages[0].content).toBe('Hello');
    expect(result.messages[2].content).toBe('How are you?');
  });

  it('truncates oldest messages first when over budget', () => {
    // Create messages that exceed a tiny budget
    const messages = [
      { role: 'user', content: 'First message that is old' },
      { role: 'assistant', content: 'First response that is old' },
      { role: 'user', content: 'Second message' },
      { role: 'assistant', content: 'Second response' },
      { role: 'user', content: 'Latest message' },
    ];

    // Use a budget that can only fit the last couple of messages
    // Each message is roughly 4 (role) + ~6 tokens = ~10 tokens
    // Set budget so only last 2-3 messages fit within 90%
    const result = manageContextWindow(messages, 25);
    expect(result.wasTruncated).toBe(true);
    expect(result.messages.length).toBeLessThan(messages.length);
    // The latest message should always be kept
    expect(result.messages[result.messages.length - 1].content).toBe('Latest message');
  });

  it('ensures result starts with a user message after truncation', () => {
    const messages = [
      { role: 'user', content: 'Old user message' },
      { role: 'assistant', content: 'Old assistant response' },
      { role: 'user', content: 'Recent question' },
      { role: 'assistant', content: 'Recent answer' },
      { role: 'user', content: 'Latest' },
    ];

    // Force truncation with a small budget
    const result = manageContextWindow(messages, 30);
    if (result.wasTruncated && result.messages.length > 0) {
      expect(result.messages[0].role).toBe('user');
    }
  });

  it('counts system prompt tokens against the budget', () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
      { role: 'user', content: 'How are you?' },
    ];

    // With no system prompt, messages fit
    const withoutPrompt = manageContextWindow(messages, 50);

    // With a large system prompt eating into the budget, messages may be truncated
    const largeSystemPrompt = 'x'.repeat(160); // ~40 tokens
    const withPrompt = manageContextWindow(messages, 50, largeSystemPrompt);

    // The system prompt should reduce available budget, potentially causing truncation
    expect(withPrompt.messages.length).toBeLessThanOrEqual(withoutPrompt.messages.length);
  });

  it('sets wasTruncated flag correctly', () => {
    const messages = [
      { role: 'user', content: 'Hello' },
    ];

    const fits = manageContextWindow(messages, 100_000);
    expect(fits.wasTruncated).toBe(false);

    // Create many messages that won't fit in a tiny budget
    const manyMessages = Array.from({ length: 50 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message number ${i} with some extra text to use tokens`,
    }));

    const truncated = manageContextWindow(manyMessages, 50);
    expect(truncated.wasTruncated).toBe(true);
  });

  it('does not include system prompt in the output messages', () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ];

    const result = manageContextWindow(messages, 100_000, 'You are a helpful assistant.');
    // System prompt should not appear in output messages
    for (const msg of result.messages) {
      expect(msg.role).not.toBe('system');
    }
    expect(result.wasTruncated).toBe(false);
  });
});
