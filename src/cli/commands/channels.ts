// ============================================================
// OpenClaw Deploy — Channels Command
// ============================================================

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { select, input, confirm } from '@inquirer/prompts';
import {
  CHANNEL_DEFINITIONS,
  getChannelDefinition,
  loadChannelConfig,
  saveChannelConfig,
  enableChannel,
  disableChannel,
} from '../../core/channels/manager.js';
import { setCredential } from '../../core/credentials/manager.js';
import { printError, printChannelsList } from '../formatters/output.js';
import type { ChannelId } from '../../types/index.js';

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

export function createChannelsCommand(): Command {
  const cmd = new Command('channels')
    .description('Manage messaging platform channels');

  cmd.addCommand(createListCommand());
  cmd.addCommand(createEnableCommand());
  cmd.addCommand(createDisableCommand());

  return cmd;
}

// ---------------------------------------------------------------------------
// channels list
// ---------------------------------------------------------------------------

function createListCommand(): Command {
  return new Command('list')
    .description('Show configured channels and their status')
    .option('--install-dir <dir>', 'Installation directory', DEFAULT_INSTALL_DIR)
    .action(async (opts) => {
      try {
        const installDir = resolveHome(opts.installDir);
        const channels = await loadChannelConfig(installDir);
        printChannelsList(channels);
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });
}

// ---------------------------------------------------------------------------
// channels enable
// ---------------------------------------------------------------------------

function createEnableCommand(): Command {
  return new Command('enable')
    .description('Enable a messaging channel')
    .argument('[channel]', 'Channel to enable (telegram, discord, slack, whatsapp, signal)')
    .option('--install-dir <dir>', 'Installation directory', DEFAULT_INSTALL_DIR)
    .action(async (channel: string | undefined, opts) => {
      try {
        const installDir = resolveHome(opts.installDir);

        // If no channel specified, prompt for selection
        let channelId: ChannelId;
        if (!channel) {
          const available = CHANNEL_DEFINITIONS.filter((ch) => ch.id !== 'webchat');
          channelId = await select<ChannelId>({
            message: 'Which channel would you like to enable?',
            choices: available.map((ch) => ({
              name: `${ch.name}${ch.requiresExternalDaemon ? chalk.dim(' (requires daemon)') : ''}`,
              value: ch.id,
            })),
          });
        } else {
          channelId = channel as ChannelId;
        }

        const definition = getChannelDefinition(channelId);
        if (!definition) {
          printError(`Unknown channel: ${channelId}`);
          process.exitCode = 1;
          return;
        }

        // Prompt for required credentials
        let token: string | undefined;
        if (definition.credentialType === 'token') {
          for (const key of definition.configKeys) {
            const value = await input({
              message: `Enter ${key}:`,
              validate: (v) => v.trim().length > 0 ? true : `${key} is required`,
            });
            await setCredential(installDir, key, value.trim());
            if (key.endsWith('BOT_TOKEN')) {
              token = value.trim();
            }
          }
        } else if (definition.credentialType === 'oauth') {
          for (const key of definition.configKeys) {
            const value = await input({
              message: `Enter ${key}:`,
              validate: (v) => v.trim().length > 0 ? true : `${key} is required`,
            });
            await setCredential(installDir, key, value.trim());
          }
        }

        if (definition.requiresExternalDaemon) {
          console.log('');
          console.log(chalk.yellow(`  Note: ${definition.name} requires an external daemon.`));
          console.log(chalk.dim(`  Ensure the daemon is running before using this channel.`));
          console.log('');
        }

        const spinner = ora(`Enabling ${definition.name}...`).start();
        const channels = await loadChannelConfig(installDir);
        const updated = enableChannel(channels, channelId, token);
        await saveChannelConfig(installDir, updated);
        spinner.succeed(`${definition.name} enabled.`);

        console.log('');
        console.log(chalk.dim('  Restart the gateway for changes to take effect.'));
        console.log('');
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });
}

// ---------------------------------------------------------------------------
// channels disable
// ---------------------------------------------------------------------------

function createDisableCommand(): Command {
  return new Command('disable')
    .description('Disable a messaging channel')
    .argument('<channel>', 'Channel to disable (telegram, discord, slack, whatsapp, signal)')
    .option('--install-dir <dir>', 'Installation directory', DEFAULT_INSTALL_DIR)
    .option('--yes', 'Skip confirmation prompt')
    .action(async (channel: string, opts) => {
      try {
        const installDir = resolveHome(opts.installDir);
        const channelId = channel as ChannelId;

        if (channelId === 'webchat') {
          printError('Cannot disable webchat — it is always enabled.');
          process.exitCode = 1;
          return;
        }

        const definition = getChannelDefinition(channelId);
        if (!definition) {
          printError(`Unknown channel: ${channelId}`);
          process.exitCode = 1;
          return;
        }

        if (!opts.yes) {
          const proceed = await confirm({
            message: `Disable ${definition.name}?`,
            default: false,
          });
          if (!proceed) {
            console.log(chalk.dim('  Aborted.'));
            return;
          }
        }

        const spinner = ora(`Disabling ${definition.name}...`).start();
        const channels = await loadChannelConfig(installDir);
        const updated = disableChannel(channels, channelId);
        await saveChannelConfig(installDir, updated);
        spinner.succeed(`${definition.name} disabled.`);

        console.log('');
        console.log(chalk.dim('  Restart the gateway for changes to take effect.'));
        console.log('');
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });
}
