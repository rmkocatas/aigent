// ============================================================
// OpenClaw Deploy — Ollama Detection, Install & Model Management
// ============================================================

import { execFile, spawn } from 'node:child_process';
import { freemem } from 'node:os';

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
// Detection
// ---------------------------------------------------------------------------

export async function detectOllama(): Promise<{
  available: boolean;
  version?: string;
  models?: string[];
}> {
  let version: string | undefined;

  try {
    const output = await exec('ollama', ['--version']);
    // Output format varies: "ollama version 0.1.32" or "ollama version is 0.1.32"
    const match = output.match(/(\d+\.\d+[\d.]*)/);
    if (match) {
      version = match[1];
    }
  } catch {
    return { available: false };
  }

  const models = await listInstalledModels();
  return { available: true, version, models };
}

export async function listInstalledModels(): Promise<string[]> {
  const models: string[] = [];
  try {
    const output = await exec('ollama', ['list']);
    // Output is a tab/space separated table: NAME  ID  SIZE  MODIFIED
    // Skip the header line, extract just the NAME column
    const lines = output.split('\n');
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const name = line.split(/\s+/)[0];
      if (name) {
        models.push(name);
      }
    }
  } catch {
    // Could not list models
  }
  return models;
}

// ---------------------------------------------------------------------------
// Recommended models based on available RAM
// ---------------------------------------------------------------------------

export interface RecommendedModel {
  name: string;
  description: string;
  minMemoryMB: number;
}

const RECOMMENDED_MODELS: RecommendedModel[] = [
  { name: 'llama3.3:70b', description: '70B — best quality, needs 48GB+ RAM', minMemoryMB: 48_000 },
  { name: 'llama3.1:8b', description: '8B — good balance, needs 8GB+ RAM', minMemoryMB: 8_000 },
  { name: 'llama3.2:3b', description: '3B — lightweight, needs 4GB+ RAM', minMemoryMB: 4_000 },
  { name: 'llama3.2:1b', description: '1B — minimal, runs on almost anything', minMemoryMB: 2_000 },
];

export function getRecommendedModels(availableMemoryMB?: number): RecommendedModel[] {
  const mem = availableMemoryMB ?? Math.floor(freemem() / (1024 * 1024));
  return RECOMMENDED_MODELS.filter((m) => mem >= m.minMemoryMB);
}

export function getBestModelForSystem(availableMemoryMB?: number): string {
  const models = getRecommendedModels(availableMemoryMB);
  return models.length > 0 ? models[0].name : 'llama3.2:1b';
}

// ---------------------------------------------------------------------------
// Install Ollama
// ---------------------------------------------------------------------------

export async function installOllama(
  onProgress?: (message: string) => void,
): Promise<{ success: boolean; error?: string }> {
  const platform = process.platform;

  try {
    if (platform === 'linux' || platform === 'freebsd') {
      onProgress?.('Downloading Ollama install script...');
      // Official Ollama install script
      const result = await execCommand('curl', ['-fsSL', 'https://ollama.com/install.sh'], 120_000);
      onProgress?.('Running install script...');
      await execCommandWithInput('sh', [], result, 120_000);
    } else if (platform === 'darwin') {
      onProgress?.('Installing Ollama via brew...');
      await execCommand('brew', ['install', 'ollama'], 120_000);
    } else if (platform === 'win32') {
      onProgress?.('Downloading Ollama for Windows...');
      await execCommand('winget', ['install', '--id', 'Ollama.Ollama', '-e', '--accept-source-agreements', '--accept-package-agreements'], 120_000);
    } else {
      return { success: false, error: `Unsupported platform: ${platform}. Install Ollama manually from https://ollama.com` };
    }

    // Verify installation
    await exec('ollama', ['--version']);
    onProgress?.('Ollama installed successfully');
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: `Ollama installation failed: ${(err as Error).message}. Install manually from https://ollama.com`,
    };
  }
}

function execCommand(command: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function execCommandWithInput(command: string, args: string[], input: string, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { timeout }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout.trim());
    });
    child.stdin?.write(input);
    child.stdin?.end();
  });
}

// ---------------------------------------------------------------------------
// Pull a model (with live progress output)
// ---------------------------------------------------------------------------

export async function pullOllamaModel(
  model: string,
  onProgress?: (message: string) => void,
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    onProgress?.(`Pulling ${model}... this may take a few minutes`);

    const child = spawn('ollama', ['pull', model], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 600_000, // 10 minute timeout for large models
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
        onProgress?.(`${model} pulled successfully`);
        resolve({ success: true });
      } else {
        resolve({
          success: false,
          error: `Failed to pull ${model} (exit code ${code}). Run 'ollama pull ${model}' manually.`,
        });
      }
    });

    child.on('error', (err) => {
      resolve({
        success: false,
        error: `Failed to pull ${model}: ${err.message}`,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Ensure Ollama + model are ready (orchestrates install + pull)
// ---------------------------------------------------------------------------

export async function ensureOllamaReady(
  preferredModel?: string,
  availableMemoryMB?: number,
  onProgress?: (message: string) => void,
): Promise<{
  ready: boolean;
  model: string;
  installedOllama: boolean;
  pulledModel: boolean;
  error?: string;
}> {
  let installedOllama = false;
  let pulledModel = false;
  const targetModel = preferredModel ?? getBestModelForSystem(availableMemoryMB);

  // 1. Check if Ollama is installed
  let detection = await detectOllama();

  if (!detection.available) {
    onProgress?.('Ollama not found — installing...');
    const installResult = await installOllama(onProgress);
    if (!installResult.success) {
      return { ready: false, model: targetModel, installedOllama: false, pulledModel: false, error: installResult.error };
    }
    installedOllama = true;

    // Start Ollama serve in background (it may need to be running to pull)
    try {
      spawn('ollama', ['serve'], { stdio: 'ignore', detached: true }).unref();
      // Give it a moment to start
      await new Promise((r) => setTimeout(r, 2000));
    } catch {
      // serve may already be running via system service
    }

    detection = await detectOllama();
    if (!detection.available) {
      return { ready: false, model: targetModel, installedOllama: true, pulledModel: false, error: 'Ollama installed but not responding. Try restarting your terminal.' };
    }
  }

  // 2. Check if the target model is already pulled
  const installedModels = detection.models ?? [];
  const hasModel = installedModels.some(
    (m) => m === targetModel || m.startsWith(targetModel.split(':')[0] + ':'),
  );

  if (hasModel) {
    return { ready: true, model: targetModel, installedOllama, pulledModel: false };
  }

  // 3. Pull the model
  onProgress?.(`Model ${targetModel} not found locally`);
  const pullResult = await pullOllamaModel(targetModel, onProgress);
  if (!pullResult.success) {
    return { ready: false, model: targetModel, installedOllama, pulledModel: false, error: pullResult.error };
  }

  pulledModel = true;
  return { ready: true, model: targetModel, installedOllama, pulledModel };
}
