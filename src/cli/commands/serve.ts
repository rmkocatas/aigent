// ============================================================
// OpenClaw Deploy — Serve Command
// ============================================================

import { Command } from 'commander';
import chalk from 'chalk';
import { loadGatewayConfig } from '../../core/gateway/config-loader.js';
import { createGatewayServer } from '../../core/gateway/server.js';
import { printError } from '../formatters/output.js';

export function createServeCommand(): Command {
  return new Command('serve')
    .description('Start the OpenClaw gateway server')
    .option('--config-dir <dir>', 'Config directory', '~/.openclaw')
    .option('--port <port>', 'Override listen port')
    .option('--bind <address>', 'Override bind address')
    .action(async (opts) => {
      try {
        const config = await loadGatewayConfig(opts.configDir);

        if (opts.port) config.port = parseInt(opts.port, 10);
        if (opts.bind) config.bind = opts.bind;

        console.log('');
        console.log(chalk.bold('  OpenClaw Gateway'));
        console.log(chalk.dim('  ─────────────────'));
        console.log('');

        const gateway = await createGatewayServer(config);
        await gateway.start();

        const addr = `http://${config.bind === '0.0.0.0' ? 'localhost' : config.bind}:${config.port}`;
        console.log(`  ${chalk.green('●')} Server running at ${chalk.cyan(addr)}`);
        console.log('');
        console.log(`  ${chalk.dim('Webchat:')}   ${addr}`);
        console.log(`  ${chalk.dim('Health:')}    ${addr}/health`);
        console.log(`  ${chalk.dim('Chat API:')} ${addr}/api/chat`);
        console.log('');

        if (config.ollama) {
          console.log(`  ${chalk.dim('Ollama:')}    ${config.ollama.model} @ ${config.ollama.baseUrl}`);
        }
        if (config.anthropicApiKey) {
          console.log(`  ${chalk.dim('Anthropic:')} configured`);
        }
        if (config.openaiApiKey) {
          console.log(`  ${chalk.dim('OpenAI:')}    configured`);
        }
        if (config.routing) {
          console.log(`  ${chalk.dim('Routing:')}   ${config.routing.mode}`);
        }
        if (gateway.telegramBot) {
          console.log(`  ${chalk.dim('Telegram:')} polling active`);
        }
        console.log('');
        console.log(chalk.dim('  Press Ctrl+C to stop'));
        console.log('');

        // Graceful shutdown
        const shutdown = async () => {
          console.log('');
          console.log(chalk.dim('  Shutting down...'));
          await gateway.stop();
          process.exit(0);
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });
}
