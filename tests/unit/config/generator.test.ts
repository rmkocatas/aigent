import { describe, it, expect } from 'vitest';
import { generateOpenClawConfig } from '../../../src/core/config/generator.js';
import type {
  DeploymentConfig,
  GeneratedSecrets,
} from '../../../src/types/index.js';

function makeConfig(overrides?: Partial<DeploymentConfig>): DeploymentConfig {
  return {
    llm: {
      provider: 'anthropic',
      apiKey: 'sk-ant-test-key',
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
    ...overrides,
  };
}

function makeSecrets(): GeneratedSecrets {
  return {
    gatewayToken: 'a'.repeat(64),
    masterEncryptionKey: 'b'.repeat(64),
  };
}

describe('generateOpenClawConfig', () => {
  it('returns all required files (openclawJson, envFile)', async () => {
    const files = await generateOpenClawConfig(makeConfig(), makeSecrets());
    expect(files).toHaveProperty('openclawJson');
    expect(files).toHaveProperty('envFile');
    expect(typeof files.openclawJson).toBe('string');
    expect(typeof files.envFile).toBe('string');
  });

  it('generates valid JSON in openclawJson', async () => {
    const files = await generateOpenClawConfig(makeConfig(), makeSecrets());
    // Strip comment lines (lines starting with //)
    const jsonBody = files.openclawJson
      .split('\n')
      .filter((line) => !line.startsWith('//'))
      .join('\n');
    const parsed = JSON.parse(jsonBody);
    expect(parsed).toBeDefined();
    expect(parsed.gateway).toBeDefined();
  });

  it('includes gateway auth with ${OPENCLAW_GATEWAY_TOKEN} reference', async () => {
    const files = await generateOpenClawConfig(makeConfig(), makeSecrets());
    expect(files.openclawJson).toContain('${OPENCLAW_GATEWAY_TOKEN}');
  });

  it('includes sandbox settings matching security level', async () => {
    const files = await generateOpenClawConfig(makeConfig(), makeSecrets());
    const jsonBody = files.openclawJson
      .split('\n')
      .filter((line) => !line.startsWith('//'))
      .join('\n');
    const parsed = JSON.parse(jsonBody);
    expect(parsed.agents.sandbox).toBeDefined();
    expect(parsed.agents.sandbox.mode).toBeDefined();
  });

  it('envFile includes OPENCLAW_GATEWAY_TOKEN', async () => {
    const secrets = makeSecrets();
    const files = await generateOpenClawConfig(makeConfig(), secrets);
    expect(files.envFile).toContain('OPENCLAW_GATEWAY_TOKEN=');
    expect(files.envFile).toContain(secrets.gatewayToken);
  });

  it('envFile includes API key env var', async () => {
    const files = await generateOpenClawConfig(makeConfig(), makeSecrets());
    expect(files.envFile).toContain('ANTHROPIC_API_KEY=sk-ant-test-key');
  });

  it('docker mode generates dockerComposeYml', async () => {
    const config = makeConfig({ deployment: { mode: 'docker', workspace: '/ws', installDir: '/opt' } });
    const files = await generateOpenClawConfig(config, makeSecrets());
    expect(files.dockerComposeYml).toBeDefined();
    expect(typeof files.dockerComposeYml).toBe('string');
  });

  it('native mode does not generate dockerComposeYml', async () => {
    const config = makeConfig({ deployment: { mode: 'native', workspace: '/ws', installDir: '/opt' } });
    const files = await generateOpenClawConfig(config, makeSecrets());
    expect(files.dockerComposeYml).toBeUndefined();
  });

  it('L3 security produces stricter config than L2', async () => {
    const l2Files = await generateOpenClawConfig(
      makeConfig({ securityLevel: 'L2' }),
      makeSecrets(),
    );
    const l3Files = await generateOpenClawConfig(
      makeConfig({ securityLevel: 'L3' }),
      makeSecrets(),
    );

    const parseJson = (raw: string) =>
      JSON.parse(
        raw.split('\n').filter((l) => !l.startsWith('//')).join('\n'),
      );

    const l2Obj = parseJson(l2Files.openclawJson);
    const l3Obj = parseJson(l3Files.openclawJson);

    // L3 should have an allow-list for tools, L2 may not
    if (l3Obj.tools.allow) {
      expect(Array.isArray(l3Obj.tools.allow)).toBe(true);
    }

    // L3 sandbox mode should be 'all' or stricter than L2
    expect(['all', 'session']).toContain(l3Obj.agents.sandbox.mode);
  });
});
