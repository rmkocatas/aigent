// ============================================================
// OpenClaw Deploy — Credentials Command
// ============================================================

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { password, confirm } from '@inquirer/prompts';
import {
  listCredentials,
  setCredential,
  rotateSecrets,
  verifyCredentials,
  maskCredentialValue,
} from '../../core/credentials/manager.js';
import {
  printError,
  printCredentialsList,
  printCredentialsVerifyResults,
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

export function createCredentialsCommand(): Command {
  const cmd = new Command('credentials')
    .description('Manage secrets and API keys');

  cmd.addCommand(createListCommand());
  cmd.addCommand(createSetCommand());
  cmd.addCommand(createRotateCommand());
  cmd.addCommand(createVerifyCommand());

  return cmd;
}

// ---------------------------------------------------------------------------
// credentials list
// ---------------------------------------------------------------------------

function createListCommand(): Command {
  return new Command('list')
    .description('Show all configured credentials (masked)')
    .option('--install-dir <dir>', 'Installation directory', DEFAULT_INSTALL_DIR)
    .action(async (opts) => {
      try {
        const installDir = resolveHome(opts.installDir);
        const result = await listCredentials(installDir);
        printCredentialsList(result);
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });
}

// ---------------------------------------------------------------------------
// credentials set
// ---------------------------------------------------------------------------

function createSetCommand(): Command {
  return new Command('set')
    .description('Set or update a credential')
    .argument('<key>', 'Credential key (e.g. ANTHROPIC_API_KEY)')
    .option('--install-dir <dir>', 'Installation directory', DEFAULT_INSTALL_DIR)
    .action(async (key: string, opts) => {
      try {
        const installDir = resolveHome(opts.installDir);

        const value = await password({
          message: `Enter value for ${key}:`,
          mask: '*',
        });

        if (!value || value.trim().length === 0) {
          printError('Value cannot be empty.');
          process.exitCode = 1;
          return;
        }

        const spinner = ora('Saving credential...').start();
        await setCredential(installDir, key, value.trim());
        spinner.succeed(`${key} updated successfully.`);
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });
}

// ---------------------------------------------------------------------------
// credentials rotate
// ---------------------------------------------------------------------------

function createRotateCommand(): Command {
  return new Command('rotate')
    .description('Regenerate gateway token and encryption key')
    .option('--install-dir <dir>', 'Installation directory', DEFAULT_INSTALL_DIR)
    .option('--yes', 'Skip confirmation prompt')
    .action(async (opts) => {
      try {
        const installDir = resolveHome(opts.installDir);

        if (!opts.yes) {
          const proceed = await confirm({
            message: 'Rotating secrets will invalidate existing tokens. Continue?',
            default: false,
          });
          if (!proceed) {
            console.log(chalk.dim('  Aborted.'));
            return;
          }
        }

        const spinner = ora('Rotating secrets...').start();
        const result = await rotateSecrets(installDir);
        spinner.succeed('Secrets rotated successfully.');

        console.log('');
        console.log(`  ${chalk.dim('Rotated keys:')} ${result.rotatedKeys.join(', ')}`);
        console.log(`  ${chalk.dim('New token:')}    ${maskCredentialValue(result.newSecrets.gatewayToken)}`);
        console.log('');
        console.log(chalk.yellow('  Remember to restart the gateway for changes to take effect.'));
        console.log('');
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });
}

// ---------------------------------------------------------------------------
// credentials verify
// ---------------------------------------------------------------------------

function createVerifyCommand(): Command {
  return new Command('verify')
    .description('Validate that configured API keys are working')
    .option('--install-dir <dir>', 'Installation directory', DEFAULT_INSTALL_DIR)
    .action(async (opts) => {
      try {
        const installDir = resolveHome(opts.installDir);

        const spinner = ora('Verifying credentials...').start();
        const results = await verifyCredentials(installDir);
        spinner.stop();

        if (results.length === 0) {
          console.log(chalk.dim('  No API key credentials found in .env file.'));
          return;
        }

        printCredentialsVerifyResults(results);
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });
}
