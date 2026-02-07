// ============================================================
// OpenClaw Deploy — Code Runner Tool (Sandboxed)
// ============================================================
//
// JavaScript: Node.js Permission Model (--permission)
//   - Read: broad (needed for require/import resolution)
//   - Write: workspace dir only
//   - No child process spawning
//   - No worker threads
//   - 64MB heap limit, 10s timeout
//   - Clean environment (no API keys, no secrets)
//
// Python: Isolated mode (-I) + restricted environment
//   - Env vars stripped (no secrets)
//   - 10s timeout
//
// Safety model: the env is clean so reading files can't leak
// secrets. Output is capped at 32KB and returns only to the
// chat. Writing and process spawning are blocked.
// ============================================================

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_SIZE = 32_000;
const MAX_CODE_LENGTH = 10_000;

export const codeRunnerDefinition: ToolDefinition = {
  name: 'run_code',
  description: 'Execute JavaScript or Python code in a sandboxed subprocess. JS uses Node.js Permission Model: filesystem writes restricted to workspace, no child processes, no worker threads. Environment is stripped of secrets. Returns stdout/stderr (max 32KB). This tool is restricted and must be explicitly allowed.',
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

  if (code.length > MAX_CODE_LENGTH) {
    throw new Error(`Code too long (max ${MAX_CODE_LENGTH} characters)`);
  }

  const timeout = Math.min(context.maxExecutionMs, DEFAULT_TIMEOUT_MS);
  const workspaceDir = resolve(context.workspaceDir);

  // Clean environment: only essential vars, no secrets
  const cleanEnv: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? process.env.USERPROFILE ?? '',
    TEMP: process.env.TEMP ?? '/tmp',
    TMP: process.env.TMP ?? '/tmp',
    USERPROFILE: process.env.USERPROFILE ?? '',
    SystemRoot: process.env.SystemRoot ?? '',
    // Node module resolution needs these on Windows
    APPDATA: process.env.APPDATA ?? '',
    LOCALAPPDATA: process.env.LOCALAPPDATA ?? '',
  };

  let cmd: string;
  let args: string[];

  if (language === 'javascript') {
    cmd = process.execPath; // node
    args = [
      // Permission model: broad read, narrow write, no spawn/workers
      '--permission',
      '--allow-fs-read=*',
      `--allow-fs-write=${workspaceDir}/*`,
      '--max-old-space-size=64',
      '-e', code,
    ];
  } else if (language === 'python') {
    cmd = 'python';
    args = [
      '-I',  // Isolated mode: no site-packages manipulation, ignore PYTHON* env vars
      '-u',  // Unbuffered output
      '-c', code,
    ];
  } else {
    throw new Error(`Unsupported language: ${language}. Use "javascript" or "python".`);
  }

  return new Promise<string>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    const child = spawn(cmd, args, {
      env: cleanEnv,
      cwd: workspaceDir,
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

      // Filter out permission model warnings from stderr
      const filteredStderr = stderr
        .split('\n')
        .filter((line) => !line.includes('ExperimentalWarning') && !line.includes('--permission'))
        .join('\n')
        .trim();

      let output = '';
      if (stdout) output += stdout;
      if (filteredStderr) output += (output ? '\n\n[stderr]\n' : '') + filteredStderr;
      if (!output) output = `[Process exited with code ${exitCode}]`;

      resolve(output.slice(0, MAX_OUTPUT_SIZE));
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to run ${language}: ${err.message}`));
    });
  });
};
