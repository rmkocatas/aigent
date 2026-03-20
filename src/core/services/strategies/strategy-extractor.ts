// ============================================================
// OpenClaw Deploy — Strategy Extraction from Tool-Using Conversations
// ============================================================
//
// Distills behavioral patterns from tool-using conversations into
// reusable strategies. Uses fastModel (llama3.1:8b) for extraction.
// Only runs when tools were actually used in the conversation.
// ============================================================

import type { OllamaConfig, PromptClassification } from '../../../types/index.js';
import type { StrategyConfig, StrategyExtractionResult, ExtractedStrategy, OutcomeSignal } from './types.js';
import { streamOllamaChat } from '../../gateway/ollama-client.js';
import { streamAnthropicChat } from '../../gateway/anthropic-client.js';
import { streamOpenAIChat } from '../../gateway/openai-client.js';

const EXTRACTION_SYSTEM_PROMPT = `You are a behavioral strategy extraction engine. Analyze tool-using conversations and extract reusable strategies.

A strategy describes WHAT approach worked (or failed) and WHEN to apply it.

RULES:
1. Focus on TOOL USAGE PATTERNS — how tools were combined, sequenced, or applied:
   - Effective tool combinations (e.g., web_search → fetch_url → synthesize)
   - Smart parameter choices (e.g., specific query formulations)
   - Error recovery patterns (e.g., retry with different approach on failure)
2. Each strategy must have: a short name, the principle, and when to apply it.
3. Keep principles actionable and concise (1-2 sentences).
4. Classify each strategy into exactly one category:
   - "general": Universal patterns applicable across many task types
   - "coding": Code generation, debugging, file operations
   - "web_content": Web search, URL fetching, research
   - "tool_simple": Simple single-tool operations (weather, reminders, calculations)
   - "complex": Multi-step reasoning, analysis, planning
5. If no behavioral patterns are extractable, return skipped.

Respond ONLY with valid JSON:
{
  "strategies": [
    {
      "name": "Cross-source verification",
      "principle": "When researching disputed or time-sensitive facts, run 2-3 varied web_search queries then fetch_url on top results to cross-reference before answering.",
      "whenToApply": "User asks about recent events, controversial topics, or facts that need verification",
      "classification": "web_content",
      "toolsInvolved": ["web_search", "fetch_url"],
      "confidence": 0.85
    }
  ],
  "skipped": false
}

If no tool-usage strategies are extractable: { "strategies": [], "skipped": true, "reason": "no_patterns" }`;

async function collectStreamResponse(
  stream: AsyncGenerator<{ content: string; done: boolean }>,
): Promise<string> {
  let text = '';
  for await (const chunk of stream) {
    text += chunk.content;
    if (chunk.done) break;
  }
  return text.trim();
}

const VALID_CLASSIFICATIONS = new Set([
  'general', 'simple', 'complex', 'coding', 'tool_simple', 'web_content', 'default',
]);

function normalizeStrategies(strategies: ExtractedStrategy[]): ExtractedStrategy[] {
  return strategies
    .filter((s) => s.confidence >= 0.5 && s.name && s.principle && s.whenToApply)
    .map((s) => ({
      ...s,
      classification: VALID_CLASSIFICATIONS.has(s.classification) ? s.classification : 'general',
      toolsInvolved: Array.isArray(s.toolsInvolved) ? s.toolsInvolved : [],
    }));
}

function parseExtractionResponse(responseText: string): StrategyExtractionResult {
  try {
    const parsed = JSON.parse(responseText);
    return {
      strategies: normalizeStrategies((parsed.strategies as ExtractedStrategy[]) ?? []),
      skipped: parsed.skipped ?? false,
      reason: parsed.reason,
    };
  } catch {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          strategies: normalizeStrategies((parsed.strategies as ExtractedStrategy[]) ?? []),
          skipped: parsed.skipped ?? false,
          reason: parsed.reason,
        };
      } catch {
        // fall through
      }
    }
    return { strategies: [], skipped: true, reason: 'parse_error' };
  }
}

export async function extractStrategies(
  userMessage: string,
  assistantResponse: string,
  toolCalls: Array<{ name: string; isError: boolean }>,
  classification: PromptClassification,
  outcome: OutcomeSignal,
  config: StrategyConfig,
  ollamaConfig: OllamaConfig | null,
  anthropicApiKey: string | null,
  openaiApiKey?: string | null,
): Promise<StrategyExtractionResult> {
  if (toolCalls.length === 0) {
    return { strategies: [], skipped: true, reason: 'no_tools_used' };
  }

  const toolSummary = toolCalls
    .map((t) => `  - ${t.name}${t.isError ? ' [ERROR]' : ' [OK]'}`)
    .join('\n');

  const userPrompt = `Classification: ${classification}
Outcome: ${outcome}
Tools used:
${toolSummary}

User: ${userMessage.slice(0, 500)}
Assistant response (truncated): ${assistantResponse.slice(0, 500)}

Extract behavioral strategies from this tool-using conversation.`;

  const messages = [
    { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];

  // Use fastModel for extraction (same as fact extraction)
  const extractionOllamaConfig = ollamaConfig
    ? { ...ollamaConfig, model: ollamaConfig.fastModel ?? ollamaConfig.model }
    : null;

  let responseText: string;

  try {
    if (config.extractionProvider === 'ollama' && extractionOllamaConfig) {
      responseText = await collectStreamResponse(
        streamOllamaChat(extractionOllamaConfig, messages),
      );
    } else if (config.extractionProvider === 'openai' && openaiApiKey) {
      responseText = await collectStreamResponse(
        streamOpenAIChat(openaiApiKey, 'gpt-4o-mini', messages),
      );
    } else if (anthropicApiKey) {
      responseText = await collectStreamResponse(
        streamAnthropicChat(anthropicApiKey, 'claude-haiku-4-5-20251001', messages),
      );
    } else if (openaiApiKey) {
      responseText = await collectStreamResponse(
        streamOpenAIChat(openaiApiKey, 'gpt-4o-mini', messages),
      );
    } else if (extractionOllamaConfig) {
      responseText = await collectStreamResponse(
        streamOllamaChat(extractionOllamaConfig, messages),
      );
    } else {
      return { strategies: [], skipped: true, reason: 'no_llm_available' };
    }
  } catch (err) {
    console.error('[strategy] Extraction LLM call failed:', err);
    return { strategies: [], skipped: true, reason: 'llm_error' };
  }

  return parseExtractionResponse(responseText);
}
