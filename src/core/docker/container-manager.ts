// ============================================================
// OpenClaw Deploy — Docker Container Manager
// ============================================================

import { execFile } from 'node:child_process';

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

export class ContainerManager {
  constructor(private composeDir: string) {}

  async start(): Promise<{ success: boolean; error?: string }> {
    try {
      await exec('docker', ['compose', 'up', '-d'], this.composeDir);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async stop(): Promise<{ success: boolean; error?: string }> {
    try {
      await exec('docker', ['compose', 'down'], this.composeDir);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async restart(): Promise<{ success: boolean; error?: string }> {
    try {
      await exec('docker', ['compose', 'restart'], this.composeDir);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async status(): Promise<{ running: boolean; containers: string[] }> {
    try {
      const { stdout } = await exec(
        'docker',
        ['compose', 'ps', '--format', 'json'],
        this.composeDir,
      );
      const lines = stdout.trim().split('\n').filter(Boolean);
      const containers: string[] = [];
      let running = false;

      for (const line of lines) {
        const container = JSON.parse(line) as { Name: string; State: string };
        containers.push(container.Name);
        if (container.State === 'running') {
          running = true;
        }
      }

      return { running, containers };
    } catch {
      return { running: false, containers: [] };
    }
  }

  async logs(lines = 50): Promise<string> {
    try {
      const { stdout } = await exec(
        'docker',
        ['compose', 'logs', '--tail', String(lines)],
        this.composeDir,
      );
      return stdout;
    } catch (err) {
      return (err as Error).message;
    }
  }
}
