// ============================================================
// OpenClaw Deploy — Docker Detection
// ============================================================

import { execFile } from 'node:child_process';

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

export async function detectDocker(): Promise<{
  available: boolean;
  version?: string;
  composeAvailable: boolean;
}> {
  let available = false;
  let version: string | undefined;
  let composeAvailable = false;

  try {
    const output = await exec('docker', ['--version']);
    // Output format: "Docker version 24.0.7, build afdd53b"
    const match = output.match(/Docker version\s+([\d.]+)/i);
    if (match) {
      available = true;
      version = match[1];
    }
  } catch {
    // Docker not installed or not accessible
  }

  if (available) {
    try {
      await exec('docker', ['compose', 'version']);
      composeAvailable = true;
    } catch {
      // Docker Compose not available
    }
  }

  return { available, version, composeAvailable };
}
