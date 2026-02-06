// ============================================================
// OpenClaw Deploy — Existing Installation Detection
// ============================================================

import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

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

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readVersionFromConfig(dir: string): Promise<string | undefined> {
  try {
    const configPath = join(dir, 'config.json');
    const raw = await readFile(configPath, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    if (typeof config.version === 'string') {
      return config.version;
    }
  } catch {
    // Config file not readable or missing
  }
  return undefined;
}

async function getVersionFromCli(command: string): Promise<string | undefined> {
  try {
    const output = await exec(command, ['--version']);
    const match = output.match(/([\d]+\.[\d]+\.[\d]+)/);
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

const whichCommand = process.platform === 'win32' ? 'where' : 'which';

async function findOnPath(name: string): Promise<string | undefined> {
  try {
    const output = await exec(whichCommand, [name]);
    // `where` on Windows may return multiple lines; take the first
    const firstLine = output.split(/\r?\n/)[0];
    return firstLine || undefined;
  } catch {
    return undefined;
  }
}

export async function detectExistingInstall(): Promise<{
  found: boolean;
  path?: string;
  version?: string;
}> {
  const home = homedir();

  // Check known directory locations
  const knownDirs = [
    join(home, '.openclaw'),
    join(home, '.clawdbot'),
  ];

  for (const dir of knownDirs) {
    if (await exists(dir)) {
      const version = await readVersionFromConfig(dir);
      return { found: true, path: dir, version };
    }
  }

  // Check PATH for openclaw or clawdbot binaries
  const binaries = ['openclaw', 'clawdbot'] as const;
  for (const bin of binaries) {
    const binPath = await findOnPath(bin);
    if (binPath) {
      const version = await getVersionFromCli(bin);
      return { found: true, path: binPath, version };
    }
  }

  return { found: false };
}
