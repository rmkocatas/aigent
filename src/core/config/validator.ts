// ============================================================
// OpenClaw Deploy — Config Validation Utility
// ============================================================

import type { LlmProvider } from '../../types/index.js';
import { DeploymentConfigSchema } from './schema.js';

// ---------------------------------------------------------------------------
// Full config validation
// ---------------------------------------------------------------------------

export function validateConfig(config: unknown): {
  valid: boolean;
  errors: string[];
} {
  const result = DeploymentConfigSchema.safeParse(config);
  if (result.success) {
    return { valid: true, errors: [] };
  }
  return {
    valid: false,
    errors: result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`
    ),
  };
}

// ---------------------------------------------------------------------------
// API key format detection
// ---------------------------------------------------------------------------

export function validateApiKey(key: string, provider?: LlmProvider): {
  valid: boolean;
  provider: LlmProvider | null;
} {
  // Ollama does not require an API key
  if (provider === 'ollama' && (!key || key.trim().length === 0)) {
    return { valid: true, provider: 'ollama' };
  }

  if (!key || key.trim().length === 0) {
    return { valid: false, provider: null };
  }

  const trimmed = key.trim();

  // Anthropic keys start with 'sk-ant-'
  if (trimmed.startsWith('sk-ant-')) {
    return { valid: true, provider: 'anthropic' };
  }

  // OpenAI keys start with 'sk-' (but not 'sk-ant-')
  if (trimmed.startsWith('sk-')) {
    return { valid: true, provider: 'openai' };
  }

  // Google AI / Gemini keys start with 'AI'
  if (trimmed.startsWith('AI')) {
    return { valid: true, provider: 'gemini' };
  }

  // If the key has reasonable length, assume openrouter; otherwise invalid
  if (trimmed.length >= 10) {
    return { valid: true, provider: 'openrouter' };
  }

  return { valid: false, provider: null };
}

// ---------------------------------------------------------------------------
// Ollama connection validation
// ---------------------------------------------------------------------------

export async function validateOllamaConnection(baseUrl: string): Promise<{
  valid: boolean;
  models?: string[];
  error?: string;
}> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`);
    if (!response.ok) {
      return { valid: false, error: `Ollama returned HTTP ${response.status}` };
    }
    const data = await response.json() as { models?: Array<{ name: string }> };
    const models = data.models?.map((m) => m.name) ?? [];
    return { valid: true, models };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { valid: false, error: `Cannot connect to Ollama at ${baseUrl}: ${message}` };
  }
}
