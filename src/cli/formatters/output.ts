// ============================================================
// OpenClaw Deploy — Console Output Formatting
// ============================================================

import chalk from 'chalk';
import type {
  DetectedEnvironment,
  DeploymentConfig,
  AuditReport,
  DeploymentResult,
  CredentialListResult,
  CredentialVerifyResult,
  VersionCheckResult,
  UpdateResult,
  ChannelSelection,
  DeploymentStatus,
  TeardownResult,
} from '../../types/index.js';
import { maskCredentialValue } from '../../core/credentials/manager.js';

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

export function printBanner(): void {
  console.log('');
  console.log(chalk.bold.cyan('  OpenClaw Deploy v0.1.0'));
  console.log(chalk.dim('  One-command deployment for hardened AI agents'));
  console.log('');
}

// ---------------------------------------------------------------------------
// Detected environment
// ---------------------------------------------------------------------------

export function printDetectedEnv(env: DetectedEnvironment): void {
  console.log(chalk.bold('  Detected Environment'));
  console.log(chalk.dim('  --------------------'));

  const row = (label: string, value: string) => {
    console.log(`  ${chalk.dim(label.padEnd(22))} ${value}`);
  };

  row('OS', env.os + (env.isWSL ? ' (WSL)' : ''));
  row('Shell', env.shell);
  row('Node.js', env.nodeVersion);
  row('Docker', env.dockerAvailable
    ? chalk.green('available') + (env.dockerVersion ? ` (${env.dockerVersion})` : '')
    : chalk.red('not found'));
  row('Docker Compose', env.dockerComposeAvailable ? chalk.green('available') : chalk.red('not found'));
  row('Free port', String(env.freePort));
  row('Memory', `${env.availableMemoryMB} MB`);
  row('CPUs', String(env.cpuCount));
  row('systemd', env.hasSystemd ? chalk.green('yes') : chalk.dim('no'));
  row('Tailscale', env.isTailscaleAvailable ? chalk.green('yes') : chalk.dim('no'));

  if (env.ollamaAvailable) {
    const modelCount = env.ollamaModels?.length ?? 0;
    row('Ollama', chalk.green('available') + ` (${modelCount} model${modelCount !== 1 ? 's' : ''})`);
    if (env.ollamaModels && env.ollamaModels.length > 0) {
      row('', env.ollamaModels.join(', '));
    }
  } else {
    row('Ollama', chalk.dim('not found'));
  }

  if (env.existingInstall) {
    row('Existing install', chalk.yellow(env.existingInstall));
  }

  console.log('');
}

// ---------------------------------------------------------------------------
// Deployment summary
// ---------------------------------------------------------------------------

export function printDeploymentSummary(config: DeploymentConfig): void {
  console.log(chalk.bold('  Deployment Summary'));
  console.log(chalk.dim('  ------------------'));

  const row = (label: string, value: string) => {
    console.log(`  ${chalk.dim(label.padEnd(22))} ${value}`);
  };

  if (config.llm.routing?.mode === 'hybrid') {
    const fallback = config.llm.routing.fallback ?? 'cloud';
    row('LLM', `Hybrid (Ollama + ${fallback.charAt(0).toUpperCase() + fallback.slice(1)})`);
  } else if (config.llm.provider === 'ollama' && config.llm.ollama) {
    row('LLM', `Ollama (${config.llm.ollama.model}, local)`);
  } else {
    row('LLM Provider', config.llm.provider);
  }
  if (config.llm.model) {
    row('Model', config.llm.model);
  }
  row('Security Level', config.securityLevel);
  row('Mode', config.deployment.mode);
  row('Gateway', `${config.gateway.bind}:${config.gateway.port}`);
  row('Install Dir', config.deployment.installDir);

  const enabledChannels = config.channels
    .filter((ch) => ch.enabled)
    .map((ch) => ch.id)
    .join(', ');
  row('Channels', enabledChannels || 'none');

  if (config.training?.enabled) {
    row('Auto-learning', chalk.green('enabled') + ` (trains after ${config.training.minEntriesForTraining} examples)`);
  }

  console.log('');
}

// ---------------------------------------------------------------------------
// Audit report
// ---------------------------------------------------------------------------

export function printAuditReport(report: AuditReport): void {
  console.log(chalk.bold('  Security Audit'));
  console.log(chalk.dim('  --------------'));

  for (const r of report.results) {
    let icon: string;
    let line: string;

    switch (r.severity) {
      case 'pass':
        icon = chalk.green('\u2714');
        line = chalk.green(r.message);
        break;
      case 'info':
        icon = chalk.cyan('i');
        line = chalk.cyan(r.message);
        break;
      case 'warning':
        icon = chalk.yellow('\u26A0');
        line = chalk.yellow(r.message);
        break;
      case 'critical':
        icon = chalk.red('\u2718');
        line = chalk.red(r.message);
        break;
    }

    const fixedTag = r.fixed ? chalk.dim(' [auto-fixed]') : '';
    console.log(`  ${icon} ${r.check.padEnd(20)} ${line}${fixedTag}`);
  }

  console.log('');

  if (report.autoFixedCount > 0) {
    console.log(chalk.dim(`  ${report.autoFixedCount} issue(s) auto-fixed.`));
  }

  const statusColor =
    report.overallStatus === 'pass' ? chalk.green :
    report.overallStatus === 'warning' ? chalk.yellow :
    chalk.red;
  console.log(`  Overall: ${statusColor(report.overallStatus.toUpperCase())}`);
  console.log('');
}

// ---------------------------------------------------------------------------
// Success
// ---------------------------------------------------------------------------

export function printSuccess(result: DeploymentResult): void {
  console.log(chalk.bold.green('  Deployment successful!'));
  console.log('');
  console.log(`  ${chalk.dim('Gateway URL')}   ${chalk.cyan(result.gatewayUrl)}`);
  console.log(`  ${chalk.dim('Gateway Token')} ${result.gatewayToken}`);
  console.log('');

  if (result.warnings.length > 0) {
    for (const w of result.warnings) {
      console.log(`  ${chalk.yellow('\u26A0')} ${w}`);
    }
    console.log('');
  }
}

// ---------------------------------------------------------------------------
// Error / Warning helpers
// ---------------------------------------------------------------------------

export function printError(message: string): void {
  console.error(chalk.red(`  Error: ${message}`));
}

export function printWarning(message: string): void {
  console.warn(chalk.yellow(`  Warning: ${message}`));
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export function printCredentialsList(result: CredentialListResult): void {
  console.log('');
  console.log(chalk.bold('  Configured Credentials'));
  console.log(chalk.dim('  ----------------------'));

  const row = (label: string, value: string) => {
    console.log(`  ${chalk.dim(label.padEnd(36))} ${value}`);
  };

  for (const entry of result.credentials) {
    row(entry.key, maskCredentialValue(entry.value));
  }

  console.log('');
  console.log(chalk.dim(`  Source: ${result.envFilePath}`));
  console.log('');
}

export function printCredentialsVerifyResults(results: CredentialVerifyResult[]): void {
  console.log('');
  console.log(chalk.bold('  Credential Verification'));
  console.log(chalk.dim('  ----------------------'));

  for (const r of results) {
    const icon = r.valid ? chalk.green('\u2714') : chalk.red('\u2718');
    const status = r.valid ? chalk.green('valid') : chalk.red('invalid');
    const provider = r.provider ? chalk.dim(` (${r.provider})`) : '';
    const error = r.error ? chalk.dim(` — ${r.error}`) : '';

    console.log(`  ${icon} ${r.key.padEnd(30)} ${status}${provider}${error}`);
  }

  console.log('');
}

// ---------------------------------------------------------------------------
// Version / Update
// ---------------------------------------------------------------------------

export function printVersionCheck(result: VersionCheckResult): void {
  console.log('');
  console.log(chalk.bold('  Version Info'));
  console.log(chalk.dim('  ------------'));

  const row = (label: string, value: string) => {
    console.log(`  ${chalk.dim(label.padEnd(22))} ${value}`);
  };

  row('Current', result.currentVersion);
  row('Latest', result.latestVersion);

  if (result.updateAvailable) {
    row('Status', chalk.yellow('Update available'));
  } else {
    row('Status', chalk.green('Up to date'));
  }

  if (result.publishedAt) {
    row('Published', result.publishedAt);
  }

  console.log('');
}

export function printUpdateResult(result: UpdateResult): void {
  console.log('');

  if (result.success) {
    console.log(chalk.bold.green('  Update successful!'));
    console.log(`  ${chalk.dim('Previous version:')} ${result.previousVersion}`);
    console.log(`  ${chalk.dim('New version:')}      ${result.newVersion}`);
    console.log(`  ${chalk.dim('Health check:')}     ${chalk.green('passed')}`);
  } else {
    console.log(chalk.bold.red('  Update failed.'));
    if (result.error) {
      console.log(`  ${chalk.red(result.error)}`);
    }
    if (!result.healthCheckPassed) {
      console.log(`  ${chalk.dim('Health check:')}     ${chalk.red('failed')}`);
    }
  }

  console.log('');
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export function printChannelsList(channels: ChannelSelection[]): void {
  console.log('');
  console.log(chalk.bold('  Configured Channels'));
  console.log(chalk.dim('  -------------------'));

  for (const ch of channels) {
    const icon = ch.enabled ? chalk.green('\u2714') : chalk.dim('\u2013');
    const status = ch.enabled ? chalk.green('enabled') : chalk.dim('disabled');
    const tokenInfo = ch.token ? chalk.dim(' (token set)') : '';

    console.log(`  ${icon} ${ch.id.padEnd(14)} ${status}${tokenInfo}`);
  }

  console.log('');
}

// ---------------------------------------------------------------------------
// Deployment Status
// ---------------------------------------------------------------------------

export function printDeploymentStatus(status: DeploymentStatus): void {
  console.log('');
  console.log(chalk.bold('  Deployment Status'));
  console.log(chalk.dim('  -----------------'));

  const row = (label: string, value: string) => {
    console.log(`  ${chalk.dim(label.padEnd(22))} ${value}`);
  };

  row('Containers', status.running
    ? chalk.green('running') + chalk.dim(` (${status.containers.join(', ')})`)
    : chalk.red('stopped'));
  row('Gateway', status.gatewayHealthy
    ? chalk.green('healthy')
    : chalk.red('unhealthy'));
  row('Gateway URL', chalk.cyan(status.gatewayUrl));
  row('Security Level', status.securityLevel);

  if (status.uptime) {
    row('Uptime', status.uptime);
  }

  if (status.channels.length > 0) {
    console.log('');
    console.log(chalk.dim('  Channels:'));
    for (const ch of status.channels) {
      if (!ch.enabled) continue;
      const icon = ch.connected ? chalk.green('\u2714') : chalk.red('\u2718');
      const state = ch.connected ? chalk.green('connected') : chalk.red('disconnected');
      const error = ch.error ? chalk.dim(` — ${ch.error}`) : '';
      console.log(`    ${icon} ${ch.id.padEnd(14)} ${state}${error}`);
    }
  }

  if (status.error) {
    console.log('');
    console.log(`  ${chalk.red(status.error)}`);
  }

  console.log('');
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

export function printTeardownResult(result: TeardownResult): void {
  console.log('');

  const row = (label: string, value: string) => {
    console.log(`  ${chalk.dim(label.padEnd(22))} ${value}`);
  };

  row('Containers', result.containersStopped
    ? chalk.green('stopped')
    : chalk.red('failed to stop'));

  if (result.filesRemoved.length > 0) {
    row('Files removed', result.filesRemoved.join(', '));
  }

  if (result.volumesRemoved) {
    row('Volumes', chalk.green('removed'));
  }

  if (result.errors.length > 0) {
    console.log('');
    for (const err of result.errors) {
      console.log(`  ${chalk.red('\u2718')} ${err}`);
    }
  }

  console.log('');
}
