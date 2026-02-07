// ============================================================
// OpenClaw Deploy — Update Manager
// ============================================================

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import type { VersionCheckResult, UpdateResult } from '../../types/index.js';
import { ContainerManager } from '../docker/container-manager.js';
import { waitForHealthy } from '../docker/health-check.js';

// ---------------------------------------------------------------------------
// Shell helper (same pattern as container-manager.ts)
// ---------------------------------------------------------------------------

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
// Version detection
// ---------------------------------------------------------------------------

export async function getCurrentVersion(installDir: string): Promise<string> {
  try {
    const composePath = join(installDir, 'docker-compose.yml');
    const content = await readFile(composePath, 'utf-8');

    // Extract image tag from docker-compose.yml
    const imageMatch = content.match(/image:\s*[^:\s]+:([^\s]+)/);
    if (imageMatch) {
      return imageMatch[1];
    }

    return 'latest';
  } catch {
    return 'unknown';
  }
}

export async function checkForUpdates(installDir: string): Promise<VersionCheckResult> {
  const currentVersion = await getCurrentVersion(installDir);

  try {
    // Query npm registry for the latest published version
    const response = await fetch('https://registry.npmjs.org/openclaw-deploy/latest', {
      method: 'GET',
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return {
        currentVersion,
        latestVersion: 'unknown',
        updateAvailable: false,
      };
    }

    const data = await response.json() as {
      version?: string;
      time?: Record<string, string>;
    };

    const latestVersion = data.version ?? 'unknown';
    const updateAvailable =
      latestVersion !== 'unknown' &&
      currentVersion !== latestVersion &&
      currentVersion !== 'unknown';

    return {
      currentVersion,
      latestVersion,
      updateAvailable,
      publishedAt: data.time?.[latestVersion],
    };
  } catch {
    return {
      currentVersion,
      latestVersion: 'unknown',
      updateAvailable: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Image pulling
// ---------------------------------------------------------------------------

export async function pullLatestImage(
  installDir: string,
  onProgress?: (message: string) => void,
): Promise<{ success: boolean; output: string; error?: string }> {
  try {
    onProgress?.('Pulling latest images...');
    const { stdout, stderr } = await exec(
      'docker',
      ['compose', 'pull'],
      installDir,
    );
    onProgress?.('Pull complete.');
    return { success: true, output: stdout || stderr };
  } catch (err) {
    return {
      success: false,
      output: '',
      error: (err as Error).message,
    };
  }
}

// ---------------------------------------------------------------------------
// Full update orchestration
// ---------------------------------------------------------------------------

export async function performUpdate(
  installDir: string,
  gatewayUrl: string,
  onProgress?: (message: string) => void,
): Promise<UpdateResult> {
  const previousVersion = await getCurrentVersion(installDir);

  // 1. Pull latest images
  onProgress?.('Pulling latest images...');
  const pullResult = await pullLatestImage(installDir, onProgress);

  if (!pullResult.success) {
    return {
      success: false,
      previousVersion,
      newVersion: previousVersion,
      pullOutput: pullResult.output,
      healthCheckPassed: false,
      error: pullResult.error,
    };
  }

  // 2. Restart containers
  onProgress?.('Restarting containers...');
  const manager = new ContainerManager(installDir);
  const restartResult = await manager.restart();

  if (!restartResult.success) {
    return {
      success: false,
      previousVersion,
      newVersion: previousVersion,
      pullOutput: pullResult.output,
      healthCheckPassed: false,
      error: restartResult.error,
    };
  }

  // 3. Wait for healthy
  onProgress?.('Waiting for gateway to become healthy...');
  const healthy = await waitForHealthy(gatewayUrl, 30000, 2000);

  // 4. Get new version
  const newVersion = await getCurrentVersion(installDir);

  return {
    success: healthy,
    previousVersion,
    newVersion,
    pullOutput: pullResult.output,
    healthCheckPassed: healthy,
    error: healthy ? undefined : 'Gateway did not become healthy after restart.',
  };
}
