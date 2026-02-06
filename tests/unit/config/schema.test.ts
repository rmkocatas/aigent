import { describe, it, expect } from 'vitest';
import {
  DeploymentConfigSchema,
  validateDeploymentConfig,
} from '../../../src/core/config/schema.js';

function validConfig() {
  return {
    llm: {
      provider: 'anthropic',
      apiKey: 'sk-ant-test-key-123',
    },
    channels: [{ id: 'webchat', enabled: true }],
    securityLevel: 'L2',
    gateway: {
      bind: 'loopback',
      port: 18789,
    },
    deployment: {
      mode: 'docker',
      workspace: '/home/user/workspace',
      installDir: '/home/user/.openclaw',
    },
  };
}

describe('DeploymentConfigSchema', () => {
  it('accepts a valid DeploymentConfig', () => {
    const result = DeploymentConfigSchema.safeParse(validConfig());
    expect(result.success).toBe(true);
  });

  it('rejects config with missing apiKey', () => {
    const cfg = validConfig();
    cfg.llm.apiKey = '';
    const result = DeploymentConfigSchema.safeParse(cfg);
    expect(result.success).toBe(false);
  });

  it('rejects config with port 0', () => {
    const cfg = validConfig();
    cfg.gateway.port = 0;
    const result = DeploymentConfigSchema.safeParse(cfg);
    expect(result.success).toBe(false);
  });

  it('rejects config with port 99999', () => {
    const cfg = validConfig();
    cfg.gateway.port = 99999;
    const result = DeploymentConfigSchema.safeParse(cfg);
    expect(result.success).toBe(false);
  });

  it('rejects config with invalid provider', () => {
    const cfg = validConfig() as Record<string, unknown>;
    (cfg.llm as Record<string, unknown>).provider = 'invalid-provider';
    const result = DeploymentConfigSchema.safeParse(cfg);
    expect(result.success).toBe(false);
  });

  it('rejects config with invalid security level', () => {
    const cfg = validConfig() as Record<string, unknown>;
    cfg.securityLevel = 'L9';
    const result = DeploymentConfigSchema.safeParse(cfg);
    expect(result.success).toBe(false);
  });

  it('accepts a valid channel selection', () => {
    const cfg = validConfig();
    cfg.channels = [
      { id: 'webchat', enabled: true },
      { id: 'discord', enabled: false },
    ];
    const result = DeploymentConfigSchema.safeParse(cfg);
    expect(result.success).toBe(true);
  });
});

describe('validateDeploymentConfig', () => {
  it('returns success true for valid config', () => {
    const result = validateDeploymentConfig(validConfig());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.securityLevel).toBe('L2');
    }
  });

  it('returns success false with errors for invalid config', () => {
    const result = validateDeploymentConfig({ llm: {} });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
});
