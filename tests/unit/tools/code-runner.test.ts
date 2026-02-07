import { describe, it, expect } from 'vitest';
import { codeRunnerHandler } from '../../../src/core/tools/builtins/code-runner.js';
import type { ToolContext } from '../../../src/core/tools/registry.js';
import { tmpdir } from 'node:os';

const context: ToolContext = {
  workspaceDir: tmpdir(),
  memoryDir: tmpdir(),
  conversationId: 'test',
  userId: 'test-user',
  maxExecutionMs: 10000,
};

describe('run_code tool', () => {
  it('executes javascript', async () => {
    const result = await codeRunnerHandler(
      { language: 'javascript', code: 'console.log(2 + 3)' },
      context,
    );
    expect(result.trim()).toBe('5');
  });

  it('captures stderr for javascript errors', async () => {
    const result = await codeRunnerHandler(
      { language: 'javascript', code: 'throw new Error("test error")' },
      context,
    );
    expect(result).toContain('test error');
  });

  it('times out long-running code', async () => {
    const shortContext = { ...context, maxExecutionMs: 500 };
    const result = await codeRunnerHandler(
      { language: 'javascript', code: 'while(true){}' },
      shortContext,
    );
    expect(result).toContain('timed out');
  }, 10000);

  it('rejects unsupported language', async () => {
    await expect(
      codeRunnerHandler({ language: 'ruby', code: 'puts 1' }, context),
    ).rejects.toThrow('Unsupported language');
  });

  it('rejects missing code', async () => {
    await expect(
      codeRunnerHandler({ language: 'javascript', code: '' }, context),
    ).rejects.toThrow('Missing code');
  });

  it('rejects overly long code', async () => {
    await expect(
      codeRunnerHandler({ language: 'javascript', code: 'x'.repeat(11000) }, context),
    ).rejects.toThrow('too long');
  });
});
