import { describe, it, expect } from 'vitest';
import { selectProvider } from '../../../src/core/gateway/provider-router.js';
import type { GatewayRuntimeConfig, ClassificationResult } from '../../../src/types/index.js';

function makeConfig(overrides: Partial<GatewayRuntimeConfig> = {}): GatewayRuntimeConfig {
  return {
    bind: '127.0.0.1',
    port: 18789,
    token: 'test-token',
    systemPrompt: null,
    channels: [],
    telegramBotToken: null,
    telegramAllowedUsers: [],
    ollama: { baseUrl: 'http://localhost:11434', model: 'llama3.3:70b' },
    anthropicApiKey: 'sk-test',
    routing: {
      mode: 'hybrid',
      primary: 'ollama',
      rules: [
        { condition: 'simple', provider: 'ollama' },
        { condition: 'default', provider: 'ollama' },
        { condition: 'complex', provider: 'anthropic' },
        { condition: 'coding', provider: 'anthropic' },
      ],
    },
    training: null,
    tools: { deny: [], sandboxMode: 'off', workspaceDir: '/tmp', maxExecutionMs: 30000 },
    session: { idleTimeoutMinutes: 30, maxConcurrent: 100 },
    whisperApiKey: null,
    ...overrides,
  };
}

function makeClassification(classification: string): ClassificationResult {
  return { classification: classification as ClassificationResult['classification'], confidence: 0.8, signals: [] };
}

describe('selectProvider', () => {
  it('routes simple to ollama in hybrid mode', () => {
    const result = selectProvider(makeClassification('simple'), makeConfig());
    expect(result.provider).toBe('ollama');
    expect(result.model).toBe('llama3.3:70b');
  });

  it('routes complex to anthropic in hybrid mode', () => {
    const result = selectProvider(makeClassification('complex'), makeConfig());
    expect(result.provider).toBe('anthropic');
  });

  it('routes coding to anthropic in hybrid mode', () => {
    const result = selectProvider(makeClassification('coding'), makeConfig());
    expect(result.provider).toBe('anthropic');
  });

  it('routes default to ollama in hybrid mode', () => {
    const result = selectProvider(makeClassification('default'), makeConfig());
    expect(result.provider).toBe('ollama');
  });

  it('routes everything to ollama in single mode', () => {
    const config = makeConfig({
      routing: { mode: 'single', primary: 'ollama', rules: [] },
    });
    const result = selectProvider(makeClassification('complex'), config);
    expect(result.provider).toBe('ollama');
  });

  it('falls back to ollama when no matching rule', () => {
    const config = makeConfig({
      routing: { mode: 'hybrid', primary: 'ollama', rules: [] },
    });
    const result = selectProvider(makeClassification('coding'), config);
    expect(result.provider).toBe('ollama');
  });

  it('uses primary when no ollama config but routing says ollama', () => {
    const config = makeConfig({ ollama: null });
    const result = selectProvider(makeClassification('simple'), config);
    // Router follows routing rules regardless of ollama config availability
    expect(result.provider).toBe('ollama');
    expect(result.classification).toBe('simple');
  });

  it('includes classification in result', () => {
    const result = selectProvider(makeClassification('coding'), makeConfig());
    expect(result.classification).toBe('coding');
  });
});
