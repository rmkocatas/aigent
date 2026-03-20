// ============================================================
// OpenClaw Deploy — Tool Registry
// ============================================================

import type { ToolDefinition, ToolsConfig, ToolCategory, GeneratedFile, PromptClassification } from '../../types/index.js';

export interface ToolContext {
  workspaceDir: string;
  memoryDir: string;
  conversationId: string;
  userId: string;
  maxExecutionMs: number;
  allowedProjectDirs?: string[];
  /** Mutable array — tools can push files here for delivery to the user */
  collectedFiles?: GeneratedFile[];
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

/**
 * Maps prompt classification to which tool categories should be included.
 * 'all' = send every tool; empty array = send no tools (stays on Ollama).
 */
const CLASSIFICATION_TOOL_FILTER: Record<PromptClassification, ToolCategory[] | 'all'> = {
  simple:      [],                                          // no tools → stays on Ollama (free)
  default:     [],                                          // no tools → stays on Ollama (free)
  tool_simple: 'all',                                                    // all tools on cheap Haiku
  coding:      ['core', 'file', 'code', 'data', 'memory', 'marketplace'], // skip web, notes, reminders, media
  web_content: ['core', 'file', 'web', 'memory', 'marketplace'],          // skip code, data, notes, reminders, media
  complex:     'all',                                                     // all tools on Sonnet
};

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(
    definition: ToolDefinition,
    handler: ToolHandler,
    options?: { defaultDenied?: boolean; categories?: ToolCategory[] },
  ): void {
    const def = options?.categories
      ? { ...definition, categories: options.categories }
      : definition;
    this.tools.set(def.name, {
      definition: def,
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

  /**
   * Returns available tools with routing hints baked into descriptions.
   * The LLM sees enriched descriptions for better tool selection.
   */
  getFormattedTools(config: ToolsConfig): ToolDefinition[] {
    const tools = this.getAvailableTools(config);
    return tools.map((tool) => {
      if (!tool.routing) return tool;
      let desc = tool.description;
      if (tool.routing.useWhen?.length) {
        desc += '\nUSE WHEN: ' + tool.routing.useWhen.join('; ');
      }
      if (tool.routing.avoidWhen?.length) {
        desc += '\nAVOID WHEN: ' + tool.routing.avoidWhen.join('; ');
      }
      return { ...tool, description: desc };
    });
  }

  /**
   * Returns tools filtered by prompt classification.
   * Simple/default → 0 tools (query stays on Ollama).
   * Coding/web → subset of relevant categories.
   * Complex/tool_simple → all tools.
   */
  getFilteredTools(config: ToolsConfig, classification: PromptClassification): ToolDefinition[] {
    const filter = CLASSIFICATION_TOOL_FILTER[classification];
    if (filter === 'all') {
      return this.getFormattedTools(config);
    }
    if (filter.length === 0) {
      return [];
    }
    return this.getFormattedTools(config).filter(
      (t) => t.categories?.some((c) => filter.includes(c)) ?? false,
    );
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
