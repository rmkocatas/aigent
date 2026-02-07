// ============================================================
// OpenClaw Deploy — Tool Executor
// ============================================================

import type { ToolUseBlock, ToolExecutionResult, ToolsConfig } from '../../types/index.js';
import type { ToolRegistry, ToolContext } from './registry.js';

export async function executeToolCall(
  toolUse: ToolUseBlock,
  registry: ToolRegistry,
  config: ToolsConfig,
  context: ToolContext,
): Promise<ToolExecutionResult> {
  const start = Date.now();

  // Check if tool exists
  const handler = registry.getHandler(toolUse.name);
  if (!handler) {
    return {
      tool_use_id: toolUse.id,
      output: `Unknown tool: ${toolUse.name}`,
      is_error: true,
      duration_ms: Date.now() - start,
    };
  }

  // Check permission
  if (!registry.isToolAllowed(toolUse.name, config)) {
    return {
      tool_use_id: toolUse.id,
      output: `Tool "${toolUse.name}" is not allowed by the current configuration`,
      is_error: true,
      duration_ms: Date.now() - start,
    };
  }

  // Execute with timeout
  try {
    const result = await Promise.race([
      handler(toolUse.input, context),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Tool "${toolUse.name}" timed out after ${context.maxExecutionMs}ms`)),
          context.maxExecutionMs,
        ),
      ),
    ]);

    return {
      tool_use_id: toolUse.id,
      output: result,
      is_error: false,
      duration_ms: Date.now() - start,
    };
  } catch (err) {
    return {
      tool_use_id: toolUse.id,
      output: err instanceof Error ? err.message : String(err),
      is_error: true,
      duration_ms: Date.now() - start,
    };
  }
}
