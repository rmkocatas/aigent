// ============================================================
// OpenClaw Deploy — Audit Command
// ============================================================

import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ora from 'ora';
import type {
  DeploymentConfig,
  SecurityLevel,
} from '../../types/index.js';
import { runSecurityAudit, autoFixAuditResults } from '../../core/security/audit-runner.js';
import { loadSecrets } from '../../core/credentials/manager.js';
import { printAuditReport, printError } from '../formatters/output.js';

const DEFAULT_INSTALL_DIR = '~/.openclaw';

function resolveHome(p: string): string {
  if (p.startsWith('~/')) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return p.replace('~', home);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Config loader helper
// ---------------------------------------------------------------------------

async function loadDeploymentConfig(
  installDir: string,
  securityOverride?: string,
): Promise<DeploymentConfig> {
  const configPath = join(installDir, 'openclaw.json');
  const raw = await readFile(configPath, 'utf-8');

  // Strip single-line comments (// ...) that the config generator adds
  const stripped = raw.replace(/^\s*\/\/.*$/gm, '');
  const parsed = JSON.parse(stripped) as Record<string, unknown>;

  // Determine security level
  const securityLevel = (securityOverride ?? parsed.securityLevel ?? 'L2') as SecurityLevel;

  // Reconstruct a minimal DeploymentConfig from the on-disk file
  const gateway = parsed.gateway as Record<string, unknown> | undefined;
  const deployment = parsed.deployment as Record<string, unknown> | undefined;
  const channels = parsed.channels as Array<{ id: string; enabled: boolean }> | undefined;

  return {
    llm: {
      provider: (parsed.provider as string) ?? 'ollama',
      apiKey: '',
      model: parsed.model as string | undefined,
    },
    channels: channels ?? [{ id: 'webchat', enabled: true }],
    securityLevel,
    gateway: {
      bind: (gateway?.bind as string) ?? 'loopback',
      port: (gateway?.port as number) ?? 3000,
    },
    deployment: {
      mode: (deployment?.mode as string) ?? 'docker',
      workspace: (deployment?.workspace as string) ?? join(installDir, 'workspace'),
      installDir,
    },
  } as DeploymentConfig;
}

// ---------------------------------------------------------------------------
// Command factory
// ---------------------------------------------------------------------------

export function createAuditCommand(): Command {
  return new Command('audit')
    .description('Run security audit on a deployment')
    .option('--install-dir <dir>', 'Installation directory', DEFAULT_INSTALL_DIR)
    .option('--fix', 'Auto-fix remediable issues')
    .option('--json', 'Output results as JSON')
    .option('--security <level>', 'Override security level (L1, L2, L3)')
    .action(async (opts) => {
      try {
        await runAudit(opts);
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });
}

// ---------------------------------------------------------------------------
// Audit flow
// ---------------------------------------------------------------------------

async function runAudit(opts: {
  installDir: string;
  fix?: boolean;
  json?: boolean;
  security?: string;
}): Promise<void> {
  const installDir = resolveHome(opts.installDir);

  // 1. Load config and secrets
  const config = await loadDeploymentConfig(installDir, opts.security);
  const secrets = await loadSecrets(installDir);

  // 2. Run audit
  const spinner = opts.json ? null : ora('Running security audit...').start();
  let report = await runSecurityAudit(config, secrets, installDir);

  // 3. Auto-fix if requested
  if (opts.fix) {
    const fixedResults = await autoFixAuditResults(report.results, config, installDir);
    const fixedCount = fixedResults.filter((r) => r.fixed).length;
    report = {
      ...report,
      results: fixedResults,
      autoFixedCount: fixedCount,
    };
  }

  spinner?.succeed('Audit complete.');

  // 4. Output
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('');
    printAuditReport(report);
  }

  // 5. Non-zero exit for CI when critical
  if (report.overallStatus === 'critical') {
    process.exitCode = 1;
  }
}
