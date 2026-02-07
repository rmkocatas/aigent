// ============================================================
// OpenClaw Deploy — Teardown Manager
// ============================================================

import { rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import type { TeardownResult } from '../../types/index.js';
import { ContainerManager } from '../docker/container-manager.js';

function exec(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Teardown operations
// ---------------------------------------------------------------------------

export async function stopContainers(
  installDir: string,
): Promise<{ success: boolean; error?: string }> {
  const manager = new ContainerManager(installDir);
  return manager.stop();
}

export async function removeVolumes(
  installDir: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await exec('docker', ['compose', 'down', '-v'], installDir);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function removeDeploymentFiles(
  installDir: string,
): Promise<{ removed: string[]; errors: string[] }> {
  const targetFiles = [
    'openclaw.json',
    '.env',
    'docker-compose.yml',
    'Caddyfile',
  ];

  const removed: string[] = [];
  const errors: string[] = [];

  for (const file of targetFiles) {
    const filePath = join(installDir, file);
    try {
      await stat(filePath);
      await rm(filePath);
      removed.push(file);
    } catch {
      // File doesn't exist, skip
    }
  }

  return { removed, errors };
}

export async function removeDataDirectories(
  installDir: string,
): Promise<{ removed: string[]; errors: string[] }> {
  const dataDirs = ['workspace', 'training', 'data'];
  const removed: string[] = [];
  const errors: string[] = [];

  for (const dir of dataDirs) {
    const dirPath = join(installDir, dir);
    try {
      await stat(dirPath);
      await rm(dirPath, { recursive: true });
      removed.push(dir);
    } catch {
      // Directory doesn't exist, skip
    }
  }

  return { removed, errors };
}

export async function performTeardown(
  installDir: string,
  options: {
    removeData: boolean;
    removeVolumes: boolean;
  },
  onProgress?: (message: string) => void,
): Promise<TeardownResult> {
  const errors: string[] = [];
  const filesRemoved: string[] = [];

  // 1. Stop and remove containers
  onProgress?.('Stopping containers...');
  let containersStopped = false;

  if (options.removeVolumes) {
    const volResult = await removeVolumes(installDir);
    containersStopped = volResult.success;
    if (!volResult.success && volResult.error) {
      errors.push(volResult.error);
    }
  } else {
    const stopResult = await stopContainers(installDir);
    containersStopped = stopResult.success;
    if (!stopResult.success && stopResult.error) {
      errors.push(stopResult.error);
    }
  }

  // 2. Remove config files
  onProgress?.('Removing configuration files...');
  const fileResult = await removeDeploymentFiles(installDir);
  filesRemoved.push(...fileResult.removed);
  errors.push(...fileResult.errors);

  // 3. Optionally remove data
  if (options.removeData) {
    onProgress?.('Removing data directories...');
    const dataResult = await removeDataDirectories(installDir);
    filesRemoved.push(...dataResult.removed.map((d) => `${d}/`));
    errors.push(...dataResult.errors);
  }

  return {
    containersStopped,
    filesRemoved,
    volumesRemoved: options.removeVolumes,
    errors,
  };
}
