// ============================================================
// OpenClaw Deploy — LLM Provider Selection Prompt
// ============================================================

import { input, select, confirm } from '@inquirer/prompts';
import ora from 'ora';
import open from 'open';
import { validateApiKey } from '../../core/config/validator.js';
import {
  ensureOllamaReady,
  getRecommendedModels,
} from '../../core/detect/ollama.js';
import {
  getModelsForProvider,
  getDefaultModel,
  getProviderSignup,
} from '../../core/config/models.js';
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
  type BackendChoice = LlmProvider | 'hybrid';

  const choices: { name: string; value: BackendChoice; description?: string }[] = [
    {
      name: env.ollamaAvailable
        ? 'Ollama (free, runs locally) [recommended]'
        : 'Ollama (free, runs locally)',
      value: 'ollama' as const,
      description: env.ollamaAvailable ? 'Detected on this machine' : 'Not detected — will be installed automatically',
    },
    {
      name: 'Anthropic API (Claude)',
      value: 'anthropic' as const,
      description: '$5 free credits on signup',
    },
    { name: 'OpenAI API (GPT-4o)', value: 'openai' as const },
    {
      name: 'Google Gemini',
      value: 'gemini' as const,
      description: 'Free tier available',
    },
    { name: 'OpenRouter (access all models)', value: 'openrouter' as const },
    {
      name: 'Hybrid (Ollama for simple + Cloud for complex)',
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
  const model = await pickOrPullModel(env);

  return {
    provider: 'ollama',
    apiKey: '',
    ollama: { baseUrl, model },
  };
}

async function pickOrPullModel(env: DetectedEnvironment): Promise<string> {
  const installedModels = env.ollamaAvailable ? (env.ollamaModels ?? []) : [];

  if (installedModels.length > 0) {
    const choices = [
      ...installedModels.map((m) => ({ name: m, value: m })),
      { name: 'Pull a new model...', value: '__pull_new__' },
    ];

    const selection = await select<string>({
      message: 'Select an Ollama model:',
      choices,
    });

    if (selection !== '__pull_new__') {
      return selection;
    }
  }

  // No models or user wants a new one — recommend based on RAM and pull
  const recommended = getRecommendedModels(env.availableMemoryMB);
  const pullChoices = recommended.length > 0
    ? recommended.map((m) => ({
        name: `${m.name} — ${m.description}`,
        value: m.name,
      }))
    : [{ name: 'llama3.2:1b — minimal, runs on almost anything', value: 'llama3.2:1b' }];

  pullChoices.push({ name: 'Enter a custom model name...', value: '__custom__' });

  let modelToPull = await select<string>({
    message: 'Which model should we download?',
    choices: pullChoices,
  });

  if (modelToPull === '__custom__') {
    modelToPull = await input({
      message: 'Model name (e.g. mistral, codellama:13b):',
      validate: (v) => (v.trim().length > 0 ? true : 'Model name is required'),
    });
    modelToPull = modelToPull.trim();
  }

  // Ensure Ollama is installed and pull the model
  const spinner = ora(`Setting up ${modelToPull}...`).start();
  const result = await ensureOllamaReady(modelToPull, env.availableMemoryMB, (msg) => {
    spinner.text = msg;
  });

  if (result.ready) {
    spinner.succeed(`${result.model} is ready`);
    if (result.installedOllama) {
      console.log('  Ollama was installed automatically.');
    }
    return result.model;
  } else {
    spinner.fail(result.error ?? `Failed to set up ${modelToPull}`);
    throw new Error(result.error ?? 'Could not set up Ollama model');
  }
}

// ---------------------------------------------------------------------------
// Hybrid flow
// ---------------------------------------------------------------------------

async function handleHybridSelection(env: DetectedEnvironment): Promise<LlmProviderConfig> {
  const baseUrl = 'http://127.0.0.1:11434';

  // Pick/pull Ollama model for simple tasks
  const ollamaModel = await pickOrPullModel(env);

  // Get cloud API key with signup assistance
  const { apiKey, provider: cloudProvider } = await getApiKeyWithSignup('anthropic');

  return {
    provider: 'ollama',
    apiKey,
    ollama: { baseUrl, model: ollamaModel },
    routing: {
      mode: 'hybrid',
      primary: 'ollama',
      fallback: cloudProvider,
    },
  };
}

// ---------------------------------------------------------------------------
// Cloud provider flow
// ---------------------------------------------------------------------------

async function handleCloudSelection(provider: LlmProvider): Promise<LlmProviderConfig> {
  // Get API key with signup assistance
  const { apiKey, provider: confirmedProvider } = await getApiKeyWithSignup(provider);

  // Pick a model
  const model = await pickCloudModel(confirmedProvider);

  return { provider: confirmedProvider, apiKey, model };
}

// ---------------------------------------------------------------------------
// API key with signup assistance
// ---------------------------------------------------------------------------

async function getApiKeyWithSignup(provider: LlmProvider): Promise<{ apiKey: string; provider: LlmProvider }> {
  const signup = getProviderSignup(provider);

  const hasKey = await select<string>({
    message: `Do you have a ${providerNames[provider]} API key?`,
    choices: [
      { name: 'Yes, I have one', value: 'yes' },
      { name: 'No, help me get one', value: 'no' },
    ],
  });

  if (hasKey === 'no' && signup) {
    console.log('');
    console.log(`  To get a ${signup.name} API key:`);
    for (const step of signup.instructions) {
      console.log(`    - ${step}`);
    }
    if (signup.freeCredits) {
      console.log(`    (${signup.freeCredits})`);
    }
    if (signup.freeTier) {
      console.log('    (Free tier available)');
    }
    console.log('');

    const openBrowser = await confirm({
      message: `Open ${signup.keysUrl} in your browser?`,
      default: true,
    });

    if (openBrowser) {
      await open(signup.keysUrl);
      console.log('\n  Browser opened. Copy your API key and paste it below.\n');
    }
  }

  const apiKey = await input({
    message: `Paste your ${providerNames[provider]} API key:`,
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
  let confirmedProvider = provider;
  if (result.provider !== provider) {
    const useDetected = await confirm({
      message: `Key format suggests ${providerNames[result.provider]}, but you selected ${providerNames[provider]}. Use detected provider?`,
      default: true,
    });

    if (useDetected) {
      confirmedProvider = result.provider;
    }
  }

  return { apiKey: apiKey.trim(), provider: confirmedProvider };
}

// ---------------------------------------------------------------------------
// Cloud model picker
// ---------------------------------------------------------------------------

async function pickCloudModel(provider: LlmProvider): Promise<string> {
  const models = getModelsForProvider(provider);

  if (models.length === 0) {
    // OpenRouter or unknown — let user type model ID
    return input({
      message: 'Enter the model ID to use:',
      default: getDefaultModel(provider) || undefined,
      validate: (v) => (v.trim().length > 0 ? true : 'Model ID is required'),
    });
  }

  const choices = [
    ...models.map((m) => ({
      name: `${m.name}${m.tier === 'free' ? ' (free)' : ''} — ${m.description}`,
      value: m.id,
    })),
    { name: 'Enter a custom model ID...', value: '__custom__' },
  ];

  const selection = await select<string>({
    message: 'Which model?',
    choices,
  });

  if (selection === '__custom__') {
    return input({
      message: 'Model ID:',
      validate: (v) => (v.trim().length > 0 ? true : 'Model ID is required'),
    });
  }

  return selection;
}
