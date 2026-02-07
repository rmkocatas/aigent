import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadGatewayConfig } from '../../../src/core/gateway/config-loader.js';

describe('loadGatewayConfig', () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), 'openclaw-cfg-'));
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  async function writeConfig(json: Record<string, unknown>, env = '') {
    await writeFile(join(configDir, 'openclaw.json'), JSON.stringify(json, null, 2));
    await writeFile(join(configDir, '.env'), env);
  }

  it('loads minimal config', async () => {
    await writeConfig(
      {
        gateway: { port: 9000, bind: '0.0.0.0', auth: { token: 'tok123' } },
        ollama: { baseUrl: 'http://localhost:11434', model: 'llama3.3:70b' },
      },
    );
    const config = await loadGatewayConfig(configDir);
    expect(config.port).toBe(9000);
    expect(config.bind).toBe('0.0.0.0');
    expect(config.ollama?.model).toBe('llama3.3:70b');
  });

  it('resolves env vars in token', async () => {
    await writeConfig(
      {
        gateway: { port: 9000, bind: '127.0.0.1', auth: { token: '${MY_TOKEN}' } },
      },
      'MY_TOKEN=secret123',
    );
    const config = await loadGatewayConfig(configDir);
    expect(config.token).toBe('secret123');
  });

  it('reads anthropic key from env', async () => {
    await writeConfig(
      {
        gateway: { port: 9000, bind: '127.0.0.1', token: 'tok' },
      },
      'ANTHROPIC_API_KEY=sk-test-key',
    );
    const config = await loadGatewayConfig(configDir);
    expect(config.anthropicApiKey).toBe('sk-test-key');
  });

  it('throws when config file is missing', async () => {
    await expect(loadGatewayConfig(configDir)).rejects.toThrow();
  });

  it('handles config with routing rules', async () => {
    await writeConfig({
      gateway: { port: 9000, bind: '127.0.0.1', token: 'tok' },
      routing: {
        mode: 'hybrid',
        primary: 'ollama',
        rules: [
          { condition: 'coding', provider: 'anthropic' },
        ],
      },
    });
    const config = await loadGatewayConfig(configDir);
    expect(config.routing?.mode).toBe('hybrid');
    expect(config.routing?.rules).toHaveLength(1);
  });

  it('sets defaults for session config', async () => {
    await writeConfig({
      gateway: { port: 9000, bind: '127.0.0.1', token: 'tok' },
    });
    const config = await loadGatewayConfig(configDir);
    expect(config.session.idleTimeoutMinutes).toBeGreaterThan(0);
    expect(config.session.maxConcurrent).toBeGreaterThan(0);
  });
});
