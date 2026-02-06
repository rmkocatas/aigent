// ============================================================
// OpenClaw Deploy — Zod Validation Schemas
// ============================================================

import { z } from 'zod';
import type { DeploymentConfig } from '../../types/index.js';

// --- Atomic Schemas ---

const LlmProviderEnum = z.enum(['anthropic', 'openai', 'gemini', 'openrouter']);

export const LlmProviderSchema = z.object({
  provider: LlmProviderEnum,
  apiKey: z.string().min(1, 'API key must not be empty'),
  model: z.string().optional(),
});

const GatewayBindEnum = z.enum(['loopback', 'lan', 'tailnet', 'custom']);
const AuthModeEnum = z.enum(['token']);

export const GatewayConfigSchema = z.object({
  bind: GatewayBindEnum,
  port: z.number().int().min(1024, 'Port must be >= 1024').max(65535, 'Port must be <= 65535'),
  auth: z.object({
    mode: AuthModeEnum,
  }).optional(),
});

const ChannelIdEnum = z.enum([
  'webchat',
  'whatsapp',
  'telegram',
  'discord',
  'slack',
  'signal',
]);

export const ChannelSelectionSchema = z.object({
  id: ChannelIdEnum,
  enabled: z.boolean(),
  token: z.string().optional(),
  config: z.record(z.unknown()).optional(),
});

const SecurityLevelEnum = z.enum(['L1', 'L2', 'L3']);

export const DeploymentConfigSchema = z.object({
  llm: LlmProviderSchema,
  channels: z.array(ChannelSelectionSchema).min(1, 'At least one channel is required'),
  securityLevel: SecurityLevelEnum,
  gateway: z.object({
    bind: GatewayBindEnum,
    port: z.number().int().min(1024).max(65535),
  }),
  deployment: z.object({
    mode: z.enum(['docker', 'native']),
    workspace: z.string().min(1),
    installDir: z.string().min(1),
  }),
  tls: z.object({
    enabled: z.boolean(),
    domain: z.string().optional(),
    email: z.string().email().optional(),
  }).optional(),
});

// --- Validation Function ---

export function validateDeploymentConfig(input: unknown): {
  success: true;
  data: DeploymentConfig;
} | {
  success: false;
  errors: string[];
} {
  const result = DeploymentConfigSchema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data as DeploymentConfig };
  }
  return {
    success: false,
    errors: result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`
    ),
  };
}
