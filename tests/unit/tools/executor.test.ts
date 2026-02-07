import { describe, it, expect } from 'vitest';
import { executeToolCall } from '../../../src/core/tools/executor.js';
import { ToolRegistry } from '../../../src/core/tools/registry.js';
import type { ToolUseBlock, ToolsConfig } from '../../../src/types/index.js';
import type { ToolContext } from '../../../src/core/tools/registry.js';

const config: ToolsConfig = {
  deny: [],
  sandboxMode: 'off',
  workspaceDir: '/tmp/workspace',
  maxExecutionMs: 5000,
};

const context: ToolContext = {
  workspaceDir: '/tmp/workspace',
  memoryDir: '/tmp/memory',
  conversationId: 'test',
  userId: 'test-user',
  maxExecutionMs: 5000,
};

describe('executeToolCall', () => {
  it('executes a registered tool', async () => {
    const registry = new ToolRegistry();
    registry.register(
      { name: 'echo', description: 'Echo', parameters: { type: 'object', properties: {} } },
      async (input) => `echoed: ${input.text}`,
    );

    const result = await executeToolCall(
      { type: 'tool_use', id: 'test1', name: 'echo', input: { text: 'hello' } },
      registry,
      config,
      context,
    );

    expect(result.output).toBe('echoed: hello');
    expect(result.is_error).toBe(false);
    expect(result.tool_use_id).toBe('test1');
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('returns error for unknown tool', async () => {
    const registry = new ToolRegistry();

    const result = await executeToolCall(
      { type: 'tool_use', id: 'test2', name: 'nonexistent', input: {} },
      registry,
      config,
      context,
    );

    expect(result.is_error).toBe(true);
    expect(result.output).toContain('Unknown tool');
  });

  it('returns error for denied tool', async () => {
    const registry = new ToolRegistry();
    registry.register(
      { name: 'blocked', description: 'Blocked', parameters: { type: 'object', properties: {} } },
      async () => 'result',
    );

    const result = await executeToolCall(
      { type: 'tool_use', id: 'test3', name: 'blocked', input: {} },
      registry,
      { ...config, deny: ['blocked'] },
      context,
    );

    expect(result.is_error).toBe(true);
    expect(result.output).toContain('not allowed');
  });

  it('catches handler errors', async () => {
    const registry = new ToolRegistry();
    registry.register(
      { name: 'failing', description: 'Fails', parameters: { type: 'object', properties: {} } },
      async () => { throw new Error('boom'); },
    );

    const result = await executeToolCall(
      { type: 'tool_use', id: 'test4', name: 'failing', input: {} },
      registry,
      config,
      context,
    );

    expect(result.is_error).toBe(true);
    expect(result.output).toBe('boom');
  });

  it('times out long-running tools', async () => {
    const registry = new ToolRegistry();
    registry.register(
      { name: 'slow', description: 'Slow', parameters: { type: 'object', properties: {} } },
      async () => {
        await new Promise((r) => setTimeout(r, 10000));
        return 'done';
      },
    );

    const shortContext = { ...context, maxExecutionMs: 100 };
    const result = await executeToolCall(
      { type: 'tool_use', id: 'test5', name: 'slow', input: {} },
      registry,
      config,
      shortContext,
    );

    expect(result.is_error).toBe(true);
    expect(result.output).toContain('timed out');
  });
});
