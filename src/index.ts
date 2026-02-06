#!/usr/bin/env node
import { Command } from 'commander';
import { createInitCommand } from './cli/commands/init.js';

const program = new Command();

program
  .name('openclaw-deploy')
  .description('One-command deployment toolkit for hardened OpenClaw AI agents')
  .version('0.1.0');

// Default command is init
program.addCommand(createInitCommand(), { isDefault: true });

// Stub commands for Phase 2
program.command('channels').description('Manage messaging platforms (coming soon)');
program.command('audit').description('Run security audit (coming soon)');
program.command('status').description('Check deployment health (coming soon)');
program.command('credentials').description('Manage secrets (coming soon)');
program.command('update').description('Update OpenClaw version (coming soon)');
program.command('teardown').description('Remove deployment (coming soon)');

program.parse();
