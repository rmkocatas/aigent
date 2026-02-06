// ============================================================
// OpenClaw Deploy — Console Output Formatting
// ============================================================

import chalk from 'chalk';
import type {
  DetectedEnvironment,
  DeploymentConfig,
  AuditReport,
  DeploymentResult,
} from '../../types/index.js';

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

  row('LLM Provider', config.llm.provider);
  row('Security Level', config.securityLevel);
  row('Mode', config.deployment.mode);
  row('Gateway', `${config.gateway.bind}:${config.gateway.port}`);
  row('Install Dir', config.deployment.installDir);

  const enabledChannels = config.channels
    .filter((ch) => ch.enabled)
    .map((ch) => ch.id)
    .join(', ');
  row('Channels', enabledChannels || 'none');

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
