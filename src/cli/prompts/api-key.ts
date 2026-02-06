// ============================================================
// OpenClaw Deploy — API Key Prompt
// ============================================================

import { input, confirm } from '@inquirer/prompts';
import { validateApiKey } from '../../core/config/validator.js';
import type { LlmProvider } from '../../types/index.js';

export async function promptApiKey(): Promise<{ provider: LlmProvider; apiKey: string }> {
  const apiKey = await input({
    message: 'Paste your LLM API key:',
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return 'API key is required.';
      }
      return true;
    },
  });

  const result = validateApiKey(apiKey.trim());

  if (!result.valid || !result.provider) {
    throw new Error('Could not detect a valid LLM provider from the API key format.');
  }

  const providerNames: Record<LlmProvider, string> = {
    anthropic: 'Anthropic (Claude)',
    openai: 'OpenAI',
    gemini: 'Google Gemini',
    openrouter: 'OpenRouter',
  };

  const confirmed = await confirm({
    message: `Detected provider: ${providerNames[result.provider]}. Is that correct?`,
    default: true,
  });

  if (!confirmed) {
    throw new Error('Provider detection rejected. Please re-run and enter a different key.');
  }

  return { provider: result.provider, apiKey: apiKey.trim() };
}
