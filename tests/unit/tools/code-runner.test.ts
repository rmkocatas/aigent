import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { codeRunnerHandler } from '../../../src/core/tools/builtins/code-runner.js';
import type { ToolContext } from '../../../src/core/tools/registry.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let workDir: string;
let context: ToolContext;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'coderunner-'));
  context = {
    workspaceDir: workDir,
    memoryDir: workDir,
    conversationId: 'test',
    userId: 'test-user',
    maxExecutionMs: 10000,
  };
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

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

  it('blocks filesystem writes outside workspace', async () => {
    const result = await codeRunnerHandler(
      { language: 'javascript', code: 'const fs=require("fs");try{fs.writeFileSync("/tmp/test.txt","hack")}catch(e){console.log("BLOCKED:"+e.code)}' },
      context,
    );
    expect(result).toContain('BLOCKED:');
  });

  it('blocks child process spawning', async () => {
    const result = await codeRunnerHandler(
      { language: 'javascript', code: 'const{execSync}=require("child_process");try{execSync("echo hi")}catch(e){console.log("BLOCKED:"+e.code)}' },
      context,
    );
    expect(result).toContain('BLOCKED:');
  });

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
