// ============================================================
// OpenClaw Deploy — LLM-Driven Fact Extraction
// ============================================================

import type { OllamaConfig } from '../../../types/index.js';
import type { MemoryConfig, ExtractionResult, ExtractedFact, ExtractedRelationship, MemoryLayer } from './types.js';
import { streamOllamaChat } from '../../gateway/ollama-client.js';
import { streamAnthropicChat } from '../../gateway/anthropic-client.js';
import { streamOpenAIChat } from '../../gateway/openai-client.js';

const EXTRACTION_SYSTEM_PROMPT = `You are a fact extraction engine. Extract discrete, self-contained factual statements from conversation exchanges.

RULES:
1. Each fact must be a complete, standalone sentence understandable without surrounding context.
2. COREFERENCE RESOLUTION: Replace ALL pronouns with actual names/entities.
   BAD: "He likes TypeScript" GOOD: "Roman likes TypeScript"
3. TEMPORAL ANCHORING: Convert relative dates to absolute when the current date is known.
   BAD: "yesterday" GOOD: "on 2026-02-11" (if today is 2026-02-12)
4. Extract ONLY factual information: preferences, biographical details, decisions, project states, technical facts, relationships, plans.
5. SKIP: greetings, filler, thanks, meta-conversation ("can you help me?"), common knowledge.
6. If a conversation turn contains no extractable facts, return an empty array.
7. For each fact identify persons, topics, entities, dates, confidence, and a memory layer.

MEMORY LAYERS — classify each fact into exactly one:
- "identity": Personal info, preferences, roles, timezone, name, habits, likes/dislikes
- "projects": Project state, task progress, deployments, goals, milestones, technical decisions
- "knowledge": General facts, learned information, technical knowledge, anything else

RELATIONSHIPS — if two or more facts are extracted, identify relationships between them:
- Relation types: works_at, located_in, prefers, uses, created, related_to, part_of, knows
- Reference facts by their exact "fact" text (as written in the facts array)
- Only include relationships where both facts appear in your extracted facts array

Respond ONLY with valid JSON:
{
  "facts": [
    { "fact": "...", "persons": ["..."], "topics": ["..."], "entities": ["..."], "dates": ["YYYY-MM-DD"], "confidence": 0.9, "layer": "knowledge" }
  ],
  "relationships": [
    { "sourceFact": "exact fact text 1", "targetFact": "exact fact text 2", "relationType": "uses", "confidence": 0.8 }
  ],
  "skipped": false
}

If the exchange is trivial, respond: { "facts": [], "skipped": true, "reason": "trivial" }`;

const TRIVIAL_PATTERNS = [
  /^(hi|hello|hey|yo|sup|good\s+(morning|afternoon|evening)|thanks|thank\s*you|ok|okay|bye|goodbye|see\s+ya|cheers|np|no\s+problem)[\s!.?]*$/i,
  /^(yes|no|yeah|nah|yep|nope|sure|alright|fine|got\s+it|cool|nice|great|awesome|perfect)[\s!.?]*$/i,
];

function isTrivialMessage(msg: string): boolean {
  const trimmed = msg.trim();
  if (trimmed.length < 5) return true;
  return TRIVIAL_PATTERNS.some((p) => p.test(trimmed));
}

function buildExtractionPrompt(
  userMessage: string,
  assistantResponse: string,
  today: string,
  userName?: string,
): string {
  let prompt = `Today's date: ${today}\n`;
  if (userName) prompt += `Known user name: ${userName}\n`;
  prompt += `\n--- Conversation Exchange ---\nUser: ${userMessage}\nAssistant: ${assistantResponse}\n--- End ---\n\nExtract facts from this exchange.`;
  return prompt;
}

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

const IDENTITY_KEYWORDS = /\b(prefer|like|dislike|favorite|name is|timezone|lives? in|born|native|language|role is|works? as|occupation|habit|always|never)\b/i;
const PROJECT_KEYWORDS = /\b(project|task|milestone|progress|deploy|sprint|version|release|working on|building|implementing|refactor|migration|autonomous|auto_)/i;

/** Fallback layer classification when LLM doesn't provide one */
function classifyFactLayer(fact: string): MemoryLayer {
  if (IDENTITY_KEYWORDS.test(fact)) return 'identity';
  if (PROJECT_KEYWORDS.test(fact)) return 'projects';
  return 'knowledge';
}

const VALID_LAYERS = new Set<MemoryLayer>(['identity', 'projects', 'knowledge', 'episodes']);

function normalizeFacts(facts: ExtractedFact[]): ExtractedFact[] {
  return facts
    .filter((f) => f.confidence >= 0.5)
    .map((f) => ({
      ...f,
      layer: f.layer && VALID_LAYERS.has(f.layer) ? f.layer : classifyFactLayer(f.fact),
    }));
}

function normalizeRelationships(rels: any[]): ExtractedRelationship[] {
  if (!Array.isArray(rels)) return [];
  return rels
    .filter((r) => r.sourceFact && r.targetFact && r.relationType && r.confidence >= 0.5)
    .map((r) => ({
      sourceFact: r.sourceFact,
      targetFact: r.targetFact,
      relationType: r.relationType,
      confidence: r.confidence,
    }));
}

function parseExtractionResponse(responseText: string): ExtractionResult {
  // First try direct parse
  try {
    const parsed = JSON.parse(responseText);
    return {
      facts: normalizeFacts((parsed.facts as ExtractedFact[]) ?? []),
      relationships: normalizeRelationships(parsed.relationships ?? []),
      skipped: parsed.skipped ?? false,
      reason: parsed.reason,
    };
  } catch {
    // Try to extract JSON block from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          facts: normalizeFacts((parsed.facts as ExtractedFact[]) ?? []),
          relationships: normalizeRelationships(parsed.relationships ?? []),
          skipped: parsed.skipped ?? false,
          reason: parsed.reason,
        };
      } catch {
        // fall through
      }
    }
    return { facts: [], skipped: true, reason: 'parse_error' };
  }
}

export async function extractFacts(
  userMessage: string,
  assistantResponse: string,
  config: MemoryConfig,
  ollamaConfig: OllamaConfig | null,
  anthropicApiKey: string | null,
  userName?: string,
  openaiApiKey?: string | null,
): Promise<ExtractionResult> {
  if (isTrivialMessage(userMessage)) {
    return { facts: [], skipped: true, reason: 'trivial_input' };
  }

  const today = new Date().toISOString().split('T')[0];
  const userPrompt = buildExtractionPrompt(
    userMessage,
    assistantResponse,
    today,
    userName,
  );

  const messages = [
    { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];

  // Use fastModel for extraction (smaller model is sufficient)
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
        streamAnthropicChat(
          anthropicApiKey,
          'claude-haiku-4-5-20251001',
          messages,
        ),
      );
    } else if (openaiApiKey) {
      responseText = await collectStreamResponse(
        streamOpenAIChat(openaiApiKey, 'gpt-4o-mini', messages),
      );
    } else if (extractionOllamaConfig) {
      // Fallback to whatever is available
      responseText = await collectStreamResponse(
        streamOllamaChat(extractionOllamaConfig, messages),
      );
    } else {
      return { facts: [], skipped: true, reason: 'no_llm_available' };
    }
  } catch (err) {
    console.error('[memory] Extraction LLM call failed:', err);
    return { facts: [], skipped: true, reason: 'llm_error' };
  }

  return parseExtractionResponse(responseText);
}
