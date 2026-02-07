// ============================================================
// OpenClaw Deploy — Transport-Agnostic Chat Pipeline
// ============================================================

import type {
  GatewayRuntimeConfig,
  ChatMessage,
  PromptClassification,
  ContentBlock,
  ImageBlock,
  ToolUseBlock,
  ToolDefinition,
} from '../../types/index.js';
import type { SessionStore } from './session-store.js';
import type { TrainingDataStore } from '../training/data-collector.js';
import type { ToolRegistry, ToolContext } from '../tools/registry.js';
import { classifyPrompt } from './classifier.js';
import { selectProvider } from './provider-router.js';
import { streamOllamaChat } from './ollama-client.js';
import { streamAnthropicChat } from './anthropic-client.js';
import { executeToolCall } from '../tools/executor.js';
import { manageContextWindow } from './context-manager.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatPipelineInput {
  message: string;
  conversationId?: string;
  source: 'webchat' | 'telegram' | 'whatsapp' | 'api';
  images?: Array<{ base64: string; mediaType: string }>;
  documentText?: string;
}

export interface ChatPipelineResult {
  response: string;
  conversationId: string;
  provider: string;
  model: string;
  classification: PromptClassification;
  fallbackUsed: boolean;
}

export interface ChatPipelineCallbacks {
  onMeta?: (meta: {
    conversationId: string;
    provider: string;
    model: string;
    classification: PromptClassification;
  }) => void;
  onChunk?: (content: string) => void;
  onFallback?: (from: string, to: string) => void;
  onToolUse?: (tool: string, input: Record<string, unknown>) => void;
  onToolResult?: (tool: string, result: string, isError: boolean) => void;
}

export interface ChatPipelineDeps {
  config: GatewayRuntimeConfig;
  sessions: SessionStore;
  trainingStore: TrainingDataStore | null;
  toolRegistry?: ToolRegistry;
}

const MAX_TOOL_ITERATIONS = 10;

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export async function processChatMessage(
  input: ChatPipelineInput,
  deps: ChatPipelineDeps,
  callbacks?: ChatPipelineCallbacks,
): Promise<ChatPipelineResult> {
  const conversation = await deps.sessions.getOrCreate(input.conversationId);

  // Prepend document text to the message when present
  const effectiveMessage = input.documentText
    ? `[Document content]\n${input.documentText}\n\n[User message]\n${input.message}`
    : input.message;

  const classification = classifyPrompt(effectiveMessage);
  let selection = selectProvider(classification, deps.config);

  // Add user message
  const userMsg: ChatMessage = {
    role: 'user',
    content: effectiveMessage,
    timestamp: new Date().toISOString(),
  };
  deps.sessions.addMessage(conversation.id, userMsg);

  // Prepare messages for the provider with context window management
  const maxContextTokens = selection.provider === 'ollama' ? 6_000 : 100_000;
  const allMessages = conversation.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const managed = manageContextWindow(allMessages, maxContextTokens, deps.config.systemPrompt);

  // Inject system prompt at the start
  const recentMessages: Array<{ role: string; content: string | ContentBlock[] }> = [];
  if (deps.config.systemPrompt) {
    recentMessages.push({ role: 'system', content: deps.config.systemPrompt });
  }
  recentMessages.push(...managed.messages);

  // When images are present, build multimodal content for the last user message
  // and force Anthropic provider (Ollama doesn't support image blocks)
  if (input.images && input.images.length > 0) {
    // Force Anthropic provider for image understanding
    if (selection.provider === 'ollama' && deps.config.anthropicApiKey) {
      selection = {
        ...selection,
        provider: 'anthropic',
        model: 'claude-sonnet-4-5-20250929',
      };
    }

    // Replace the last user message content with multimodal blocks
    const lastUserIdx = recentMessages.length - 1;
    if (lastUserIdx >= 0 && recentMessages[lastUserIdx].role === 'user') {
      const userContent: ContentBlock[] = [];
      for (const img of input.images) {
        userContent.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: img.mediaType as ImageBlock['source']['media_type'],
            data: img.base64,
          },
        });
      }
      userContent.push({ type: 'text', text: effectiveMessage });
      recentMessages[lastUserIdx] = {
        role: 'user',
        content: userContent,
      };
    }
  }

  // Emit metadata
  callbacks?.onMeta?.({
    conversationId: conversation.id,
    provider: selection.provider,
    model: selection.model,
    classification: selection.classification,
  });

  // Get available tools
  const availableTools = deps.toolRegistry
    ? deps.toolRegistry.getAvailableTools(deps.config.tools)
    : [];

  // Force Anthropic when tools are available (Ollama can't reliably use tools)
  if (availableTools.length > 0 && selection.provider === 'ollama' && deps.config.anthropicApiKey) {
    selection = { ...selection, provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' };
  }

  // Derive stable user ID for per-user memory
  const userId = conversation.id.startsWith('telegram:') || conversation.id.startsWith('whatsapp:')
    ? conversation.id
    : `${input.source}:${conversation.id}`;

  let fullResponse = '';
  let usedProvider = selection.provider;
  let usedModel = selection.model;
  let fallbackUsed = false;

  try {
    fullResponse = await streamWithToolLoop(
      selection,
      recentMessages,
      deps,
      availableTools,
      userId,
      callbacks,
    );
  } catch (err) {
    // Fallback: if Ollama failed and Anthropic is available
    if (selection.provider === 'ollama' && deps.config.anthropicApiKey) {
      usedProvider = 'anthropic';
      usedModel = 'claude-sonnet-4-5-20250929';
      fallbackUsed = true;

      callbacks?.onFallback?.('ollama', 'anthropic');

      fullResponse = await streamWithToolLoop(
        { provider: 'anthropic', model: usedModel },
        recentMessages,
        deps,
        availableTools,
        userId,
        callbacks,
      );
    } else {
      throw err;
    }
  }

  // Save assistant message
  if (fullResponse) {
    deps.sessions.addMessage(conversation.id, {
      role: 'assistant',
      content: fullResponse,
      timestamp: new Date().toISOString(),
    });

    // Collect training data from cloud responses
    if (
      deps.trainingStore &&
      deps.config.training?.enabled &&
      usedProvider !== 'ollama'
    ) {
      try {
        await deps.trainingStore.addEntry({
          prompt: input.message,
          response: fullResponse,
          provider: usedProvider,
          model: usedModel,
          category: classification.classification as 'simple' | 'complex' | 'coding' | 'general',
        });
      } catch {
        // Training data collection is best-effort
      }
    }
  }

  return {
    response: fullResponse,
    conversationId: conversation.id,
    provider: usedProvider,
    model: usedModel,
    classification: selection.classification,
    fallbackUsed,
  };
}

// ---------------------------------------------------------------------------
// Stream with tool execution loop
// ---------------------------------------------------------------------------

async function streamWithToolLoop(
  selection: { provider: string; model: string },
  messages: Array<{ role: string; content: string | ContentBlock[] }>,
  deps: ChatPipelineDeps,
  tools: ToolDefinition[],
  userId: string,
  callbacks?: ChatPipelineCallbacks,
): Promise<string> {
  let fullResponse = '';
  let iteration = 0;

  // Working copy of messages for tool loop
  const workingMessages = [...messages];

  while (iteration < MAX_TOOL_ITERATIONS) {
    iteration++;

    const pendingToolCalls: ToolUseBlock[] = [];
    let iterationText = '';
    let stopReason: 'end_turn' | 'tool_use' | undefined;

    const stream = createStream(selection, workingMessages, deps, tools);
    for await (const chunk of stream) {
      if (chunk.content) {
        iterationText += chunk.content;
        fullResponse += chunk.content;
        callbacks?.onChunk?.(chunk.content);
      }
      if (chunk.toolUse) {
        pendingToolCalls.push(chunk.toolUse);
      }
      if (chunk.stopReason) {
        stopReason = chunk.stopReason;
      }
      if (chunk.done) break;
    }

    // If no tool calls, we're done
    if (pendingToolCalls.length === 0 || stopReason !== 'tool_use') {
      break;
    }

    // Build assistant message with text + tool_use blocks
    const assistantBlocks: ContentBlock[] = [];
    if (iterationText) {
      assistantBlocks.push({ type: 'text', text: iterationText });
    }
    for (const tc of pendingToolCalls) {
      assistantBlocks.push(tc);
    }
    workingMessages.push({
      role: 'assistant',
      content: assistantBlocks,
    });

    // Execute each tool call and build tool result blocks
    const toolResultBlocks: ContentBlock[] = [];
    const toolContext: ToolContext = {
      workspaceDir: deps.config.tools.workspaceDir,
      memoryDir: deps.config.tools.workspaceDir.replace(/workspace\/?$/, 'memory'),
      conversationId: 'pipeline',
      userId,
      maxExecutionMs: deps.config.tools.maxExecutionMs,
      allowedProjectDirs: deps.config.tools.allowedProjectDirs ?? [],
    };

    for (const toolCall of pendingToolCalls) {
      callbacks?.onToolUse?.(toolCall.name, toolCall.input);

      const result = await executeToolCall(
        toolCall,
        deps.toolRegistry!,
        deps.config.tools,
        toolContext,
      );

      callbacks?.onToolResult?.(toolCall.name, result.output, result.is_error);

      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: toolCall.id,
        content: result.output,
        is_error: result.is_error,
      });
    }

    // Add tool results as user message (Anthropic format)
    workingMessages.push({
      role: 'user',
      content: toolResultBlocks,
    });
  }

  return fullResponse;
}

// ---------------------------------------------------------------------------
// Stream factory
// ---------------------------------------------------------------------------

function createStream(
  selection: { provider: string; model: string },
  messages: Array<{ role: string; content: string | ContentBlock[] }>,
  deps: ChatPipelineDeps,
  tools?: ToolDefinition[],
): AsyncGenerator<{ content: string; done: boolean; toolUse?: ToolUseBlock; stopReason?: 'end_turn' | 'tool_use' }> {
  if (selection.provider === 'ollama' && deps.config.ollama) {
    // Ollama only supports string content
    const stringMessages = messages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string'
        ? m.content
        : (m.content as ContentBlock[])
            .filter((b) => b.type === 'text')
            .map((b) => (b as { text: string }).text)
            .join(''),
    }));
    return streamOllamaChat(deps.config.ollama, stringMessages, undefined, tools);
  }

  if (deps.config.anthropicApiKey) {
    return streamAnthropicChat(
      deps.config.anthropicApiKey,
      selection.model,
      messages,
      undefined,
      tools,
    );
  }

  throw new Error(`No configuration available for provider: ${selection.provider}`);
}
