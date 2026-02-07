// ============================================================
// OpenClaw Deploy — Teardown Command
// ============================================================

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { confirm } from '@inquirer/prompts';
import { performTeardown } from '../../core/teardown/teardown.js';
import { printError, printTeardownResult } from '../formatters/output.js';

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

export function createTeardownCommand(): Command {
  return new Command('teardown')
    .description('Remove OpenClaw deployment')
    .option('--install-dir <dir>', 'Installation directory', DEFAULT_INSTALL_DIR)
    .option('--remove-data', 'Also remove workspace and training data')
    .option('--remove-volumes', 'Also remove Docker volumes')
    .option('--yes', 'Skip confirmation prompts')
    .action(async (opts) => {
      try {
        await runTeardown(opts);
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });
}

// ---------------------------------------------------------------------------
// Teardown flow
// ---------------------------------------------------------------------------

async function runTeardown(opts: {
  installDir: string;
  removeData?: boolean;
  removeVolumes?: boolean;
  yes?: boolean;
}): Promise<void> {
  const installDir = resolveHome(opts.installDir);

  console.log('');
  console.log(chalk.bold.red('  Teardown will:'));
  console.log('  - Stop and remove Docker containers');
  console.log('  - Remove configuration files (.env, openclaw.json, docker-compose.yml)');
  if (opts.removeData) {
    console.log(chalk.yellow('  - Remove workspace and training data'));
  }
  if (opts.removeVolumes) {
    console.log(chalk.yellow('  - Remove Docker volumes'));
  }
  console.log('');

  if (!opts.yes) {
    const proceed = await confirm({
      message: 'This action is irreversible. Continue?',
      default: false,
    });
    if (!proceed) {
      console.log(chalk.dim('  Aborted.'));
      return;
    }

    // Double-confirm for data removal
    if (opts.removeData) {
      const confirmData = await confirm({
        message: 'Are you sure you want to delete all data? This cannot be undone.',
        default: false,
      });
      if (!confirmData) {
        console.log(chalk.dim('  Aborted.'));
        return;
      }
    }
  }

  const spinner = ora('Tearing down deployment...').start();

  const result = await performTeardown(
    installDir,
    {
      removeData: opts.removeData ?? false,
      removeVolumes: opts.removeVolumes ?? false,
    },
    (msg) => {
      spinner.text = msg;
    },
  );

  if (result.errors.length === 0) {
    spinner.succeed('Teardown complete.');
  } else {
    spinner.warn('Teardown completed with errors.');
  }

  printTeardownResult(result);
}
