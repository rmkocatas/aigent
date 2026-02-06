// ============================================================
// OpenClaw Deploy — Hardened Default Configuration
// ============================================================

import type { DeploymentConfig, LlmProvider, SecurityLevel, TrainingConfig } from '../../types/index.js';

// Fallback security-level gateway binds in case security/levels.js
// is not yet available. These are replaced at runtime when the
// security module is loaded.
const GATEWAY_BIND_BY_LEVEL: Record<SecurityLevel, DeploymentConfig['gateway']['bind']> = {
  L1: 'loopback',
  L2: 'loopback',
  L3: 'loopback',
};

const GATEWAY_PORT = 18789;

/**
 * Returns a hardened default DeploymentConfig for the given security level.
 * Users are expected to fill in secrets (apiKey, tokens) before deployment.
 */
export function getDefaults(
  securityLevel: SecurityLevel = 'L2',
  provider: LlmProvider = 'anthropic',
  availableMemoryMB?: number,
): DeploymentConfig {
  const llm: DeploymentConfig['llm'] = provider === 'ollama'
    ? {
        provider: 'ollama',
        apiKey: '',
        model: (availableMemoryMB && availableMemoryMB < 16384)
          ? 'llama3.1:8b'
          : 'llama3.3:70b',
        ollama: {
          baseUrl: 'http://localhost:11434',
          model: (availableMemoryMB && availableMemoryMB < 16384)
            ? 'llama3.1:8b'
            : 'llama3.3:70b',
        },
      }
    : {
        provider,
        apiKey: '',
        model: 'claude-opus-4-6',
      };

  const training: TrainingConfig | undefined = provider === 'ollama'
    ? {
        enabled: false,
        dataDir: '~/.openclaw/training',
        autoCollect: true,
        minEntriesForTraining: 500,
        autoTrain: false,
        baseModel: llm.ollama?.model ?? 'llama3.1:8b',
        loraRank: 16,
        epochs: 3,
      }
    : undefined;

  return {
    llm,
    channels: [
      { id: 'webchat', enabled: true },
    ],
    securityLevel,
    gateway: {
      bind: GATEWAY_BIND_BY_LEVEL[securityLevel],
      port: GATEWAY_PORT,
    },
    deployment: {
      mode: 'docker',
      workspace: '~/.openclaw/workspace',
      installDir: '~/.openclaw',
    },
    ...(training ? { training } : {}),
  };
}
