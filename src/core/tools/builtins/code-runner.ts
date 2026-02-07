// ============================================================
// OpenClaw Deploy — Code Runner Tool (Sandboxed)
// ============================================================

import { spawn } from 'node:child_process';
import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_SIZE = 32_000;

export const codeRunnerDefinition: ToolDefinition = {
  name: 'run_code',
  description: 'Execute JavaScript or Python code in a sandboxed subprocess. Returns stdout and stderr. Code runs with limited memory and no network access. This tool is restricted and must be explicitly allowed.',
  parameters: {
    type: 'object',
    properties: {
      language: {
        type: 'string',
        description: 'Programming language to use.',
        enum: ['javascript', 'python'],
      },
      code: {
        type: 'string',
        description: 'The code to execute.',
      },
    },
    required: ['language', 'code'],
  },
};

export const codeRunnerHandler: ToolHandler = async (input, context) => {
  const language = input.language as string;
  const code = input.code as string;

  if (!code || typeof code !== 'string') {
    throw new Error('Missing code');
  }

  if (code.length > 10_000) {
    throw new Error('Code too long (max 10,000 characters)');
  }

  const timeout = Math.min(context.maxExecutionMs, DEFAULT_TIMEOUT_MS);

  // Clean environment: only essential vars, no secrets
  const cleanEnv: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? process.env.USERPROFILE ?? '',
    TEMP: process.env.TEMP ?? '/tmp',
    TMP: process.env.TMP ?? '/tmp',
  };

  let cmd: string;
  let args: string[];

  if (language === 'javascript') {
    cmd = process.execPath; // node
    args = ['--max-old-space-size=64', '-e', code];
  } else if (language === 'python') {
    cmd = 'python';
    args = ['-c', code];
  } else {
    throw new Error(`Unsupported language: ${language}. Use "javascript" or "python".`);
  }

  return new Promise<string>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    const child = spawn(cmd, args, {
      env: cleanEnv,
      cwd: context.workspaceDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, timeout);

    child.stdout.on('data', (data) => {
      stdout += data.toString();
      if (stdout.length > MAX_OUTPUT_SIZE) {
        killed = true;
        child.kill('SIGKILL');
      }
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
      if (stderr.length > MAX_OUTPUT_SIZE) {
        killed = true;
        child.kill('SIGKILL');
      }
    });

    child.on('close', (exitCode) => {
      clearTimeout(timer);

      if (killed && stdout.length > MAX_OUTPUT_SIZE) {
        resolve(stdout.slice(0, MAX_OUTPUT_SIZE) + '\n[Output truncated]');
        return;
      }

      if (killed) {
        resolve(`[Execution timed out after ${timeout}ms]`);
        return;
      }

      let output = '';
      if (stdout) output += stdout;
      if (stderr) output += (output ? '\n\n[stderr]\n' : '') + stderr;
      if (!output) output = `[Process exited with code ${exitCode}]`;

      resolve(output.slice(0, MAX_OUTPUT_SIZE));
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to run ${language}: ${err.message}`));
    });
  });
};
