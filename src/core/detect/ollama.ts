// ============================================================
// OpenClaw Deploy — Ollama Detection
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
    // Could not list models, but Ollama is still available
  }

  return { available: true, version, models };
}
