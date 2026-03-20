import type { ClassificationResult, GatewayRuntimeConfig, ProviderSelection } from '../../types/index.js';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-5-20250929';
export const DEFAULT_HAIKU_MODEL = 'claude-haiku-4-5-20251001';
export const DEFAULT_OPUS_MODEL = 'claude-opus-4-6';
export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
export const DEFAULT_OPENAI_STRONG_MODEL = 'gpt-4o';

/** Returns the best available cloud provider + default model, or null if none available. */
export function getCloudFallback(
  config: GatewayRuntimeConfig,
  strength: 'default' | 'strong' = 'default',
): { provider: string; model: string } | null {
  if (config.openaiApiKey) {
    return {
      provider: 'openai',
      model: strength === 'strong' ? DEFAULT_OPENAI_STRONG_MODEL : DEFAULT_OPENAI_MODEL,
    };
  }
  if (config.anthropicApiKey) {
    return {
      provider: 'anthropic',
      model: strength === 'strong' ? DEFAULT_OPUS_MODEL : DEFAULT_ANTHROPIC_MODEL,
    };
  }
  return null;
}

export function selectProvider(
  classification: ClassificationResult,
  config: GatewayRuntimeConfig,
): ProviderSelection {
  const ollamaModel = config.ollama?.model ?? 'llama3.3:70b';

  // Single mode: always use Ollama
  if (!config.routing || config.routing.mode !== 'hybrid') {
    return {
      provider: 'ollama',
      model: ollamaModel,
      classification: classification.classification,
    };
  }

  // Hybrid mode: match routing rules
  const rules = config.routing.rules ?? [];
  const matched = rules.find((r) => r.condition === classification.classification);
  const defaultRule = rules.find((r) => r.condition === 'default');
  const rule = matched ?? defaultRule;

  if (!rule) {
    // No rules at all — use primary
    const primary = config.routing.primary ?? 'ollama';
    return {
      provider: primary,
      model: primary === 'ollama' ? ollamaModel : DEFAULT_ANTHROPIC_MODEL,
      classification: classification.classification,
    };
  }

  const provider = rule.provider;
  let model: string;

  if (rule.model) {
    model = rule.model;
  } else if (provider === 'ollama') {
    model = ollamaModel;
  } else {
    // Default model based on classification when no explicit model in rule
    model = getDefaultModelForClassification(classification.classification);
  }

  return { provider, model, classification: classification.classification };
}

function getDefaultModelForClassification(classification: string): string {
  switch (classification) {
    case 'tool_simple':
      return DEFAULT_HAIKU_MODEL;
    case 'web_content':
      return DEFAULT_OPUS_MODEL;
    default:
      return DEFAULT_ANTHROPIC_MODEL;
  }
}
