// ============================================================
// OpenClaw Deploy — Project File Operations Tools (Wider Sandbox)
// ============================================================

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, normalize, dirname } from 'node:path';
import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

const MAX_FILE_SIZE = 1024 * 1024; // 1MB

// Hidden file/directory patterns that are blocked for writes
const BLOCKED_DOTFILE_PATTERNS = [
  '.git',
  '.env',
  '.ssh',
  '.gnupg',
  '.npmrc',
  '.docker',
  '.kube',
  '.aws',
  '.config',
];

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export const projectReadFileDefinition: ToolDefinition = {
  name: 'project_read_file',
  description: 'Read a file from an allowed project directory. No approval needed.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute file path within an allowed project directory',
      },
    },
    required: ['path'],
  },
};

export const projectWriteFileDefinition: ToolDefinition = {
  name: 'project_write_file',
  description: 'Write a file to an allowed project directory.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute file path within an allowed project directory',
      },
      content: {
        type: 'string',
        description: 'File content to write',
      },
    },
    required: ['path', 'content'],
  },
};

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateProjectPath(
  filePath: string,
  allowedDirs: string[],
): string {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Missing file path');
  }

  // Block path traversal — check the raw input for ".." before normalization
  // (normalize on some platforms resolves ".." which would bypass this check)
  if (filePath.includes('..')) {
    throw new Error('Path traversal (..) is not allowed.');
  }

  // Normalize and resolve to an absolute path
  const normalized = normalize(filePath);
  const absolute = resolve(normalized);

  if (!allowedDirs || allowedDirs.length === 0) {
    throw new Error('No project directories are configured. Set allowedProjectDirs in your config.');
  }

  // Check the resolved path is within at least one allowed directory
  const isAllowed = allowedDirs.some((dir) => {
    const resolvedDir = resolve(normalize(dir));
    // Path must start with the allowed dir followed by a separator (or be the dir itself)
    return absolute === resolvedDir || absolute.startsWith(resolvedDir + '/') || absolute.startsWith(resolvedDir + '\\');
  });

  if (!isAllowed) {
    throw new Error(
      `Path "${filePath}" is not within any allowed project directory.`,
    );
  }

  return absolute;
}

function checkBlockedDotfile(filePath: string): void {
  // Check each segment of the path for blocked dotfile patterns
  const normalized = normalize(filePath);
  const segments = normalized.split(/[\\/]/);

  for (const segment of segments) {
    if (!segment) continue;
    for (const pattern of BLOCKED_DOTFILE_PATTERNS) {
      if (segment === pattern || segment.startsWith(pattern + '/') || segment.startsWith(pattern + '\\')) {
        throw new Error(
          `Writing to dotfile/directory "${pattern}" is not allowed for security reasons.`,
        );
      }
    }
    // Also block any hidden directory/file starting with "." that isn't already caught
    if (segment.startsWith('.') && segment !== '.') {
      const base = segment.split(/[\\/]/)[0];
      if (BLOCKED_DOTFILE_PATTERNS.includes(base)) {
        throw new Error(
          `Writing to dotfile/directory "${base}" is not allowed for security reasons.`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const projectReadFileHandler: ToolHandler = async (input, context) => {
  const allowedDirs = context.allowedProjectDirs ?? [];
  const filePath = validateProjectPath(input.path as string, allowedDirs);

  try {
    // Check file size before reading
    const fileStat = await stat(filePath);
    if (fileStat.size > MAX_FILE_SIZE) {
      throw new Error(
        `File size (${fileStat.size} bytes) exceeds maximum allowed size (${MAX_FILE_SIZE} bytes).`,
      );
    }

    const content = await readFile(filePath, 'utf-8');
    return content;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`File not found: ${input.path}`);
    }
    throw err;
  }
};

export const projectWriteFileHandler: ToolHandler = async (input, context) => {
  const allowedDirs = context.allowedProjectDirs ?? [];
  const filePath = validateProjectPath(input.path as string, allowedDirs);
  const content = input.content as string;

  if (!content && content !== '') {
    throw new Error('Missing content');
  }

  if (content.length > MAX_FILE_SIZE) {
    throw new Error('Content exceeds maximum file size (1MB)');
  }

  // Check for blocked dotfiles in the path
  checkBlockedDotfile(filePath);

  // Create parent directories if needed
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });

  await writeFile(filePath, content, 'utf-8');
  return `File written: ${input.path} (${content.length} bytes)`;
};
