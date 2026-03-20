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
  GeneratedImage,
  GeneratedFile,
  TelegramPoll,
  TokenUsage,
} from '../../types/index.js';
import type { SessionStore } from './session-store.js';
import type { TrainingDataStore } from '../training/data-collector.js';
import type { ToolRegistry, ToolContext } from '../tools/registry.js';
import type { SkillLoader } from '../services/skill-loader.js';
import type { MemoryEngine } from '../services/memory/memory-engine.js';
import type { StrategyEngine } from '../services/strategies/strategy-engine.js';
import type { CostTracker } from '../services/cost-tracker.js';
import type { ResponseCache } from './response-cache.js';
import { classifyPrompt } from './classifier.js';
import { selectProvider, DEFAULT_ANTHROPIC_MODEL, DEFAULT_OPUS_MODEL, getCloudFallback } from './provider-router.js';
import { streamOllamaChat } from './ollama-client.js';
import { streamAnthropicChat } from './anthropic-client.js';
import { streamOpenAIChat } from './openai-client.js';
import { executeToolCall } from '../tools/executor.js';
import { manageContextWindow } from './context-manager.js';
import { compactConversation } from './compaction.js';
import { redactSensitive } from '../services/log-redactor.js';
import type { PipelineHooks } from '../services/pipeline-hooks.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatPipelineInput {
  message: string;
  conversationId?: string;
  source: 'webchat' | 'telegram' | 'whatsapp' | 'discord' | 'api';
  images?: Array<{ base64: string; mediaType: string }>;
  documentText?: string;
  isVoiceInput?: boolean;
}

export interface ChatPipelineResult {
  response: string;
  conversationId: string;
  provider: string;
  model: string;
  classification: PromptClassification;
  fallbackUsed: boolean;
  generatedImages?: GeneratedImage[];
  generatedFiles?: GeneratedFile[];
  polls?: TelegramPoll[];
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
  skillLoader?: SkillLoader;
  memoryEngine?: MemoryEngine;
  strategyEngine?: StrategyEngine;
  costTracker?: CostTracker;
  responseCache?: ResponseCache;
  pipelineHooks?: PipelineHooks;
  personaManager?: import('../services/persona-manager.js').PersonaManager;
  /** Document memory engine for soul.md + memory.md + tasks.md injection */
  documentMemory?: import('../services/document-memory/document-memory.js').DocumentMemoryEngine;
  /** Discord channel cache for system prompt injection (set by server.ts when cross-channel is active) */
  discordChannelDirectory?: () => Promise<string>;
  /** Called when the tool loop hits its iteration cap — used to auto-escalate to autonomous mode */
  onIterationCapHit?: (context: {
    userId: string;
    chatId: number | string;
    channel: 'telegram' | 'webchat' | 'discord';
    originalMessage: string;
    workSummary: string;
    toolsUsed: string[];
  }) => Promise<void>;
}

const MAX_TOOL_ITERATIONS = 30;
const MAX_MESSAGE_LENGTH = 32_000; // 32KB — prevents token exhaustion attacks
const MAX_TOOL_RESULT_CHARS = 8_000; // ~2,000 tokens — truncate verbose tool results
const KEEP_RECENT_TOOL_RESULTS = 3; // Keep full content for last N tool result messages

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export async function processChatMessage(
  input: ChatPipelineInput,
  deps: ChatPipelineDeps,
  callbacks?: ChatPipelineCallbacks,
): Promise<ChatPipelineResult> {
  if (input.message.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Message too long (${input.message.length} chars, max ${MAX_MESSAGE_LENGTH})`);
  }

  const conversation = await deps.sessions.getOrCreate(input.conversationId);

  // Prepend document text to the message when present
  const effectiveMessage = input.documentText
    ? `[Document content]\n${input.documentText}\n\n[User message]\n${input.message}`
    : input.message;

  const classification = classifyPrompt(effectiveMessage);
  let selection = selectProvider(classification, deps.config);

  console.log(
    `[routing] "${effectiveMessage.slice(0, 60)}${effectiveMessage.length > 60 ? '...' : ''}" → ` +
    `class=${classification.classification} (${classification.confidence.toFixed(2)}) ` +
    `signals=[${classification.signals.join(', ')}] → ` +
    `${selection.provider}/${selection.model}`,
  );

  // Match skills for this message
  const matchedSkills = deps.skillLoader && deps.config.skills
    ? deps.skillLoader.matchSkills(
        effectiveMessage,
        classification,
        deps.config.skills.maxActiveSkills,
      )
    : [];

  // If a matched skill forces a specific provider, override the routing decision.
  // In single routing mode, ignore skill provider overrides — stay on the primary provider.
  if (matchedSkills.length > 0 && matchedSkills[0].manifest.provider && deps.config.routing?.mode !== 'single') {
    const forcedProvider = matchedSkills[0].manifest.provider;
    if (forcedProvider === 'anthropic' && deps.config.anthropicApiKey) {
      selection = { ...selection, provider: 'anthropic', model: DEFAULT_ANTHROPIC_MODEL };
    } else if (forcedProvider === 'anthropic' && !deps.config.anthropicApiKey) {
      // Anthropic unavailable — fall back to any cloud provider
      const fb = getCloudFallback(deps.config, 'strong');
      if (fb) selection = { ...selection, ...fb };
    } else if (forcedProvider === 'ollama' && deps.config.ollama) {
      selection = { ...selection, provider: 'ollama', model: deps.config.ollama.model };
    }
  }

  // Add user message
  const userMsg: ChatMessage = {
    role: 'user',
    content: effectiveMessage,
    timestamp: new Date().toISOString(),
  };
  deps.sessions.addMessage(conversation.id, userMsg);

  // Prepare messages for the provider with context window management
  const ollamaCtxTokens = deps.config.ollama?.numCtx ? Math.floor(deps.config.ollama.numCtx * 0.75) : 6_000;
  const maxContextTokens = selection.provider === 'ollama' ? ollamaCtxTokens : 100_000;

  // Compaction: summarize older messages instead of just truncating
  const compactionResult = await compactConversation(
    conversation.messages,
    conversation.compactionSummary,
    maxContextTokens,
    deps.config.systemPrompt,
    deps.config.compaction,
    deps.config.ollama,
    deps.config.anthropicApiKey,
    deps.config.openaiApiKey,
  );
  if (compactionResult.compacted) {
    deps.sessions.setCompactionSummary(conversation.id, compactionResult.summary!);
  }

  const messagesForContext = compactionResult.recentMessages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const managed = manageContextWindow(messagesForContext, maxContextTokens, deps.config.systemPrompt);

  // Derive stable user ID for per-user memory and tools
  const userId = conversation.id.startsWith('telegram:') || conversation.id.startsWith('whatsapp:') || conversation.id.startsWith('discord:')
    ? conversation.id
    : `${input.source}:${conversation.id}`;

  // Inject system prompt at the start, with compaction summary and active skills
  const recentMessages: Array<{ role: string; content: string | ContentBlock[] }> = [];
  const activeSummary = compactionResult.summary ?? conversation.compactionSummary;
  if (deps.config.systemPrompt || deps.personaManager || activeSummary || matchedSkills.length > 0 || deps.memoryEngine) {
    const activePersona = deps.personaManager?.getActivePersona(userId);
    let systemContent = activePersona?.systemPrompt ?? deps.config.systemPrompt ?? '';

    // Voice-aware prompt modification
    if (input.isVoiceInput) {
      systemContent += '\n\n[Voice Mode] The user is speaking to you via voice message. ' +
        'Keep responses conversational, natural, and concise. Avoid code blocks, ' +
        'long lists, tables, or markdown formatting that doesn\'t translate to speech. ' +
        'Respond as if having a spoken conversation.';
    }
    if (activeSummary) {
      systemContent += `\n\n[Previous conversation context — ${activeSummary.messageCount} earlier messages summarized]\n${activeSummary.summary}`;
    }
    for (const skill of matchedSkills) {
      systemContent += `\n\n--- Active Skill: ${skill.manifest.name} ---\n${skill.instructions}`;
    }

    // Inject document memory (soul.md, memory.md, tasks.md) — always-visible structured context
    if (deps.documentMemory) {
      try {
        const docContext = await deps.documentMemory.getContextInjection(userId);
        if (docContext) {
          systemContent += '\n\n' + docContext;
        }
      } catch (err) {
        console.error('[doc-memory] Injection error:', redactSensitive(String(err)));
      }
    }

    // Inject relevant memories from semantic memory
    if (deps.memoryEngine && deps.config.memory?.autoInject) {
      try {
        const memoryContext = await deps.memoryEngine.getContextInjection(userId, effectiveMessage);
        if (memoryContext) {
          systemContent += '\n\n' + memoryContext;
        }
      } catch (err) {
        console.error('[memory] Context injection error:', redactSensitive(String(err)));
      }
    }

    // Inject learned strategies from dynamic strategy engine
    if (deps.strategyEngine && deps.config.strategies?.autoInject) {
      try {
        const strategyContext = await deps.strategyEngine.getContextInjection(
          userId,
          effectiveMessage,
          classification.classification,
        );
        if (strategyContext) {
          systemContent += '\n\n' + strategyContext;
        }
      } catch (err) {
        console.error('[strategy] Context injection error:', redactSensitive(String(err)));
      }
    }

    // Inject channel source so the LLM knows where the user is chatting from
    const channelLabels: Record<string, string> = {
      telegram: 'Telegram',
      discord: 'Discord',
      webchat: 'WebChat',
      api: 'API',
      whatsapp: 'WhatsApp',
    };
    const channelLabel = channelLabels[input.source] ?? input.source;
    systemContent += `\n\n[Channel: ${channelLabel}] The user is chatting via ${channelLabel}. ` +
      'Generated files (PDFs, images, videos, audio) are delivered as attachments in this channel automatically — ' +
      'do not mention Telegram-specific behaviors or limitations unless the user is on Telegram.';

    // Inject Discord server channel directory (for cross-channel awareness)
    if (deps.discordChannelDirectory) {
      try {
        const channelDir = await deps.discordChannelDirectory();
        if (channelDir) {
          systemContent += '\n\n' + channelDir;
        }
      } catch (err) {
        console.error('[pipeline] Discord channel directory injection error:', (err as Error).message);
      }
    }

    recentMessages.push({ role: 'system', content: systemContent });
  }
  recentMessages.push(...managed.messages);

  // When images are present, build multimodal content for the last user message.
  // Ollama multimodal models (e.g. Qwen 3.5) handle images natively via the images field,
  // so no cloud fallback is needed — image ContentBlocks are converted in createStream().
  if (input.images && input.images.length > 0) {
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

  // Semantic response cache — check before any LLM call.
  // Skip for autonomous conversations (they have unique tool state per subtask).
  const isAutonomous = input.conversationId?.startsWith('autonomous-') ?? false;
  if (!isAutonomous && deps.responseCache) {
    try {
      const cached = await deps.responseCache.lookup(
        effectiveMessage,
        classification.classification,
      );
      if (cached) {
        // Save assistant message from cache
        deps.sessions.addMessage(conversation.id, {
          role: 'assistant',
          content: cached.response,
          timestamp: new Date().toISOString(),
        });

        return {
          response: cached.response,
          conversationId: conversation.id,
          provider: cached.provider + ' (cached)',
          model: cached.model,
          classification: selection.classification,
          fallbackUsed: false,
        };
      }
    } catch (err) {
      console.error('[cache] Lookup error:', redactSensitive(String(err)));
    }
  }

  // Get tools filtered by classification — simple/default get 0 tools when on Ollama
  let availableTools = deps.toolRegistry
    ? deps.toolRegistry.getFilteredTools(deps.config.tools, classification.classification)
    : [];

  // When classifier returned 0 tools but the provider can handle tool calling, provide tools anyway.
  if (availableTools.length === 0 && deps.toolRegistry) {
    availableTools = deps.toolRegistry.getFilteredTools(deps.config.tools, 'tool_simple');
    console.log(`[routing] Upgraded tools from 0 → ${availableTools.length} for ${selection.provider}`);
  }

  // HTTP channel safety: block high-risk tools from webchat/API requests
  if (input.source === 'webchat' && deps.config.tools.httpDenyTools?.length) {
    const httpDeny = new Set(deps.config.tools.httpDenyTools);
    availableTools = availableTools.filter((t) => !httpDeny.has(t.name));
  }

  console.log(`[routing] tools: ${availableTools.length} available (${classification.classification})`);

  // userId already derived above

  let fullResponse = '';
  let generatedImages: GeneratedImage[] = [];
  let generatedFiles: GeneratedFile[] = [];
  let generatedPolls: TelegramPoll[] = [];
  let toolCallLog: Array<{ name: string; isError: boolean }> = [];
  let usedProvider = selection.provider;
  let usedModel = selection.model;
  let fallbackUsed = false;

  try {
    const result = await streamWithToolLoop(
      { ...selection, classification: selection.classification },
      recentMessages,
      deps,
      availableTools,
      userId,
      callbacks,
    );
    fullResponse = result.text;
    generatedImages = result.images;
    generatedFiles = result.files;
    toolCallLog = result.toolCallLog;

    // Auto-escalate to autonomous mode if tool loop hit its cap
    // Skip for: autonomous subtasks (recursion guard), very short messages (not worth autonomous decomposition)
    if (result.hitIterationCap && deps.onIterationCapHit && !input.conversationId?.startsWith('autonomous-') && input.message.length >= 50) {
      deps.onIterationCapHit({
        userId,
        chatId: input.conversationId ?? userId,
        channel: (input.source === 'api' ? 'webchat' : input.source) as 'telegram' | 'webchat' | 'discord',
        originalMessage: input.message,
        workSummary: result.text.slice(0, 1000),
        toolsUsed: result.toolCallLog?.map((t) => t.name) ?? [],
      }).catch((err) => console.error('[pipeline] Auto-escalation failed:', (err as Error).message));
    }
  } catch (err) {
    // Check if error is failover-eligible (provider unavailable, 503, 529, rate limit, network)
    const isFailoverEligible = (e: unknown): boolean => {
      const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
      return msg.includes('503') || msg.includes('529') || msg.includes('overloaded')
        || msg.includes('rate limit') || msg.includes('service unavailable')
        || msg.includes('econnrefused') || msg.includes('econnreset')
        || msg.includes('etimedout') || msg.includes('fetch failed');
    };

    // Fallback: if primary provider failed and an alternative is available.
    // In single routing mode, never fall back to cloud — rethrow so the user sees the error.
    const isSingleMode = deps.config.routing?.mode === 'single';
    const cloudFb = isSingleMode ? null : getCloudFallback(deps.config);
    const canFallback =
      (selection.provider === 'ollama' && cloudFb) ||
      ((selection.provider === 'anthropic' || selection.provider === 'openai') && isFailoverEligible(err) && deps.config.ollama?.baseUrl);

    if (canFallback) {
      let fallbackProvider: string;
      if (selection.provider === 'ollama' && cloudFb) {
        fallbackProvider = cloudFb.provider;
        usedModel = cloudFb.model;
      } else {
        fallbackProvider = 'ollama';
        usedModel = deps.config.ollama?.model ?? 'llama3.1:8b';
      }
      usedProvider = fallbackProvider;
      fallbackUsed = true;

      console.warn(`[pipeline] Provider ${selection.provider} failed, falling back to ${fallbackProvider}: ${(err as Error).message}`);
      callbacks?.onFallback?.(selection.provider, fallbackProvider);

      const result = await streamWithToolLoop(
        { provider: fallbackProvider, model: usedModel, classification: selection.classification },
        recentMessages,
        deps,
        availableTools,
        userId,
        callbacks,
      );
      fullResponse = result.text;
      generatedImages = result.images;
      generatedFiles = result.files;
      toolCallLog = result.toolCallLog;
    } else {
      throw err;
    }
  }

  // Extract any image URLs from the LLM's text response (it may bypass the tool)
  if (fullResponse) {
    const responseExtracted = extractResponseImages(fullResponse);
    if (responseExtracted.images.length > 0) {
      console.log(`[pipeline] Extracted ${responseExtracted.images.length} image(s) from response text`);
      for (const img of responseExtracted.images) {
        console.log(`[pipeline]   ${img.type}: ${img.data.slice(0, 100)}...`);
      }
      fullResponse = responseExtracted.clean;
      generatedImages.push(...responseExtracted.images);
    }

    // Extract audio markers (TTS results)
    const audioExtracted = extractAudioFiles(fullResponse);
    if (audioExtracted.files.length > 0) {
      console.log(`[pipeline] Extracted ${audioExtracted.files.length} audio file(s) from response`);
      fullResponse = audioExtracted.clean;
      generatedFiles.push(...audioExtracted.files);
    }

    // Extract Telegram poll markers
    const pollExtracted = extractPolls(fullResponse);
    if (pollExtracted.polls.length > 0) {
      console.log(`[pipeline] Extracted ${pollExtracted.polls.length} poll(s) from response`);
      fullResponse = pollExtracted.clean;
      generatedPolls.push(...pollExtracted.polls);
    }

    // Strip leaked model control tokens (v2026.3.11)
    fullResponse = stripControlTokens(fullResponse);
  }

  // Save assistant message
  if (fullResponse) {
    deps.sessions.addMessage(conversation.id, {
      role: 'assistant',
      content: fullResponse,
      timestamp: new Date().toISOString(),
    });

    // Collect training data from cloud responses (for distillation to local models)
    if (
      deps.trainingStore &&
      deps.config.training?.enabled &&
      usedProvider !== 'ollama'
    ) {
      try {
        await deps.trainingStore.addEntry({
          prompt: redactSensitive(input.message),
          response: redactSensitive(fullResponse),
          provider: usedProvider,
          model: usedModel,
          category: classification.classification as 'simple' | 'complex' | 'coding' | 'general',
          toolCalls: toolCallLog.length > 0 ? toolCallLog : undefined,
        });
      } catch {
        // Training data collection is best-effort
      }
    }

    // Async memory extraction (fire-and-forget, non-blocking)
    if (deps.memoryEngine && deps.config.memory?.autoExtract) {
      const turnIndex = conversation.messages.length - 1;
      deps.memoryEngine
        .extractAndStore(userId, input.message, fullResponse, conversation.id, turnIndex)
        .catch((err) => console.error('[memory] Async extraction failed:', redactSensitive(String(err))));
    }

    // Activity logging for document memory (fire-and-forget)
    if (deps.documentMemory && deps.config.documentMemory?.activityLogging) {
      deps.documentMemory.logActivity({
        timestamp: new Date().toISOString(),
        userId,
        conversationId: conversation.id,
        channel: input.source,
        userMessage: input.message.slice(0, 200),
        classification: classification.classification,
        provider: usedProvider,
        model: usedModel,
        toolsUsed: [...new Set(toolCallLog.map((t) => t.name))],
        toolErrors: toolCallLog.filter((t) => t.isError).map((t) => t.name),
        responseSnippet: fullResponse.slice(0, 150),
      }).catch((err) => console.error('[activity] Log error:', redactSensitive(String(err))));
    }

    // Async strategy extraction (fire-and-forget, only for tool-using conversations)
    if (deps.strategyEngine && deps.config.strategies?.autoExtract && toolCallLog.length > 0) {
      const hasErrors = toolCallLog.some((tc) => tc.isError);
      const allErrors = toolCallLog.every((tc) => tc.isError);
      const outcome = allErrors ? 'failure' as const : hasErrors ? 'mixed' as const : 'success' as const;
      deps.strategyEngine
        .extractAndStore(
          userId,
          input.message,
          fullResponse,
          toolCallLog,
          classification.classification,
          outcome,
          conversation.id,
        )
        .catch((err) => console.error('[strategy] Async extraction failed:', redactSensitive(String(err))));
    }

    // Cache the response for future semantic hits (fire-and-forget)
    // Skip caching when any tool call errored — don't cache broken responses
    const hadToolErrors = toolCallLog.some((tc) => tc.isError);
    if (!isAutonomous && deps.responseCache && !hadToolErrors) {
      // Determine if tools were used (check if provider was escalated or tool callbacks fired)
      const usedTools = generatedFiles.length > 0 || generatedImages.length > 0;
      deps.responseCache
        .store(
          input.message,
          fullResponse,
          usedProvider,
          usedModel,
          classification.classification,
          usedTools,
        )
        .catch((err) => console.error('[cache] Store error:', redactSensitive(String(err))));
    }
  }

  return {
    response: fullResponse,
    conversationId: conversation.id,
    provider: usedProvider,
    model: usedModel,
    classification: selection.classification,
    fallbackUsed,
    ...(generatedImages.length > 0 ? { generatedImages } : {}),
    ...(generatedFiles.length > 0 ? { generatedFiles } : {}),
    ...(generatedPolls.length > 0 ? { polls: generatedPolls } : {}),
  };
}

// ---------------------------------------------------------------------------
// Model control token sanitization (v2026.3.11)
// ---------------------------------------------------------------------------

/**
 * Strip leaked model control tokens from assistant text.
 * Matches standard ASCII tokens like <|endoftext|>, <|im_start|>, <|im_end|>,
 * as well as full-width variants like <｜endoftext｜>.
 */
const CONTROL_TOKEN_RE = /[<＜][|｜][a-zA-Z_]+[|｜][>＞]/g;

function stripControlTokens(text: string): string {
  return text.replace(CONTROL_TOKEN_RE, '').replace(/\n{3,}/g, '\n\n');
}

// ---------------------------------------------------------------------------
// Image marker extraction
// ---------------------------------------------------------------------------

const IMAGE_URL_RE = /<<IMAGE_URL:(.*?)>>/g;
const IMAGE_BASE64_RE = /<<IMAGE_BASE64:(.*?)>>/gs;
const AUDIO_BASE64_RE = /<<AUDIO_BASE64:(.*?)>>/gs;
const TELEGRAM_POLL_RE = /<<TELEGRAM_POLL:(.*?)>>/gs;
// Catch raw Pollinations URLs the LLM may output directly (bypassing the tool)
const POLLINATIONS_URL_RE = /https?:\/\/image\.pollinations\.ai\/prompt\/[^\s)>\]]+/g;

function extractImages(output: string): { clean: string; images: GeneratedImage[] } {
  const images: GeneratedImage[] = [];

  let clean = output.replace(IMAGE_URL_RE, (_match, url: string) => {
    images.push({ type: 'url', data: url, mimeType: 'image/png', prompt: '' });
    return '[Image generated successfully]';
  });

  clean = clean.replace(IMAGE_BASE64_RE, (_match, data: string) => {
    images.push({ type: 'base64', data, mimeType: 'image/png', prompt: '' });
    return '[Image generated successfully]';
  });

  return { clean, images };
}

function extractAudioFiles(output: string): { clean: string; files: GeneratedFile[] } {
  const files: GeneratedFile[] = [];
  const clean = output.replace(AUDIO_BASE64_RE, (_match, data: string) => {
    files.push({
      filename: 'speech.ogg',
      mimeType: 'audio/ogg',
      data: Buffer.from(data, 'base64'),
    });
    return '[Audio generated]';
  });
  return { clean, files };
}

function extractPolls(output: string): { clean: string; polls: TelegramPoll[] } {
  const polls: TelegramPoll[] = [];
  const clean = output.replace(TELEGRAM_POLL_RE, (_match, data: string) => {
    try {
      const parsed = JSON.parse(data) as TelegramPoll;
      if (parsed.question && Array.isArray(parsed.options) && parsed.options.length >= 2) {
        polls.push(parsed);
      }
    } catch {
      // Malformed poll marker — skip
    }
    return '[Poll created]';
  });
  return { clean, polls };
}

/** Scan the LLM's final text for raw image URLs it may have generated directly. */
function extractResponseImages(text: string): { clean: string; images: GeneratedImage[] } {
  const images: GeneratedImage[] = [];

  // First extract any markers that may have leaked through
  const markerResult = extractImages(text);
  images.push(...markerResult.images);

  // Then extract raw Pollinations URLs the LLM wrote directly
  const clean = markerResult.clean.replace(POLLINATIONS_URL_RE, (url) => {
    // Avoid duplicates (in case the same URL was already captured from a marker)
    if (!images.some((img) => img.data === url)) {
      images.push({ type: 'url', data: url, mimeType: 'image/png', prompt: '' });
    }
    return '';
  });

  return { clean: clean.trim(), images };
}

// ---------------------------------------------------------------------------
// Stream with tool execution loop
// ---------------------------------------------------------------------------

const PIPELINE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes total per pipeline

// ---------------------------------------------------------------------------
// Stale tool error tracking — prevents silent failure masking
// ---------------------------------------------------------------------------

/** Tools that modify state (files, config, external services). */
const MUTATING_TOOLS = new Set([
  'project_write_file', 'project_create_dir', 'project_delete_file',
  'install_package', 'send_file', 'create_reminder', 'delete_reminder',
  'pin_message', 'unpin_message', 'web_clip', 'read_later_add',
  'twitter_post', 'twitter_like', 'twitter_retweet', 'twitter_follow',
  'run_code',
]);

interface LastToolError {
  toolName: string;
  error: string;
  mutating: boolean;
}

function isSameToolAction(a: LastToolError, toolName: string): boolean {
  return a.toolName === toolName;
}

async function streamWithToolLoop(
  selection: { provider: string; model: string; classification?: string },
  messages: Array<{ role: string; content: string | ContentBlock[] }>,
  deps: ChatPipelineDeps,
  tools: ToolDefinition[],
  userId: string,
  callbacks?: ChatPipelineCallbacks,
): Promise<{ text: string; images: GeneratedImage[]; files: GeneratedFile[]; toolCallLog: Array<{ name: string; isError: boolean }>; hitIterationCap: boolean }> {
  let fullResponse = '';
  let iteration = 0;
  const collectedImages: GeneratedImage[] = [];
  const collectedFiles: GeneratedFile[] = [];
  const toolCallLog: Array<{ name: string; isError: boolean }> = [];
  let lastToolError: LastToolError | undefined;
  // Mutable copy so we can escalate to Opus after web tool use
  let activeSelection = { ...selection };

  // Pipeline-level timeout — prevents the entire tool loop from running forever
  const pipelineAbort = new AbortController();
  const pipelineTimer = setTimeout(() => pipelineAbort.abort(), PIPELINE_TIMEOUT_MS);

  // Working copy of messages for tool loop
  const workingMessages = [...messages];

  try {
  while (iteration < MAX_TOOL_ITERATIONS) {
    iteration++;

    const pendingToolCalls: ToolUseBlock[] = [];
    let iterationText = '';
    let stopReason: 'end_turn' | 'tool_use' | undefined;
    let iterationUsage: TokenUsage | undefined;

    const hookCtx = {
      provider: activeSelection.provider,
      model: activeSelection.model,
      classification: activeSelection.classification ?? selection.classification ?? 'unknown',
      messageCount: workingMessages.length,
      toolCount: tools.length,
      iteration,
    };
    deps.pipelineHooks?.fireBefore(hookCtx);
    const iterationStartMs = Date.now();

    const stream = createStream(activeSelection, workingMessages, deps, tools, pipelineAbort.signal);
    try {
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
        if (chunk.usage) {
          iterationUsage = chunk.usage;
        }
        if (chunk.done) break;
      }
    } catch (err) {
      // If the pipeline timed out, return whatever we have so far
      if (pipelineAbort.signal.aborted) {
        console.warn(`[pipeline] Pipeline timed out after ${PIPELINE_TIMEOUT_MS / 1000}s (iteration ${iteration})`);
        const timeoutNote = '\n\n[Response interrupted — processing took too long]';
        fullResponse += timeoutNote;
        callbacks?.onChunk?.(timeoutNote);
        break;
      }
      throw err;
    }

    deps.pipelineHooks?.fireAfter(hookCtx, {
      text: iterationText,
      toolCalls: pendingToolCalls.length,
      stopReason,
      usage: iterationUsage,
      durationMs: Date.now() - iterationStartMs,
    });

    // Log API cost if tracker is available
    if (deps.costTracker && iterationUsage) {
      deps.costTracker.logCall(
        activeSelection.provider,
        activeSelection.model,
        iterationUsage.inputTokens,
        iterationUsage.outputTokens,
        iterationUsage.cacheReadInputTokens,
        activeSelection.classification ?? selection.classification ?? 'unknown',
      ).catch(() => {});
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
      collectedFiles,
    };

    for (const toolCall of pendingToolCalls) {
      callbacks?.onToolUse?.(toolCall.name, toolCall.input);

      const result = await executeToolCall(
        toolCall,
        deps.toolRegistry!,
        deps.config.tools,
        toolContext,
      );

      // Extract image markers from tool results before the LLM sees them
      const { clean, images } = extractImages(result.output);
      if (images.length > 0) {
        collectedImages.push(...images);
        result.output = clean;
      }

      // Extract audio markers from tool results (TTS output)
      const audioResult = extractAudioFiles(result.output);
      if (audioResult.files.length > 0) {
        collectedFiles.push(...audioResult.files);
        result.output = audioResult.clean;
      }

      callbacks?.onToolResult?.(toolCall.name, result.output, result.is_error);
      toolCallLog.push({ name: toolCall.name, isError: result.is_error });

      // Stale tool error tracking: keep mutating errors until the same action succeeds
      if (result.is_error) {
        lastToolError = {
          toolName: toolCall.name,
          error: result.output.slice(0, 200),
          mutating: MUTATING_TOOLS.has(toolCall.name),
        };
      } else if (lastToolError) {
        if (lastToolError.mutating) {
          // Only clear mutating errors when the exact same tool succeeds
          if (isSameToolAction(lastToolError, toolCall.name)) {
            lastToolError = undefined;
          }
          // Otherwise keep the error — a different tool succeeding doesn't resolve it
        } else {
          // Non-mutating errors clear on any success
          lastToolError = undefined;
        }
      }

      // Truncate oversized tool results to prevent context bloat
      let resultContent = result.output;
      if (resultContent.length > MAX_TOOL_RESULT_CHARS) {
        resultContent = resultContent.slice(0, MAX_TOOL_RESULT_CHARS) +
          '\n\n[Content truncated — ask for specific sections if needed]';
      }

      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: toolCall.id,
        content: resultContent,
        is_error: result.is_error,
      });
    }

    // Add tool results as user message (Anthropic format)
    workingMessages.push({
      role: 'user',
      content: toolResultBlocks,
    });

    // Observation masking: clear older tool result contents to save context tokens.
    // Keep the last KEEP_RECENT_TOOL_RESULTS tool-result messages intact.
    const toolResultIndices: number[] = [];
    for (let i = 0; i < workingMessages.length; i++) {
      const msg = workingMessages[i];
      if (msg.role === 'user' && Array.isArray(msg.content) &&
          (msg.content as ContentBlock[]).some((b) => b.type === 'tool_result')) {
        toolResultIndices.push(i);
      }
    }
    if (toolResultIndices.length > KEEP_RECENT_TOOL_RESULTS) {
      const clearCount = toolResultIndices.length - KEEP_RECENT_TOOL_RESULTS;
      for (let j = 0; j < clearCount; j++) {
        const idx = toolResultIndices[j];
        const blocks = workingMessages[idx].content as ContentBlock[];
        workingMessages[idx] = {
          role: 'user',
          content: blocks.map((b) =>
            b.type === 'tool_result'
              ? { ...b, content: '[Previous tool result cleared to save context]' }
              : b,
          ),
        };
      }
    }

    // Security escalation: after web_search or fetch_url, force Opus for the next
    // LLM call to resist prompt injection from web content.
    // Skip when routing mode is 'single' — no cloud provider to escalate to.
    const usedWebTool = pendingToolCalls.some(
      (tc) => tc.name === 'web_search' || tc.name === 'fetch_url' || tc.name === 'x_research',
    );
    if (usedWebTool && deps.config.routing?.mode !== 'single') {
      const strongCloud = getCloudFallback(deps.config, 'strong');
      if (strongCloud) {
        activeSelection = strongCloud;
        console.log(`[routing] Security escalation → ${activeSelection.provider}/${activeSelection.model}`);
      }
    }
  }
  } finally {
    clearTimeout(pipelineTimer);
  }

  // If a mutating tool error was never resolved, append a warning so it's visible
  if (lastToolError?.mutating) {
    const warning = `\n\n⚠️ Note: A previous "${lastToolError.toolName}" action failed and was not retried successfully. Error: ${lastToolError.error}`;
    fullResponse += warning;
    callbacks?.onChunk?.(warning);
  }

  // Detect if the tool loop exited because it hit the iteration cap
  const hitIterationCap = iteration >= MAX_TOOL_ITERATIONS;
  if (hitIterationCap) {
    const capWarning = '\n\n---\nI\'ve reached my per-message tool limit and couldn\'t finish everything. ' +
      'I\'m automatically launching a background task to continue this work.';
    fullResponse += capWarning;
    callbacks?.onChunk?.(capWarning);
  }

  return { text: fullResponse, images: collectedImages, files: collectedFiles, toolCallLog, hitIterationCap };
}

// ---------------------------------------------------------------------------
// Stream factory
// ---------------------------------------------------------------------------

function createStream(
  selection: { provider: string; model: string },
  messages: Array<{ role: string; content: string | ContentBlock[] }>,
  deps: ChatPipelineDeps,
  tools?: ToolDefinition[],
  signal?: AbortSignal,
): AsyncGenerator<{ content: string; done: boolean; toolUse?: ToolUseBlock; stopReason?: 'end_turn' | 'tool_use'; usage?: TokenUsage }> {
  if (selection.provider === 'ollama' && deps.config.ollama) {
    // Convert ContentBlock messages to Ollama's native format (supports tool calling)
    const ollamaMessages: Array<{ role: string; content: string; images?: string[]; tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }> }> = [];
    for (const m of messages) {
      if (typeof m.content === 'string') {
        ollamaMessages.push({ role: m.role, content: m.content });
        continue;
      }
      const blocks = m.content as ContentBlock[];
      // Assistant message with tool_use blocks → Ollama tool_calls format
      if (m.role === 'assistant' && blocks.some((b) => b.type === 'tool_use')) {
        const text = blocks.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
        const toolCalls = blocks.filter((b) => b.type === 'tool_use').map((b) => {
          const tu = b as ToolUseBlock;
          return { function: { name: tu.name, arguments: tu.input } };
        });
        ollamaMessages.push({ role: 'assistant', content: text, tool_calls: toolCalls });
        continue;
      }
      // User message with tool_result blocks → Ollama "tool" role messages
      if (blocks.some((b) => b.type === 'tool_result')) {
        for (const b of blocks) {
          if (b.type === 'tool_result') {
            ollamaMessages.push({ role: 'tool', content: (b as { content: string }).content });
          }
        }
        continue;
      }
      // Extract text and images from ContentBlock arrays (multimodal support)
      const text = blocks.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
      const imageBlocks = blocks.filter((b) => b.type === 'image') as ImageBlock[];
      const images = imageBlocks.map((b) => b.source.data);
      ollamaMessages.push({ role: m.role, content: text, ...(images.length > 0 ? { images } : {}) });
    }
    return streamOllamaChat(deps.config.ollama, ollamaMessages, undefined, tools);
  }

  if (selection.provider === 'openai' && deps.config.openaiApiKey) {
    return streamOpenAIChat(
      deps.config.openaiApiKey,
      selection.model,
      messages,
      signal,
      tools,
    );
  }

  if (deps.config.anthropicApiKey) {
    return streamAnthropicChat(
      deps.config.anthropicApiKey,
      selection.model,
      messages,
      signal,
      tools,
    );
  }

  throw new Error(`No configuration available for provider: ${selection.provider}`);
}
