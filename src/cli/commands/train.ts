// ============================================================
// OpenClaw Deploy — Train Command
// ============================================================

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { TrainingDataStore } from '../../core/training/data-collector.js';
import { detectTrainingBackend, runFineTune, estimateTrainingTime } from '../../core/training/fine-tuner.js';
import {
  listFineTunedModels,
  getLatestVersion,
  nextVersionName,
  createModelfile,
  importModel,
  saveModelMetadata,
} from '../../core/training/model-manager.js';
import { shouldTriggerTraining, getAutoTrainerDefaults, formatTrainingStatus } from '../../core/training/auto-trainer.js';
import { printError } from '../formatters/output.js';
import type { TrainingStats, FineTuneConfig } from '../../types/index.js';

// ---------------------------------------------------------------------------
// Default paths
// ---------------------------------------------------------------------------

const DEFAULT_DATA_DIR = '~/.openclaw/training';
const DEFAULT_BASE_MODEL = 'llama3.1:8b';

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

export function createTrainCommand(): Command {
  const cmd = new Command('train')
    .description('Manage local model training and distillation');

  cmd.addCommand(createStatusCommand());
  cmd.addCommand(createStartCommand());
  cmd.addCommand(createExportCommand());

  return cmd;
}

// ---------------------------------------------------------------------------
// train status
// ---------------------------------------------------------------------------

function createStatusCommand(): Command {
  return new Command('status')
    .description('Show training data stats and model versions')
    .option('--data-dir <dir>', 'Training data directory', DEFAULT_DATA_DIR)
    .option('--base-model <model>', 'Base Ollama model name', DEFAULT_BASE_MODEL)
    .action(async (opts) => {
      try {
        const dataDir = resolveHome(opts.dataDir);
        const store = new TrainingDataStore(dataDir);
        await store.init();

        const stats = await store.getStats();
        const versions = await listFineTunedModels(opts.baseModel);
        const config = getAutoTrainerDefaults();

        const fullStats: TrainingStats = {
          ...stats,
          fineTunedVersions: versions,
          currentModel: opts.baseModel,
        };

        console.log('');
        console.log(chalk.bold('  Training Status'));
        console.log(chalk.dim('  ---------------'));
        console.log('');
        const lines = formatTrainingStatus(fullStats, config).split('\n');
        for (const line of lines) {
          console.log(`  ${line}`);
        }
        console.log('');

        // Check if ready
        const trigger = await shouldTriggerTraining(fullStats, config);
        if (trigger.shouldTrain) {
          console.log(chalk.green(`  Ready to train! Run: openclaw-deploy train start`));
        } else {
          console.log(chalk.dim(`  ${trigger.reason}`));
        }
        console.log('');
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });
}

// ---------------------------------------------------------------------------
// train start
// ---------------------------------------------------------------------------

function createStartCommand(): Command {
  return new Command('start')
    .description('Run fine-tuning on collected training data')
    .option('--data-dir <dir>', 'Training data directory', DEFAULT_DATA_DIR)
    .option('--base-model <model>', 'Base Ollama model to fine-tune', DEFAULT_BASE_MODEL)
    .option('--lora-rank <n>', 'LoRA rank', '16')
    .option('--epochs <n>', 'Training epochs', '3')
    .option('--batch-size <n>', 'Batch size', '4')
    .option('--lr <rate>', 'Learning rate', '2e-4')
    .action(async (opts) => {
      try {
        const dataDir = resolveHome(opts.dataDir);
        const store = new TrainingDataStore(dataDir);
        await store.init();

        const stats = await store.getStats();

        if (stats.totalEntries === 0) {
          printError('No training data collected yet. Use the agent in hybrid mode to collect data.');
          process.exitCode = 1;
          return;
        }

        console.log('');
        console.log(chalk.bold(`  Fine-tuning ${opts.baseModel} with ${stats.totalEntries} examples`));
        console.log('');

        // 1. Detect backend
        const backendSpinner = ora('Detecting training backend...').start();
        const backend = await detectTrainingBackend();

        if (backend.backend === 'none') {
          backendSpinner.fail('No training backend found');
          console.log('');
          console.log('  Install one of the following:');
          console.log('    pip install unsloth     (NVIDIA GPU, recommended)');
          console.log('    pip install mlx-lm      (Apple Silicon)');
          console.log('    pip install transformers (CPU fallback, slow)');
          console.log('');
          process.exitCode = 1;
          return;
        }

        backendSpinner.succeed(`Backend: ${backend.backend}${backend.gpuAvailable ? ` (${backend.gpuType} GPU)` : ' (CPU)'}`);

        // 2. Estimate time
        const estimate = estimateTrainingTime(stats.totalEntries, 16384, backend.backend);
        console.log(chalk.dim(`  Estimated training time: ${estimate}`));
        console.log('');

        // 3. Export training data
        const exportSpinner = ora('Exporting training data...').start();
        const exportPath = `${dataDir}/training-export.json`;
        const exportResult = await store.exportForTraining(exportPath);
        exportSpinner.succeed(`Exported ${exportResult.count} entries`);

        // 4. Determine output model name
        const currentVersion = await getLatestVersion(opts.baseModel);
        const newModelName = nextVersionName(opts.baseModel, currentVersion);
        const outputDir = `${dataDir}/models/${newModelName}`;

        // 5. Run fine-tuning
        const trainSpinner = ora('Starting fine-tuning...').start();
        const config: FineTuneConfig = {
          baseModel: opts.baseModel,
          dataPath: exportPath,
          outputDir,
          loraRank: parseInt(opts.loraRank, 10),
          epochs: parseInt(opts.epochs, 10),
          batchSize: parseInt(opts.batchSize, 10),
          learningRate: parseFloat(opts.lr),
          backend: backend.backend,
        };

        const result = await runFineTune(config, (msg, progress) => {
          if (progress !== undefined) {
            trainSpinner.text = `Training: ${Math.round(progress * 100)}% — ${msg}`;
          } else {
            trainSpinner.text = msg;
          }
        });

        if (!result.success) {
          trainSpinner.fail(result.error ?? 'Fine-tuning failed');
          process.exitCode = 1;
          return;
        }

        trainSpinner.succeed(`Fine-tuning complete (${result.trainingTime})`);

        // 6. Create Modelfile and import into Ollama
        const importSpinner = ora('Importing model into Ollama...').start();
        const ggufPath = `${outputDir}/model.gguf`;
        const modelfileContent = createModelfile(opts.baseModel, ggufPath);
        const modelfilePath = `${outputDir}/Modelfile`;

        const { writeFile } = await import('node:fs/promises');
        await writeFile(modelfilePath, modelfileContent, 'utf-8');

        const importResult = await importModel(newModelName, modelfilePath, (msg) => {
          importSpinner.text = msg;
        });

        if (!importResult.success) {
          importSpinner.fail(importResult.error ?? 'Failed to import model');
          process.exitCode = 1;
          return;
        }

        importSpinner.succeed(`Model imported as ${chalk.cyan(newModelName)}`);

        // 7. Save metadata
        await saveModelMetadata(dataDir, {
          version: currentVersion + 1,
          modelName: newModelName,
          baseModel: opts.baseModel,
          createdAt: new Date().toISOString(),
          dataPointsUsed: result.dataPointsUsed,
          trainingTime: result.trainingTime,
        });

        console.log('');
        console.log(chalk.green.bold('  Training complete!'));
        console.log(`  ${chalk.dim('New model:')} ${chalk.cyan(newModelName)}`);
        console.log(`  ${chalk.dim('Data used:')} ${result.dataPointsUsed} examples`);
        console.log(`  ${chalk.dim('Duration:')}  ${result.trainingTime}`);
        console.log('');
        console.log(`  Update your config to use: ${chalk.cyan(newModelName)}`);
        console.log('');
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });
}

// ---------------------------------------------------------------------------
// train export
// ---------------------------------------------------------------------------

function createExportCommand(): Command {
  return new Command('export')
    .description('Export training data for external use')
    .option('--data-dir <dir>', 'Training data directory', DEFAULT_DATA_DIR)
    .option('--output <path>', 'Output file path', './training-export.json')
    .option('--format <fmt>', 'Export format: alpaca, jsonl', 'alpaca')
    .action(async (opts) => {
      try {
        const dataDir = resolveHome(opts.dataDir);
        const store = new TrainingDataStore(dataDir);
        await store.init();

        const spinner = ora('Exporting training data...').start();
        const result = await store.exportForTraining(opts.output);
        spinner.succeed(`Exported ${result.count} entries to ${opts.output}`);
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });
}
