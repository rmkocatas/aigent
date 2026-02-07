// ============================================================
// OpenClaw Deploy — Update Command
// ============================================================

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { confirm } from '@inquirer/prompts';
import { checkForUpdates, performUpdate } from '../../core/update/updater.js';
import {
  printError,
  printVersionCheck,
  printUpdateResult,
} from '../formatters/output.js';

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

export function createUpdateCommand(): Command {
  return new Command('update')
    .description('Update OpenClaw deployment to the latest version')
    .option('--check', 'Only check for updates without applying')
    .option('--install-dir <dir>', 'Installation directory', DEFAULT_INSTALL_DIR)
    .option('--yes', 'Skip confirmation prompt')
    .action(async (opts) => {
      try {
        await runUpdate(opts);
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });
}

// ---------------------------------------------------------------------------
// Update flow
// ---------------------------------------------------------------------------

async function runUpdate(opts: {
  check?: boolean;
  installDir: string;
  yes?: boolean;
}): Promise<void> {
  const installDir = resolveHome(opts.installDir);

  // 1. Check for updates
  const spinner = ora('Checking for updates...').start();
  const versionInfo = await checkForUpdates(installDir);
  spinner.stop();

  printVersionCheck(versionInfo);

  if (!versionInfo.updateAvailable) {
    console.log(chalk.green('  Already up to date.'));
    console.log('');
    return;
  }

  // 2. If --check, stop here
  if (opts.check) {
    return;
  }

  // 3. Confirm
  if (!opts.yes) {
    const proceed = await confirm({
      message: `Update from ${versionInfo.currentVersion} to ${versionInfo.latestVersion}?`,
      default: true,
    });
    if (!proceed) {
      console.log(chalk.dim('  Aborted.'));
      return;
    }
  }

  // 4. Perform update
  const updateSpinner = ora('Starting update...').start();

  const port = 3000; // Default port; ideally read from config
  const gatewayUrl = `http://127.0.0.1:${port}`;

  const result = await performUpdate(installDir, gatewayUrl, (msg) => {
    updateSpinner.text = msg;
  });

  if (result.success) {
    updateSpinner.succeed('Update complete.');
  } else {
    updateSpinner.fail('Update failed.');
  }

  printUpdateResult(result);
}
