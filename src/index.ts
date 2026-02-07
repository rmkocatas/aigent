#!/usr/bin/env node
import { Command } from 'commander';
import { createInitCommand } from './cli/commands/init.js';
import { createTrainCommand } from './cli/commands/train.js';
import { createServeCommand } from './cli/commands/serve.js';
import { createCredentialsCommand } from './cli/commands/credentials.js';
import { createUpdateCommand } from './cli/commands/update.js';
import { createAuditCommand } from './cli/commands/audit.js';
import { createChannelsCommand } from './cli/commands/channels.js';
import { createStatusCommand } from './cli/commands/status.js';
import { createTeardownCommand } from './cli/commands/teardown.js';

const program = new Command();

program
  .name('openclaw-deploy')
  .description('One-command deployment toolkit for hardened OpenClaw AI agents')
  .version('0.1.0');

// Default command is init
program.addCommand(createInitCommand(), { isDefault: true });
program.addCommand(createTrainCommand());
program.addCommand(createServeCommand());

// Phase 2 commands
program.addCommand(createCredentialsCommand());
program.addCommand(createUpdateCommand());
program.addCommand(createAuditCommand());

program.addCommand(createChannelsCommand());
program.addCommand(createStatusCommand());
program.addCommand(createTeardownCommand());

program.parse();
