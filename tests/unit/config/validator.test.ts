import { describe, it, expect } from 'vitest';
import { validateApiKey, validateConfig } from '../../../src/core/config/validator.js';

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

describe('validateApiKey', () => {
  it('detects Anthropic keys (sk-ant-xxx)', () => {
    const result = validateApiKey('sk-ant-api03-abcdef');
    expect(result.valid).toBe(true);
    expect(result.provider).toBe('anthropic');
  });

  it('detects OpenAI keys (sk-xxx)', () => {
    const result = validateApiKey('sk-proj-abcdef1234567890');
    expect(result.valid).toBe(true);
    expect(result.provider).toBe('openai');
  });

  it('detects Gemini keys (AI...)', () => {
    const result = validateApiKey('AIzaSyB1234567890');
    expect(result.valid).toBe(true);
    expect(result.provider).toBe('gemini');
  });

  it('returns null provider for empty key', () => {
    const result = validateApiKey('');
    expect(result.valid).toBe(false);
    expect(result.provider).toBeNull();
  });

  it('returns null provider for whitespace-only key', () => {
    const result = validateApiKey('   ');
    expect(result.valid).toBe(false);
    expect(result.provider).toBeNull();
  });

  it('returns null provider for very short invalid key', () => {
    const result = validateApiKey('abc');
    expect(result.valid).toBe(false);
    expect(result.provider).toBeNull();
  });

  it('falls back to openrouter for long unrecognized keys', () => {
    const result = validateApiKey('some-long-unrecognized-key-value');
    expect(result.valid).toBe(true);
    expect(result.provider).toBe('openrouter');
  });
});

describe('validateConfig', () => {
  it('accepts valid config', () => {
    const result = validateConfig(validConfig());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects invalid config', () => {
    const result = validateConfig({ llm: {} });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects config with missing required fields', () => {
    const result = validateConfig({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects config with invalid port', () => {
    const cfg = validConfig();
    cfg.gateway.port = 100;
    const result = validateConfig(cfg);
    expect(result.valid).toBe(false);
  });
});
