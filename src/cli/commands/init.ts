// ============================================================
// OpenClaw Deploy — Init Command
// ============================================================

import { Command } from 'commander';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { confirm } from '@inquirer/prompts';
import ora from 'ora';

import type {
  SecurityLevel,
  ChannelId,
  ChannelSelection,
  DeploymentConfig,
  DeploymentResult,
  GatewayBind,
} from '../../types/index.js';
import { detectEnvironment } from '../../core/detect/environment.js';
import { getDefaults } from '../../core/config/defaults.js';
import { generateOpenClawConfig } from '../../core/config/generator.js';
import { generateSecrets } from '../../core/security/token-generator.js';
import { setSecurePermissions } from '../../core/security/permissions.js';
import { runSecurityAudit, autoFixAuditResults } from '../../core/security/audit-runner.js';
import { ContainerManager } from '../../core/docker/container-manager.js';
import { waitForHealthy } from '../../core/docker/health-check.js';
import { promptApiKey } from '../prompts/api-key.js';
import { promptPlatforms } from '../prompts/platform-select.js';
import {
  printBanner,
  printDetectedEnv,
  printDeploymentSummary,
  printAuditReport,
  printSuccess,
  printError,
  printWarning,
} from '../formatters/output.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseChannelIds(list: string): ChannelId[] {
  const valid: ChannelId[] = ['webchat', 'telegram', 'whatsapp', 'discord', 'slack', 'signal'];
  const ids = list.split(',').map((s) => s.trim().toLowerCase()) as ChannelId[];
  return ids.filter((id) => valid.includes(id));
}

function toChannelSelections(ids: ChannelId[]): ChannelSelection[] {
  const unique = [...new Set(['webchat' as ChannelId, ...ids])];
  return unique.map((id) => ({ id, enabled: true }));
}

function resolveBindAddress(bind: GatewayBind): string {
  switch (bind) {
    case 'loopback': return '127.0.0.1';
    case 'lan': return '0.0.0.0';
    case 'tailnet': return '100.64.0.0';
    case 'custom': return '0.0.0.0';
    default: return '127.0.0.1';
  }
}

// ---------------------------------------------------------------------------
// Command factory
// ---------------------------------------------------------------------------

export function createInitCommand(): Command {
  const cmd = new Command('init')
    .description('Initialize and deploy OpenClaw')
    .option('--api-key <key>', 'LLM API key (skip interactive prompt)')
    .option('--platforms <list>', 'Comma-separated channel list (e.g. telegram,discord)')
    .option('--security <level>', 'Security level: L1, L2, or L3', 'L2')
    .option('--port <number>', 'Gateway port', '18789')
    .option('--bind <address>', 'Gateway bind address: loopback, lan, tailnet, custom')
    .option('--no-docker', 'Use native mode instead of Docker')
    .option('--quiet', 'Minimal output')
    .option('--dry-run', 'Show generated files without writing')
    .action(async (opts) => {
      try {
        await runInit(opts);
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });

  return cmd;
}

// ---------------------------------------------------------------------------
// Main init flow
// ---------------------------------------------------------------------------

interface InitOptions {
  apiKey?: string;
  platforms?: string;
  security: string;
  port: string;
  bind?: string;
  docker: boolean;
  quiet: boolean;
  dryRun: boolean;
}

async function runInit(opts: InitOptions): Promise<void> {
  const quiet = opts.quiet;

  // 1. Banner
  if (!quiet) {
    printBanner();
  }

  // 2. Environment detection
  const spinner = quiet ? null : ora('Detecting environment...').start();
  const env = await detectEnvironment();
  spinner?.succeed('Environment detected');

  if (!quiet) {
    printDetectedEnv(env);
  }

  // 3. API key
  let apiKey: string;
  let provider: DeploymentConfig['llm']['provider'];

  if (opts.apiKey) {
    apiKey = opts.apiKey;
    // Simple detection for CLI-provided keys
    const { validateApiKey } = await import('../../core/config/validator.js');
    const result = validateApiKey(apiKey);
    provider = result.provider ?? 'openrouter';
  } else {
    const result = await promptApiKey();
    apiKey = result.apiKey;
    provider = result.provider;
  }

  // 4. Platforms
  let channelIds: ChannelId[];

  if (opts.platforms) {
    channelIds = parseChannelIds(opts.platforms);
  } else {
    const addNow = await confirm({
      message: 'Add messaging platforms now or later?',
      default: false,
    });

    if (addNow) {
      channelIds = await promptPlatforms();
    } else {
      channelIds = ['webchat'];
    }
  }

  // 5. Build config from defaults + user inputs
  const securityLevel = (opts.security as SecurityLevel) || 'L2';
  const defaults = getDefaults(securityLevel);

  const config: DeploymentConfig = {
    ...defaults,
    llm: {
      provider,
      apiKey,
      model: defaults.llm.model,
    },
    channels: toChannelSelections(channelIds),
    securityLevel,
    gateway: {
      bind: (opts.bind as GatewayBind) ?? defaults.gateway.bind,
      port: parseInt(opts.port, 10) || defaults.gateway.port,
    },
    deployment: {
      ...defaults.deployment,
      mode: opts.docker ? 'docker' : 'native',
    },
  };

  if (!quiet) {
    printDeploymentSummary(config);
  }

  // 6. Generate secrets
  const secrets = generateSecrets();

  // 7. Generate config files
  const generatingSpinner = quiet ? null : ora('Generating configuration...').start();
  const files = await generateOpenClawConfig(config, secrets);
  generatingSpinner?.succeed('Configuration generated');

  // 8. Dry run — print and exit
  if (opts.dryRun) {
    console.log('\n--- openclaw.json ---');
    console.log(files.openclawJson);
    console.log('--- .env ---');
    console.log(files.envFile);
    if (files.dockerComposeYml) {
      console.log('--- docker-compose.yml ---');
      console.log(files.dockerComposeYml);
    }
    if (files.caddyfile) {
      console.log('--- Caddyfile ---');
      console.log(files.caddyfile);
    }
    return;
  }

  // 9. Write files
  const installDir = config.deployment.installDir;
  const writingSpinner = quiet ? null : ora('Writing files...').start();

  await mkdir(installDir, { recursive: true });
  await writeFile(join(installDir, 'openclaw.json'), files.openclawJson, 'utf-8');
  await writeFile(join(installDir, '.env'), files.envFile, 'utf-8');

  if (files.dockerComposeYml) {
    await writeFile(join(installDir, 'docker-compose.yml'), files.dockerComposeYml, 'utf-8');
  }

  if (files.caddyfile) {
    await writeFile(join(installDir, 'Caddyfile'), files.caddyfile, 'utf-8');
  }

  writingSpinner?.succeed('Files written');

  // 10. Set file permissions
  await setSecurePermissions(installDir, securityLevel);

  // 11. Docker start
  if (config.deployment.mode === 'docker') {
    const dockerSpinner = quiet ? null : ora('Starting containers...').start();
    const cm = new ContainerManager(installDir);
    const startResult = await cm.start();

    if (!startResult.success) {
      dockerSpinner?.fail('Failed to start containers');
      printWarning(startResult.error ?? 'Unknown Docker error');
    } else {
      dockerSpinner?.succeed('Containers started');
    }
  }

  // 12. Health check
  const bindAddr = resolveBindAddress(config.gateway.bind);
  const gatewayUrl = `http://${bindAddr}:${config.gateway.port}`;

  if (config.deployment.mode === 'docker') {
    const healthSpinner = quiet ? null : ora('Waiting for gateway...').start();
    const healthy = await waitForHealthy(gatewayUrl);

    if (healthy) {
      healthSpinner?.succeed('Gateway is healthy');
    } else {
      healthSpinner?.warn('Gateway did not become healthy in time');
    }
  }

  // 13. Security audit
  const auditSpinner = quiet ? null : ora('Running security audit...').start();
  let report = await runSecurityAudit(config, secrets, installDir);

  const fixable = report.results.filter((r) => r.autoFixable && r.severity !== 'pass');
  if (fixable.length > 0) {
    const fixedResults = await autoFixAuditResults(report.results, config, installDir);
    const autoFixedCount = fixedResults.filter((r) => r.fixed).length;
    report = { ...report, results: fixedResults, autoFixedCount };
  }

  auditSpinner?.succeed('Security audit complete');

  // 14. Print audit report
  if (!quiet) {
    printAuditReport(report);
  }

  // 15. Print success
  const deploymentResult: DeploymentResult = {
    success: true,
    gatewayUrl,
    gatewayToken: secrets.gatewayToken,
    errors: [],
    warnings: report.results
      .filter((r) => r.severity === 'warning' && !r.fixed)
      .map((r) => r.message),
    auditResults: report.results,
  };

  printSuccess(deploymentResult);
}
