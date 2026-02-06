// ============================================================
// OpenClaw Deploy — Cloud Model Catalog & Provider Signup Info
// ============================================================

import type { LlmProvider } from '../../types/index.js';

// ---------------------------------------------------------------------------
// Cloud model definitions
// ---------------------------------------------------------------------------

export interface CloudModel {
  id: string;
  name: string;
  provider: LlmProvider;
  tier: 'free' | 'paid';
  description: string;
}

const CLOUD_MODELS: CloudModel[] = [
  // Anthropic
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'anthropic', tier: 'paid', description: 'Most capable — best for complex reasoning and coding' },
  { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', provider: 'anthropic', tier: 'paid', description: 'Fast and capable — great balance of speed and quality' },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', provider: 'anthropic', tier: 'paid', description: 'Fastest and cheapest — good for simple tasks' },

  // OpenAI
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', tier: 'paid', description: 'Flagship model — multimodal, fast' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai', tier: 'paid', description: 'Small and affordable — good for simple tasks' },
  { id: 'o3', name: 'o3', provider: 'openai', tier: 'paid', description: 'Advanced reasoning model' },

  // Gemini
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'gemini', tier: 'paid', description: 'Most capable Gemini model' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'gemini', tier: 'free', description: 'Fast and free — great for getting started' },
];

export function getModelsForProvider(provider: LlmProvider): CloudModel[] {
  return CLOUD_MODELS.filter((m) => m.provider === provider);
}

export function getDefaultModel(provider: LlmProvider): string {
  const models = getModelsForProvider(provider);
  return models.length > 0 ? models[0].id : '';
}

// ---------------------------------------------------------------------------
// Provider signup info
// ---------------------------------------------------------------------------

export interface ProviderSignup {
  provider: LlmProvider;
  name: string;
  signupUrl: string;
  keysUrl: string;
  freeCredits?: string;
  freeTier?: boolean;
  instructions: string[];
}

const PROVIDER_SIGNUP: Record<string, ProviderSignup> = {
  anthropic: {
    provider: 'anthropic',
    name: 'Anthropic',
    signupUrl: 'https://console.anthropic.com/',
    keysUrl: 'https://console.anthropic.com/settings/keys',
    freeCredits: '$5 free credits',
    instructions: [
      'Sign up at console.anthropic.com',
      'Go to Settings > API Keys',
      'Click "Create Key" and copy it',
    ],
  },
  openai: {
    provider: 'openai',
    name: 'OpenAI',
    signupUrl: 'https://platform.openai.com/signup',
    keysUrl: 'https://platform.openai.com/api-keys',
    instructions: [
      'Sign up at platform.openai.com',
      'Go to API Keys in your dashboard',
      'Click "Create new secret key" and copy it',
    ],
  },
  gemini: {
    provider: 'gemini',
    name: 'Google Gemini',
    signupUrl: 'https://aistudio.google.com/',
    keysUrl: 'https://aistudio.google.com/apikey',
    freeTier: true,
    instructions: [
      'Go to aistudio.google.com/apikey',
      'Sign in with your Google account',
      'Click "Create API Key" and copy it',
    ],
  },
  openrouter: {
    provider: 'openrouter',
    name: 'OpenRouter',
    signupUrl: 'https://openrouter.ai/',
    keysUrl: 'https://openrouter.ai/keys',
    freeCredits: 'Some free models available',
    instructions: [
      'Sign up at openrouter.ai',
      'Go to Keys in your dashboard',
      'Create a new key and copy it',
    ],
  },
};

export function getProviderSignup(provider: LlmProvider): ProviderSignup | undefined {
  return PROVIDER_SIGNUP[provider];
}
