// ============================================================
// OpenClaw Deploy — Tool Registry
// ============================================================

import type { ToolDefinition, ToolsConfig } from '../../types/index.js';

export interface ToolContext {
  workspaceDir: string;
  memoryDir: string;
  conversationId: string;
  userId: string;
  maxExecutionMs: number;
  allowedProjectDirs?: string[];
}

export type ToolHandler = (
  input: Record<string, unknown>,
  context: ToolContext,
) => Promise<string>;

interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
  defaultDenied?: boolean;
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(
    definition: ToolDefinition,
    handler: ToolHandler,
    options?: { defaultDenied?: boolean },
  ): void {
    this.tools.set(definition.name, {
      definition,
      handler,
      defaultDenied: options?.defaultDenied,
    });
  }

  getAvailableTools(config: ToolsConfig): ToolDefinition[] {
    const result: ToolDefinition[] = [];
    for (const [name, tool] of this.tools) {
      if (this.isToolAllowed(name, config, tool.defaultDenied)) {
        result.push(tool.definition);
      }
    }
    return result;
  }

  getHandler(name: string): ToolHandler | undefined {
    return this.tools.get(name)?.handler;
  }

  isToolAllowed(
    name: string,
    config: ToolsConfig,
    defaultDenied?: boolean,
  ): boolean {
    // Explicit deny list takes priority
    if (config.deny.includes(name)) return false;

    // If tool is denied by default, it must be explicitly allowed
    if (defaultDenied) {
      return config.allow?.includes(name) ?? false;
    }

    // If there's an allow list, tool must be in it
    if (config.allow && config.allow.length > 0) {
      return config.allow.includes(name);
    }

    return true;
  }

  get allToolNames(): string[] {
    return [...this.tools.keys()];
  }
}
