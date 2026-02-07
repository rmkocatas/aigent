import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../../../src/core/tools/registry.js';
import type { ToolDefinition, ToolsConfig } from '../../../src/types/index.js';

const testTool: ToolDefinition = {
  name: 'test_tool',
  description: 'A test tool',
  parameters: {
    type: 'object',
    properties: {
      input: { type: 'string', description: 'Test input' },
    },
    required: ['input'],
  },
};

const defaultConfig: ToolsConfig = {
  deny: [],
  sandboxMode: 'off',
  workspaceDir: '/tmp/workspace',
  maxExecutionMs: 30000,
};

describe('ToolRegistry', () => {
  it('registers and retrieves tools', () => {
    const registry = new ToolRegistry();
    const handler = async () => 'result';
    registry.register(testTool, handler);

    expect(registry.allToolNames).toContain('test_tool');
    expect(registry.getHandler('test_tool')).toBe(handler);
  });

  it('returns undefined for unknown tools', () => {
    const registry = new ToolRegistry();
    expect(registry.getHandler('nonexistent')).toBeUndefined();
  });

  it('filters tools by deny list', () => {
    const registry = new ToolRegistry();
    registry.register(testTool, async () => 'ok');
    registry.register(
      { ...testTool, name: 'blocked_tool' },
      async () => 'ok',
    );

    const config = { ...defaultConfig, deny: ['blocked_tool'] };
    const available = registry.getAvailableTools(config);

    expect(available).toHaveLength(1);
    expect(available[0].name).toBe('test_tool');
  });

  it('filters tools by allow list', () => {
    const registry = new ToolRegistry();
    registry.register(testTool, async () => 'ok');
    registry.register(
      { ...testTool, name: 'other_tool' },
      async () => 'ok',
    );

    const config = { ...defaultConfig, allow: ['test_tool'] };
    const available = registry.getAvailableTools(config);

    expect(available).toHaveLength(1);
    expect(available[0].name).toBe('test_tool');
  });

  it('deny takes priority over allow', () => {
    const registry = new ToolRegistry();
    registry.register(testTool, async () => 'ok');

    const config = {
      ...defaultConfig,
      deny: ['test_tool'],
      allow: ['test_tool'],
    };
    const available = registry.getAvailableTools(config);

    expect(available).toHaveLength(0);
  });

  it('hides defaultDenied tools unless explicitly allowed', () => {
    const registry = new ToolRegistry();
    registry.register(testTool, async () => 'ok', { defaultDenied: true });

    // Without allow list
    let available = registry.getAvailableTools(defaultConfig);
    expect(available).toHaveLength(0);

    // With allow list
    const config = { ...defaultConfig, allow: ['test_tool'] };
    available = registry.getAvailableTools(config);
    expect(available).toHaveLength(1);
  });

  it('returns all tools when no deny/allow', () => {
    const registry = new ToolRegistry();
    registry.register(testTool, async () => 'ok');
    registry.register({ ...testTool, name: 'tool2' }, async () => 'ok');

    const available = registry.getAvailableTools(defaultConfig);
    expect(available).toHaveLength(2);
  });
});
