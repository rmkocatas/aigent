// ============================================================
// OpenClaw Deploy — File Operations Tools (Sandboxed)
// ============================================================

import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { resolve, normalize, isAbsolute } from 'node:path';
import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

const MAX_FILE_SIZE = 1024 * 1024; // 1MB

export const readFileDefinition: ToolDefinition = {
  name: 'read_file',
  description: 'Read the contents of a file from the workspace. Paths are relative to the workspace root.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to the file within the workspace.',
      },
    },
    required: ['path'],
  },
  routing: {
    useWhen: ['User asks to read or view a file from the workspace'],
    avoidWhen: ['User wants to read a project file outside the workspace (use project_read_file instead)'],
  },
};

export const writeFileDefinition: ToolDefinition = {
  name: 'write_file',
  description: 'Write content to a file in the workspace. Creates parent directories if needed. Paths are relative to the workspace root.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to the file within the workspace.',
      },
      content: {
        type: 'string',
        description: 'The content to write to the file.',
      },
    },
    required: ['path', 'content'],
  },
  routing: {
    useWhen: ['User asks to save, create, or write a file in the workspace'],
    avoidWhen: ['User wants to write to a project directory (use project_write_file instead)'],
  },
};

async function validatePath(filePath: string, workspaceDir: string): Promise<string> {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Missing file path');
  }

  // Reject absolute paths
  if (isAbsolute(filePath)) {
    throw new Error('Absolute paths are not allowed. Use paths relative to the workspace.');
  }

  // Normalize and check for traversal
  const normalized = normalize(filePath);
  if (normalized.startsWith('..') || normalized.includes('..\\') || normalized.includes('../')) {
    throw new Error('Path traversal (.. components) is not allowed.');
  }

  const full = resolve(workspaceDir, normalized);

  // Ensure resolved path is within workspace
  const resolvedWorkspace = resolve(workspaceDir);
  if (!full.startsWith(resolvedWorkspace)) {
    throw new Error('Path resolves outside the workspace directory.');
  }

  // Resolve symlinks and re-validate to prevent symlink escapes
  try {
    const real = await realpath(full);
    if (!real.startsWith(resolvedWorkspace)) {
      throw new Error('Path resolves outside the workspace directory via symlink.');
    }
    return real;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return full; // File doesn't exist yet (write case) — string validation is sufficient
    }
    throw err;
  }
}

export const readFileHandler: ToolHandler = async (input, context) => {
  const filePath = await validatePath(input.path as string, context.workspaceDir);

  try {
    const content = await readFile(filePath, 'utf-8');
    if (content.length > MAX_FILE_SIZE) {
      return content.slice(0, MAX_FILE_SIZE) + '\n\n[Truncated — file exceeds 1MB]';
    }
    return content;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`File not found: ${input.path}`);
    }
    throw err;
  }
};

export const writeFileHandler: ToolHandler = async (input, context) => {
  const filePath = await validatePath(input.path as string, context.workspaceDir);
  const content = input.content as string;

  if (!content && content !== '') {
    throw new Error('Missing content');
  }

  if (content.length > MAX_FILE_SIZE) {
    throw new Error('Content exceeds maximum file size (1MB)');
  }

  // Create parent directories
  const dir = filePath.replace(/[\\/][^\\/]+$/, '');
  await mkdir(dir, { recursive: true });

  await writeFile(filePath, content, 'utf-8');
  return `File written: ${input.path} (${content.length} bytes)`;
};
