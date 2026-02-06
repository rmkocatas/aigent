// ============================================================
// OpenClaw Deploy — Fine-Tuned Model Manager
// ============================================================

import { execFile, spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelVersionMetadata {
  version: number;
  modelName: string;
  baseModel: string;
  createdAt: string;
  dataPointsUsed: number;
  trainingTime: string;
}

const METADATA_FILE = 'model-versions.json';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function exec(command: string, args: string[], timeout = 10_000): Promise<string> {
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

// ---------------------------------------------------------------------------
// Modelfile generation
// ---------------------------------------------------------------------------

/** Generate an Ollama Modelfile for a fine-tuned model. */
export function createModelfile(_baseModel: string, ggufPath: string): string {
  return [
    `FROM ${ggufPath}`,
    'PARAMETER temperature 0.7',
    'PARAMETER top_p 0.9',
    'SYSTEM You are a helpful AI assistant.',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Import model into Ollama
// ---------------------------------------------------------------------------

/** Import a fine-tuned model into Ollama using `ollama create`. */
export async function importModel(
  modelName: string,
  modelfilePath: string,
  onProgress?: (message: string) => void,
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    onProgress?.(`Importing model ${modelName}...`);

    const child = spawn('ollama', ['create', modelName, '-f', modelfilePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 300_000, // 5 minute timeout
    });

    let lastLine = '';

    child.stdout?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (line && line !== lastLine) {
        lastLine = line;
        onProgress?.(line);
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (line) {
        onProgress?.(line);
      }
    });

    child.on('close', (code) => {
      if (code === 0) {
        onProgress?.(`Model ${modelName} imported successfully`);
        resolve({ success: true });
      } else {
        resolve({
          success: false,
          error: `Failed to import model ${modelName} (exit code ${code})`,
        });
      }
    });

    child.on('error', (err) => {
      resolve({
        success: false,
        error: `Failed to import model ${modelName}: ${err.message}`,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// List fine-tuned model versions
// ---------------------------------------------------------------------------

/** List all fine-tuned model versions matching the convention `<base>-ft-vN`. */
export async function listFineTunedModels(baseModelName: string): Promise<string[]> {
  const prefix = `${baseModelName}-ft-v`;
  const models: string[] = [];

  try {
    const output = await exec('ollama', ['list']);
    const lines = output.split('\n');
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const name = line.split(/\s+/)[0];
      if (name && name.startsWith(prefix)) {
        models.push(name);
      }
    }
  } catch {
    // Could not list models
  }

  // Sort by version number ascending
  models.sort((a, b) => {
    const vA = parseInt(a.slice(prefix.length), 10) || 0;
    const vB = parseInt(b.slice(prefix.length), 10) || 0;
    return vA - vB;
  });

  return models;
}

// ---------------------------------------------------------------------------
// Version helpers
// ---------------------------------------------------------------------------

/** Get the latest fine-tuned version number (0 if none exist). */
export async function getLatestVersion(baseModelName: string): Promise<number> {
  const models = await listFineTunedModels(baseModelName);
  if (models.length === 0) return 0;

  const prefix = `${baseModelName}-ft-v`;
  let max = 0;
  for (const name of models) {
    const v = parseInt(name.slice(prefix.length), 10) || 0;
    if (v > max) max = v;
  }
  return max;
}

/** Generate the next version name. */
export function nextVersionName(baseModelName: string, currentVersion: number): string {
  return `${baseModelName}-ft-v${currentVersion + 1}`;
}

// ---------------------------------------------------------------------------
// Rollback / switch active model
// ---------------------------------------------------------------------------

/**
 * Switch the active model by updating the deployment config JSON at `configPath`
 * to use the specified `modelName`.
 */
export async function rollback(
  configPath: string,
  modelName: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const raw = await readFile(configPath, 'utf-8');
    const config = JSON.parse(raw);

    // Update the Ollama model reference in the config
    if (config.llm?.ollama) {
      config.llm.ollama.model = modelName;
    } else if (config.llm) {
      config.llm.model = modelName;
    } else {
      return { success: false, error: 'No LLM config found in config file' };
    }

    await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: `Failed to update config: ${(err as Error).message}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Model metadata persistence
// ---------------------------------------------------------------------------

/** Save a model version's metadata to the data directory. */
export async function saveModelMetadata(
  dataDir: string,
  metadata: ModelVersionMetadata,
): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const filePath = join(dataDir, METADATA_FILE);

  let existing: ModelVersionMetadata[] = [];
  try {
    const raw = await readFile(filePath, 'utf-8');
    existing = JSON.parse(raw);
  } catch {
    // File does not exist yet
  }

  existing.push(metadata);
  await writeFile(filePath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
}

/** Load all model version metadata from the data directory. */
export async function loadModelMetadata(
  dataDir: string,
): Promise<ModelVersionMetadata[]> {
  const filePath = join(dataDir, METADATA_FILE);

  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}
