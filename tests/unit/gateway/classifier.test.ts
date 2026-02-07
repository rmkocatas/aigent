import { describe, it, expect } from 'vitest';
import { classifyPrompt } from '../../../src/core/gateway/classifier.js';

describe('classifyPrompt', () => {
  // --- Coding ---
  it('classifies code fence as coding', () => {
    const result = classifyPrompt('How do I fix this?\n```js\nconsole.log(x)\n```');
    expect(result.classification).toBe('coding');
  });

  it('classifies multiple code keywords as coding', () => {
    const result = classifyPrompt('Can you refactor my async function to use import?');
    expect(result.classification).toBe('coding');
  });

  it('classifies single code keyword in long text as coding', () => {
    const msg = 'I have a really complex ' + 'problem '.repeat(20) + 'with my function that returns wrong results.';
    const result = classifyPrompt(msg);
    expect(result.classification).toBe('coding');
  });

  it('classifies debug request as coding', () => {
    const result = classifyPrompt('Help me debug this error in my TypeScript code');
    expect(result.classification).toBe('coding');
  });

  it('classifies docker question as coding', () => {
    const result = classifyPrompt('How do I deploy with docker and npm?');
    expect(result.classification).toBe('coding');
  });

  // --- Simple ---
  it('classifies greeting as simple', () => {
    const result = classifyPrompt('Hello!');
    expect(result.classification).toBe('simple');
  });

  it('classifies short factual question as simple', () => {
    const result = classifyPrompt('What is the capital of France?');
    expect(result.classification).toBe('simple');
  });

  it('classifies thanks as simple', () => {
    const result = classifyPrompt('Thank you!');
    expect(result.classification).toBe('simple');
  });

  it('classifies yes/no as simple', () => {
    expect(classifyPrompt('yes').classification).toBe('simple');
    expect(classifyPrompt('no').classification).toBe('simple');
  });

  it('classifies "who is" question as simple', () => {
    const result = classifyPrompt('Who is Albert Einstein?');
    expect(result.classification).toBe('simple');
  });

  // --- Complex ---
  it('classifies reasoning request as complex', () => {
    const result = classifyPrompt('Can you analyze the pros and cons of microservices?');
    expect(result.classification).toBe('complex');
  });

  it('classifies long message as complex', () => {
    const msg = 'Please help me understand ' + 'this topic in detail. '.repeat(30);
    const result = classifyPrompt(msg);
    expect(result.classification).toBe('complex');
  });

  it('classifies "explain why" as complex', () => {
    const result = classifyPrompt('Can you explain why the sky is blue in depth with scientific reasoning?');
    expect(result.classification).toBe('complex');
  });

  // --- Tool keywords → complex ---
  it('classifies search request as complex', () => {
    const result = classifyPrompt('Search for Python tutorials');
    expect(result.classification).toBe('complex');
  });

  it('classifies remind request as complex', () => {
    const result = classifyPrompt('Remind me in 5 minutes to check the oven');
    expect(result.classification).toBe('complex');
  });

  it('classifies check project request as complex', () => {
    const result = classifyPrompt('Check my project in the downloads folder');
    expect(result.classification).toBe('complex');
  });

  it('classifies weather request as complex (tool keyword)', () => {
    const result = classifyPrompt('What is the weather today?');
    expect(result.classification).toBe('complex');
  });

  it('classifies calculate request as complex', () => {
    const result = classifyPrompt('Calculate 15% tip on $85');
    expect(result.classification).toBe('complex');
  });

  // --- Default ---
  it('classifies medium-length non-specific text as default', () => {
    const result = classifyPrompt('Tell me something interesting about penguins today');
    expect(result.classification).toBe('default');
  });

  it('classifies empty message as simple', () => {
    const result = classifyPrompt('');
    expect(result.classification).toBe('simple');
  });

  // --- Confidence and signals ---
  it('returns confidence between 0 and 1', () => {
    const result = classifyPrompt('Hello');
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('returns signals array', () => {
    const result = classifyPrompt('Hello');
    expect(Array.isArray(result.signals)).toBe(true);
    expect(result.signals.length).toBeGreaterThan(0);
  });
});
