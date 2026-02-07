import { describe, it, expect, vi } from 'vitest';
import { runSecurityAudit, autoFixAuditResults } from '../../../src/core/security/audit-runner.js';
import type { DeploymentConfig, GeneratedSecrets } from '../../../src/types/index.js';

// Mock permissions module
vi.mock('../../../src/core/security/permissions.js', () => ({
  verifyPermissions: vi.fn().mockResolvedValue({ valid: true, issues: [] }),
  setSecurePermissions: vi.fn().mockResolvedValue(undefined),
}));

function makeConfig(overrides: Partial<DeploymentConfig> = {}): DeploymentConfig {
  return {
    llm: { provider: 'ollama', apiKey: '' },
    channels: [{ id: 'webchat', enabled: true }],
    securityLevel: 'L2',
    gateway: { bind: 'loopback', port: 3000 },
    deployment: { mode: 'docker', workspace: '/tmp/ws', installDir: '/tmp/install' },
    ...overrides,
  } as DeploymentConfig;
}

function makeSecrets(overrides: Partial<GeneratedSecrets> = {}): GeneratedSecrets {
  return {
    gatewayToken: 'a'.repeat(64), // 32 bytes as hex
    masterEncryptionKey: 'b'.repeat(64),
    ...overrides,
  };
}

describe('runSecurityAudit', () => {
  it('returns pass for fully secure config', async () => {
    const config = makeConfig();
    const secrets = makeSecrets();
    const report = await runSecurityAudit(config, secrets, '/tmp/install');

    expect(report.overallStatus).toBe('pass');
    expect(report.results.every((r) => r.severity === 'pass')).toBe(true);
    expect(report.timestamp).toBeTruthy();
    expect(report.autoFixedCount).toBe(0);
  });

  it('flags critical when gateway token is empty', async () => {
    const config = makeConfig();
    const secrets = makeSecrets({ gatewayToken: '' });
    const report = await runSecurityAudit(config, secrets, '/tmp/install');

    expect(report.overallStatus).toBe('critical');
    const authResult = report.results.find((r) => r.check === 'gateway-auth');
    expect(authResult?.severity).toBe('critical');
  });

  it('flags critical when token entropy is low', async () => {
    const config = makeConfig();
    const secrets = makeSecrets({ gatewayToken: 'abcd' }); // 2 bytes
    const report = await runSecurityAudit(config, secrets, '/tmp/install');

    expect(report.overallStatus).toBe('critical');
    const entropyResult = report.results.find((r) => r.check === 'token-entropy');
    expect(entropyResult?.severity).toBe('critical');
  });

  it('flags critical when bind is custom', async () => {
    const config = makeConfig({
      gateway: { bind: 'custom' as 'loopback', port: 3000 },
    });
    const secrets = makeSecrets();
    const report = await runSecurityAudit(config, secrets, '/tmp/install');

    const bindResult = report.results.find((r) => r.check === 'bind-address');
    expect(bindResult?.severity).toBe('critical');
  });

  it('returns warning when overall has only warnings', async () => {
    // L1 has sandbox off and DM policy open, which are warnings
    const config = makeConfig({ securityLevel: 'L1' });
    const secrets = makeSecrets();
    const report = await runSecurityAudit(config, secrets, '/tmp/install');

    expect(report.overallStatus).toBe('warning');
  });

  it('returns 8 audit results', async () => {
    const config = makeConfig();
    const secrets = makeSecrets();
    const report = await runSecurityAudit(config, secrets, '/tmp/install');

    expect(report.results).toHaveLength(8);
  });
});

describe('autoFixAuditResults', () => {
  it('marks fixable results as fixed', async () => {
    const config = makeConfig({ securityLevel: 'L1' });
    const secrets = makeSecrets();
    const report = await runSecurityAudit(config, secrets, '/tmp/install');

    const nonPassResults = report.results.filter((r) => r.severity !== 'pass');
    expect(nonPassResults.length).toBeGreaterThan(0);

    const fixed = await autoFixAuditResults(report.results, config, '/tmp/install');
    const fixedResults = fixed.filter((r) => r.fixed === true);
    expect(fixedResults.length).toBeGreaterThan(0);
  });

  it('preserves pass results unchanged', async () => {
    const config = makeConfig();
    const secrets = makeSecrets();
    const report = await runSecurityAudit(config, secrets, '/tmp/install');

    const fixed = await autoFixAuditResults(report.results, config, '/tmp/install');
    const passResults = fixed.filter((r) => r.severity === 'pass');
    expect(passResults.every((r) => r.fixed === undefined)).toBe(true);
  });

  it('returns same number of results', async () => {
    const config = makeConfig({ securityLevel: 'L1' });
    const secrets = makeSecrets();
    const report = await runSecurityAudit(config, secrets, '/tmp/install');

    const fixed = await autoFixAuditResults(report.results, config, '/tmp/install');
    expect(fixed).toHaveLength(report.results.length);
  });
});
