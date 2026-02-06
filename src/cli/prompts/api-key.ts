// ============================================================
// OpenClaw Deploy — LLM Provider Selection Prompt
// ============================================================

import { input, select, confirm } from '@inquirer/prompts';
import { validateApiKey } from '../../core/config/validator.js';
import type {
  LlmProvider,
  LlmProviderConfig,
  DetectedEnvironment,
} from '../../types/index.js';

// ---------------------------------------------------------------------------
// Provider display names
// ---------------------------------------------------------------------------

const providerNames: Record<LlmProvider, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  openrouter: 'OpenRouter',
  ollama: 'Ollama',
};

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function promptApiKey(env: DetectedEnvironment): Promise<LlmProviderConfig> {
  // Build choices based on environment
  type BackendChoice = LlmProvider | 'hybrid';

  const choices: { name: string; value: BackendChoice; description?: string }[] = [
    {
      name: env.ollamaAvailable
        ? 'Ollama (free, runs locally) [recommended]'
        : 'Ollama (free, runs locally)',
      value: 'ollama' as const,
      description: env.ollamaAvailable ? 'Detected on this machine' : 'Not detected — install from ollama.com',
    },
    { name: 'Anthropic API ($5 free credits)', value: 'anthropic' as const },
    { name: 'OpenAI API', value: 'openai' as const },
    { name: 'Google Gemini (free tier)', value: 'gemini' as const },
    { name: 'OpenRouter', value: 'openrouter' as const },
    {
      name: 'Hybrid (Ollama for simple + Claude for complex)',
      value: 'hybrid' as const,
      description: 'Use local Ollama for simple tasks, cloud API for complex ones',
    },
  ];

  const backend = await select<BackendChoice>({
    message: 'Which LLM backend?',
    choices,
  });

  if (backend === 'ollama') {
    return handleOllamaSelection(env);
  }

  if (backend === 'hybrid') {
    return handleHybridSelection(env);
  }

  return handleCloudSelection(backend);
}

// ---------------------------------------------------------------------------
// Ollama flow
// ---------------------------------------------------------------------------

async function handleOllamaSelection(env: DetectedEnvironment): Promise<LlmProviderConfig> {
  const baseUrl = 'http://127.0.0.1:11434';

  if (!env.ollamaAvailable) {
    console.log(
      "\n  Ollama is not detected. Install it from https://ollama.com and run 'ollama pull llama3.3' to download a model.\n",
    );
  }

  let model = 'llama3.3';

  if (env.ollamaModels && env.ollamaModels.length > 0) {
    model = await select<string>({
      message: 'Select an Ollama model:',
      choices: env.ollamaModels.map((m) => ({ name: m, value: m })),
    });
  } else {
    console.log("  No models detected. Run 'ollama pull llama3.3' to download a model.");
  }

  return {
    provider: 'ollama',
    apiKey: '',
    ollama: { baseUrl, model },
  };
}

// ---------------------------------------------------------------------------
// Hybrid flow
// ---------------------------------------------------------------------------

async function handleHybridSelection(env: DetectedEnvironment): Promise<LlmProviderConfig> {
  const baseUrl = 'http://127.0.0.1:11434';

  // Pick Ollama model for simple tasks
  let ollamaModel = 'llama3.3';

  if (env.ollamaModels && env.ollamaModels.length > 0) {
    ollamaModel = await select<string>({
      message: 'Select an Ollama model for simple tasks:',
      choices: env.ollamaModels.map((m) => ({ name: m, value: m })),
    });
  } else {
    console.log("  No Ollama models detected. Run 'ollama pull llama3.3' to download a model.");
  }

  // Ask for cloud API key
  const apiKey = await input({
    message: 'Paste your cloud API key (Anthropic recommended):',
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return 'API key is required for hybrid mode.';
      }
      return true;
    },
  });

  const result = validateApiKey(apiKey.trim());

  if (!result.valid || !result.provider) {
    throw new Error('Could not detect a valid LLM provider from the API key format.');
  }

  const confirmed = await confirm({
    message: `Detected cloud provider: ${providerNames[result.provider]}. Is that correct?`,
    default: true,
  });

  if (!confirmed) {
    throw new Error('Provider detection rejected. Please re-run and enter a different key.');
  }

  return {
    provider: 'ollama',
    apiKey: apiKey.trim(),
    ollama: { baseUrl, model: ollamaModel },
    routing: {
      mode: 'hybrid',
      primary: 'ollama',
      fallback: result.provider,
    },
  };
}

// ---------------------------------------------------------------------------
// Cloud provider flow
// ---------------------------------------------------------------------------

async function handleCloudSelection(provider: LlmProvider): Promise<LlmProviderConfig> {
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

  // Verify detected provider matches selection
  if (result.provider !== provider) {
    const confirmed = await confirm({
      message: `Key format suggests ${providerNames[result.provider]}, but you selected ${providerNames[provider]}. Use detected provider?`,
      default: true,
    });

    if (confirmed) {
      provider = result.provider;
    }
  }

  return { provider, apiKey: apiKey.trim() };
}
