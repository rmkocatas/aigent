// ============================================================
// OpenClaw Deploy — Package Installer Tool Tests
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installPackageHandler, installPackageDefinition } from '../../../src/core/tools/builtins/package-installer.js';
import type { ToolContext } from '../../../src/core/tools/registry.js';

// Mock scanPackage
vi.mock('../../../src/core/security/package-scanner.js', () => ({
  scanPackage: vi.fn(),
}));

// Mock child_process
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { scanPackage } from '../../../src/core/security/package-scanner.js';
import { execSync } from 'node:child_process';

const mockedScanPackage = vi.mocked(scanPackage);
const mockedExecSync = vi.mocked(execSync);

function makeContext(overrides?: Record<string, unknown>): ToolContext {
  return {
    workspaceDir: '/workspace',
    memoryDir: '/memory',
    conversationId: 'conv-1',
    userId: 'user-1',
    maxExecutionMs: 30000,
    ...overrides,
  };
}

describe('installPackageDefinition', () => {
  it('has correct name', () => {
    expect(installPackageDefinition.name).toBe('install_package');
  });

  it('requires name and project_dir', () => {
    expect(installPackageDefinition.parameters.required).toContain('name');
    expect(installPackageDefinition.parameters.required).toContain('project_dir');
  });
});

describe('installPackageHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects missing project_dir', async () => {
    const result = await installPackageHandler(
      { name: 'lodash' },
      makeContext(),
    );
    expect(result).toContain('Error: Missing required parameter "project_dir"');
  });

  it('rejects missing name', async () => {
    const result = await installPackageHandler(
      { project_dir: '/projects/myapp' },
      makeContext(),
    );
    expect(result).toContain('Error: Missing required parameter "name"');
  });

  it('validates project_dir against allowed list', async () => {
    const context = makeContext() as ToolContext & Record<string, unknown>;
    (context as Record<string, unknown>)['allowedProjectDirs'] = ['/projects/allowed'];

    const result = await installPackageHandler(
      { name: 'lodash', project_dir: '/projects/forbidden' },
      context,
    );
    expect(result).toContain('not in the allowed project directories list');
  });

  it('allows project_dir that is in allowed list', async () => {
    const context = makeContext() as ToolContext & Record<string, unknown>;
    (context as Record<string, unknown>)['allowedProjectDirs'] = ['/projects/allowed'];

    mockedScanPackage.mockResolvedValue({
      packageName: 'lodash',
      score: 0,
      verdict: 'SAFE',
      findings: [],
    });

    mockedExecSync.mockReturnValue('added 1 package');

    const result = await installPackageHandler(
      { name: 'lodash', project_dir: '/projects/allowed' },
      context,
    );
    expect(result).toContain('Installation successful');
  });

  it('auto-denies RISKY packages', async () => {
    mockedScanPackage.mockResolvedValue({
      packageName: 'evil-pkg',
      score: 8,
      verdict: 'RISKY',
      findings: [
        { severity: 'critical', category: 'typosquatting', message: 'Suspicious name' },
        { severity: 'critical', category: 'lifecycle-script', message: 'postinstall found' },
      ],
    });

    const result = await installPackageHandler(
      { name: 'evil-pkg', project_dir: '/projects/myapp' },
      makeContext(),
    );

    expect(result).toContain('Installation DENIED');
    expect(result).toContain('RISKY');
    expect(mockedExecSync).not.toHaveBeenCalled();
  });

  it('returns scan report for clean package and installs', async () => {
    mockedScanPackage.mockResolvedValue({
      packageName: 'lodash',
      score: 0,
      verdict: 'SAFE',
      findings: [],
    });

    mockedExecSync.mockReturnValue('added 1 package, audited 50 packages');

    const result = await installPackageHandler(
      { name: 'lodash', project_dir: '/projects/myapp' },
      makeContext(),
    );

    expect(result).toContain('GitVerify Scan Report');
    expect(result).toContain('Verdict: SAFE');
    expect(result).toContain('Installation successful');
    expect(mockedExecSync).toHaveBeenCalledTimes(1);
  });

  it('uses -D flag for dev dependency', async () => {
    mockedScanPackage.mockResolvedValue({
      packageName: 'vitest',
      score: 0,
      verdict: 'SAFE',
      findings: [],
    });

    mockedExecSync.mockReturnValue('added 1 package');

    await installPackageHandler(
      { name: 'vitest', project_dir: '/projects/myapp', dev: 'true' },
      makeContext(),
    );

    expect(mockedExecSync).toHaveBeenCalledWith(
      'npm install -D vitest',
      expect.objectContaining({ cwd: '/projects/myapp' }),
    );
  });

  it('reports install failure', async () => {
    mockedScanPackage.mockResolvedValue({
      packageName: 'some-pkg',
      score: 1,
      verdict: 'SAFE',
      findings: [{ severity: 'warning', category: 'reputation', message: 'Low downloads' }],
    });

    mockedExecSync.mockImplementation(() => {
      throw new Error('npm ERR! 404 Not Found');
    });

    const result = await installPackageHandler(
      { name: 'some-pkg', project_dir: '/projects/myapp' },
      makeContext(),
    );

    expect(result).toContain('Installation FAILED');
    expect(result).toContain('npm ERR! 404 Not Found');
  });

  it('proceeds with CAUTION verdict (not denied)', async () => {
    mockedScanPackage.mockResolvedValue({
      packageName: 'suspicious-pkg',
      score: 4,
      verdict: 'CAUTION',
      findings: [
        { severity: 'warning', category: 'reputation', message: 'Low downloads' },
        { severity: 'critical', category: 'lifecycle-script', message: 'postinstall found' },
      ],
    });

    mockedExecSync.mockReturnValue('added 1 package');

    const result = await installPackageHandler(
      { name: 'suspicious-pkg', project_dir: '/projects/myapp' },
      makeContext(),
    );

    expect(result).toContain('Verdict: CAUTION');
    expect(result).toContain('Installation successful');
    expect(result).not.toContain('DENIED');
  });
});
