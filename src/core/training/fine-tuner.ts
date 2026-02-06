// ============================================================
// OpenClaw Deploy — Fine-Tuning Orchestrator
// ============================================================

import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { platform, arch } from 'node:os';

import type {
  TrainingBackend,
  FineTuneConfig,
  FineTuneResult,
} from '../../types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function exec(command: string, args: string[], timeout = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

/**
 * Try several candidate names for the Python 3 binary and return the first
 * one that responds to `--version`.
 */
async function findPython(): Promise<string | undefined> {
  const candidates = platform() === 'win32'
    ? ['python', 'python3', 'py']
    : ['python3', 'python'];

  for (const cmd of candidates) {
    try {
      const out = await exec(cmd, ['--version']);
      if (out.startsWith('Python 3')) {
        return cmd;
      }
    } catch {
      // not found — try next
    }
  }
  return undefined;
}

async function hasPythonModule(python: string, mod: string): Promise<boolean> {
  try {
    await exec(python, ['-c', `import ${mod}`]);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Detect Training Backend
// ---------------------------------------------------------------------------

export async function detectTrainingBackend(): Promise<{
  backend: TrainingBackend;
  pythonPath?: string;
  gpuAvailable: boolean;
  gpuType?: 'nvidia' | 'apple-silicon' | 'amd';
}> {
  const pythonPath = await findPython();
  if (!pythonPath) {
    return { backend: 'none', gpuAvailable: false };
  }

  // GPU detection ----------------------------------------------------------
  let gpuAvailable = false;
  let gpuType: 'nvidia' | 'apple-silicon' | 'amd' | undefined;

  // NVIDIA
  try {
    await exec('nvidia-smi', []);
    gpuAvailable = true;
    gpuType = 'nvidia';
  } catch {
    // no NVIDIA GPU
  }

  // Apple Silicon
  if (!gpuAvailable && platform() === 'darwin' && arch() === 'arm64') {
    gpuAvailable = true;
    gpuType = 'apple-silicon';
  }

  // AMD (ROCm) — check for rocm-smi
  if (!gpuAvailable) {
    try {
      await exec('rocm-smi', ['--showid']);
      gpuAvailable = true;
      gpuType = 'amd';
    } catch {
      // no AMD GPU
    }
  }

  // Backend detection (in priority order) ----------------------------------

  // Unsloth is preferred when an NVIDIA GPU is present
  if (gpuType === 'nvidia' && (await hasPythonModule(pythonPath, 'unsloth'))) {
    return { backend: 'unsloth', pythonPath, gpuAvailable, gpuType };
  }

  // MLX is preferred on Apple Silicon
  if (gpuType === 'apple-silicon' && (await hasPythonModule(pythonPath, 'mlx'))) {
    return { backend: 'mlx', pythonPath, gpuAvailable, gpuType };
  }

  // Fallback to HuggingFace transformers
  if (await hasPythonModule(pythonPath, 'transformers')) {
    return { backend: 'transformers', pythonPath, gpuAvailable, gpuType };
  }

  return { backend: 'none', pythonPath, gpuAvailable, gpuType };
}

// ---------------------------------------------------------------------------
// Estimate Training Time
// ---------------------------------------------------------------------------

export function estimateTrainingTime(
  dataPoints: number,
  memoryMB: number,
  backend: TrainingBackend,
): string {
  // Very rough heuristics — actual times depend on model size, hardware, etc.
  const baseMinutesPerEpoch = dataPoints / 200; // ~200 samples / minute baseline

  let multiplier: number;
  switch (backend) {
    case 'unsloth':
      multiplier = 0.5; // fastest — fused kernels + quantisation tricks
      break;
    case 'mlx':
      multiplier = 0.8;
      break;
    case 'transformers':
      multiplier = memoryMB < 16_000 ? 3 : 1.5; // CPU-only is much slower
      break;
    default:
      return 'unknown — no training backend available';
  }

  const totalMinutes = Math.max(1, Math.round(baseMinutesPerEpoch * multiplier));

  if (totalMinutes < 60) {
    return `~${totalMinutes} minute${totalMinutes === 1 ? '' : 's'}`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return `~${hours}h ${mins}m`;
}

// ---------------------------------------------------------------------------
// Run Fine-Tune
// ---------------------------------------------------------------------------

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

export async function runFineTune(
  config: FineTuneConfig,
  onProgress?: (message: string, progress?: number) => void,
): Promise<FineTuneResult> {
  // Resolve the bundled Python training script
  const scriptPath = join(__dirname, 'scripts', 'finetune.py');

  // Determine the python binary to use
  const pythonPath = (await findPython()) ?? 'python3';

  const args: string[] = [
    scriptPath,
    '--data', config.dataPath,
    '--base-model', config.baseModel,
    '--output-dir', config.outputDir,
    '--lora-rank', String(config.loraRank),
    '--epochs', String(config.epochs),
    '--batch-size', String(config.batchSize),
    '--lr', String(config.learningRate),
    '--backend', config.backend,
  ];

  onProgress?.('Starting fine-tuning process...', 0);

  return new Promise<FineTuneResult>((resolve) => {
    const child = spawn(pythonPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: FOUR_HOURS_MS,
    });

    let lastError = '';
    let result: FineTuneResult | undefined;

    child.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;

        // Try to parse JSON progress lines
        try {
          const msg = JSON.parse(line) as {
            status?: string;
            progress?: number;
            epoch?: number;
            loss?: number;
            model_path?: string;
            training_time?: string;
            data_points?: number;
            error?: string;
          };

          if (msg.status === 'complete' && msg.model_path) {
            result = {
              success: true,
              modelName: msg.model_path,
              trainingTime: msg.training_time ?? 'unknown',
              dataPointsUsed: msg.data_points ?? 0,
            };
          } else if (msg.status === 'error') {
            result = {
              success: false,
              modelName: '',
              trainingTime: '',
              dataPointsUsed: 0,
              error: msg.error ?? 'Unknown training error',
            };
          }

          // Forward progress to the caller
          const progressLabel = msg.epoch != null && msg.loss != null
            ? `${msg.status ?? 'training'} — epoch ${msg.epoch}, loss ${msg.loss.toFixed(4)}`
            : (msg.status ?? 'training');

          onProgress?.(progressLabel, msg.progress);
        } catch {
          // Not JSON — forward as plain text progress
          onProgress?.(line);
        }
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) {
        lastError = text;
      }
    });

    child.on('close', (code) => {
      if (result) {
        resolve(result);
        return;
      }

      if (code === 0) {
        resolve({
          success: false,
          modelName: '',
          trainingTime: '',
          dataPointsUsed: 0,
          error: 'Training process exited without producing a result.',
        });
      } else {
        resolve({
          success: false,
          modelName: '',
          trainingTime: '',
          dataPointsUsed: 0,
          error: lastError || `Training process exited with code ${code}`,
        });
      }
    });

    child.on('error', (err) => {
      resolve({
        success: false,
        modelName: '',
        trainingTime: '',
        dataPointsUsed: 0,
        error: `Failed to start training process: ${err.message}`,
      });
    });
  });
}
