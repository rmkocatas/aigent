// ============================================================
// OpenClaw Deploy — Status Command
// ============================================================

import { Command } from 'commander';
import ora from 'ora';
import { checkDeploymentStatus } from '../../core/status/checker.js';
import { printError, printDeploymentStatus } from '../formatters/output.js';

const DEFAULT_INSTALL_DIR = '~/.openclaw';

function resolveHome(p: string): string {
  if (p.startsWith('~/')) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return p.replace('~', home);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Command factory
// ---------------------------------------------------------------------------

export function createStatusCommand(): Command {
  return new Command('status')
    .description('Check deployment health and status')
    .option('--install-dir <dir>', 'Installation directory', DEFAULT_INSTALL_DIR)
    .option('--json', 'Output results as JSON')
    .action(async (opts) => {
      try {
        await runStatus(opts);
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });
}

// ---------------------------------------------------------------------------
// Status flow
// ---------------------------------------------------------------------------

async function runStatus(opts: {
  installDir: string;
  json?: boolean;
}): Promise<void> {
  const installDir = resolveHome(opts.installDir);

  const spinner = opts.json ? null : ora('Checking deployment status...').start();
  const status = await checkDeploymentStatus(installDir);
  spinner?.stop();

  if (opts.json) {
    console.log(JSON.stringify(status, null, 2));
  } else {
    printDeploymentStatus(status);
  }

  if (!status.running) {
    process.exitCode = 1;
  }
}
