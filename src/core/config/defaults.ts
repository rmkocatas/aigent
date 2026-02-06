// ============================================================
// OpenClaw Deploy — Hardened Default Configuration
// ============================================================

import type { DeploymentConfig, SecurityLevel } from '../../types/index.js';

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
export function getDefaults(securityLevel: SecurityLevel = 'L2'): DeploymentConfig {
  return {
    llm: {
      provider: 'anthropic',
      apiKey: '',
      model: 'claude-opus-4-6',
    },
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
  };
}
