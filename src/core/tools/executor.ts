// ============================================================
// OpenClaw Deploy — Tool Executor
// ============================================================

import type { ToolUseBlock, ToolExecutionResult, ToolsConfig } from '../../types/index.js';
import type { ToolRegistry, ToolContext } from './registry.js';

// ---------------------------------------------------------------------------
// Shell injection preflight — detect likely injection tokens in string inputs
// ---------------------------------------------------------------------------

/** Tokens that indicate shell variable injection or command substitution. */
const INJECTION_PATTERNS = [
  /\$\(/,       // $( command substitution
  /\$\{/,       // ${ variable expansion
  /`[^`]+`/,    // backtick command substitution
  /\$[A-Z_]/i,  // $VAR references
  /;\s*(rm|cat|curl|wget|nc|bash|sh|cmd|powershell)\b/i, // command chaining
  /\|\s*(bash|sh|cmd|powershell)/i, // pipe to shell
];

/** Tools whose string inputs should be scanned for injection. */
const INJECTION_SCAN_TOOLS = new Set([
  'install_package',
  'run_code',
  'git_diff_review',
  'dep_audit',
  'generate_tests',
]);

function checkShellInjection(toolName: string, input: Record<string, unknown>): string | null {
  if (!INJECTION_SCAN_TOOLS.has(toolName)) return null;

  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'string') continue;
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(value)) {
        return `Shell injection blocked: parameter "${key}" contains suspicious token matching ${pattern}`;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

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

  // Shell injection preflight — block inputs with command substitution tokens
  const injectionError = checkShellInjection(toolUse.name, toolUse.input);
  if (injectionError) {
    console.warn(`[security] ${injectionError} in tool ${toolUse.name}`);
    return {
      tool_use_id: toolUse.id,
      output: injectionError,
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
