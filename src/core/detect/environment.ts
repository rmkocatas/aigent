// ============================================================
// OpenClaw Deploy — Environment Detection Orchestrator
// ============================================================

import { freemem, cpus } from 'node:os';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import type { DetectedEnvironment } from '../../types/index.js';
import { detectDocker } from './docker.js';
import { findFreePort } from './ports.js';
import { detectExistingInstall } from './existing-install.js';

function exec(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 10_000 }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function detectOS(): DetectedEnvironment['os'] {
  const platform = process.platform;
  if (platform === 'darwin') return 'macos';
  if (platform === 'win32') return 'windows-wsl';
  return 'linux';
}

async function detectWSL(): Promise<boolean> {
  // Check environment variable first (fast path)
  if (process.env.WSL_DISTRO_NAME) return true;

  // Check /proc/version for WSL indicators
  try {
    const contents = await readFile('/proc/version', 'utf-8');
    return /microsoft|wsl/i.test(contents);
  } catch {
    return false;
  }
}

function detectShell(): DetectedEnvironment['shell'] {
  const shellEnv = process.env.SHELL;
  if (shellEnv) {
    if (shellEnv.includes('zsh')) return 'zsh';
    if (shellEnv.includes('bash')) return 'bash';
    if (shellEnv.includes('fish')) return 'fish';
  }

  // Windows fallback
  if (process.platform === 'win32') {
    const psModulePath = process.env.PSModulePath;
    if (psModulePath) return 'powershell';
  }

  return 'unknown';
}

async function detectSystemd(): Promise<boolean> {
  try {
    await exec('systemctl', ['--version']);
    return true;
  } catch {
    return false;
  }
}

async function detectTailscale(): Promise<boolean> {
  try {
    await exec('tailscale', ['status']);
    return true;
  } catch {
    return false;
  }
}

export async function detectEnvironment(): Promise<DetectedEnvironment> {
  // Run all independent detections in parallel
  const [docker, freePort, existingInstall, isWSL, hasSystemd, isTailscaleAvailable] =
    await Promise.all([
      detectDocker().catch(() => ({
        available: false as const,
        version: undefined,
        composeAvailable: false as const,
      })),
      findFreePort().catch(() => 18789),
      detectExistingInstall().catch(() => ({ found: false as const })),
      detectWSL().catch(() => false),
      detectSystemd().catch(() => false),
      detectTailscale().catch(() => false),
    ]);

  const os = detectOS();
  const shell = detectShell();
  const nodeVersion = process.version;
  const availableMemoryMB = Math.floor(freemem() / (1024 * 1024));
  const cpuCount = cpus().length;

  return {
    os: isWSL ? 'windows-wsl' : os,
    dockerAvailable: docker.available,
    dockerVersion: docker.version,
    dockerComposeAvailable: docker.composeAvailable,
    freePort,
    shell,
    nodeVersion,
    existingInstall: existingInstall.found ? existingInstall.path : undefined,
    hasSystemd,
    availableMemoryMB,
    cpuCount,
    isWSL,
    isTailscaleAvailable,
  };
}
