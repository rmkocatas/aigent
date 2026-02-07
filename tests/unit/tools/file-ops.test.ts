import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileHandler, writeFileHandler } from '../../../src/core/tools/builtins/file-ops.js';
import {
  projectReadFileHandler,
  projectWriteFileHandler,
} from '../../../src/core/tools/builtins/project-file-ops.js';
import type { ToolContext } from '../../../src/core/tools/registry.js';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

let workspaceDir: string;
let context: ToolContext;

beforeEach(async () => {
  workspaceDir = await mkdtemp(join(tmpdir(), 'openclaw-test-'));
  context = {
    workspaceDir,
    memoryDir: join(workspaceDir, 'memory'),
    conversationId: 'test',
    userId: 'test-user',
    maxExecutionMs: 5000,
  };
});

afterEach(async () => {
  await rm(workspaceDir, { recursive: true, force: true });
});

describe('write_file tool', () => {
  it('writes a file to workspace', async () => {
    const result = await writeFileHandler(
      { path: 'test.txt', content: 'hello world' },
      context,
    );
    expect(result).toContain('File written');
    expect(result).toContain('11 bytes');
  });

  it('creates parent directories', async () => {
    const result = await writeFileHandler(
      { path: 'subdir/nested/file.txt', content: 'nested' },
      context,
    );
    expect(result).toContain('File written');
  });

  it('rejects absolute paths', async () => {
    await expect(
      writeFileHandler({ path: '/etc/passwd', content: 'bad' }, context),
    ).rejects.toThrow('Absolute paths');
  });

  it('rejects path traversal', async () => {
    await expect(
      writeFileHandler({ path: '../../../etc/passwd', content: 'bad' }, context),
    ).rejects.toThrow('traversal');
  });
});

describe('read_file tool', () => {
  it('reads a file from workspace', async () => {
    await writeFileHandler({ path: 'data.txt', content: 'file content' }, context);
    const result = await readFileHandler({ path: 'data.txt' }, context);
    expect(result).toBe('file content');
  });

  it('throws for non-existent file', async () => {
    await expect(
      readFileHandler({ path: 'missing.txt' }, context),
    ).rejects.toThrow('File not found');
  });

  it('rejects path traversal', async () => {
    await expect(
      readFileHandler({ path: '../../secret.txt' }, context),
    ).rejects.toThrow('traversal');
  });
});

// ============================================================
// Project file operations
// ============================================================

describe('project_read_file tool', () => {
  let projectDir: string;
  let projectContext: ToolContext;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'openclaw-project-'));
    projectContext = {
      ...context,
      allowedProjectDirs: [projectDir],
    };
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('reads a file from an allowed project directory', async () => {
    const filePath = join(projectDir, 'readme.txt');
    await projectWriteFileHandler(
      { path: filePath, content: 'project content' },
      projectContext,
    );

    const result = await projectReadFileHandler(
      { path: filePath },
      projectContext,
    );
    expect(result).toBe('project content');
  });

  it('rejects a path outside allowed project directories', async () => {
    const outsidePath = resolve(projectDir, '..', 'outside.txt');
    await expect(
      projectReadFileHandler({ path: outsidePath }, projectContext),
    ).rejects.toThrow('not within any allowed project directory');
  });

  it('rejects path traversal with ".."', async () => {
    // Use string concatenation to preserve ".." (join resolves it away)
    const traversalPath = projectDir + '/subdir/../../../etc/passwd';
    await expect(
      projectReadFileHandler({ path: traversalPath }, projectContext),
    ).rejects.toThrow('Path traversal');
  });

  it('rejects when no allowed dirs are configured', async () => {
    const emptyContext: ToolContext = {
      ...context,
      allowedProjectDirs: [],
    };
    await expect(
      projectReadFileHandler(
        { path: join(projectDir, 'file.txt') },
        emptyContext,
      ),
    ).rejects.toThrow('No project directories are configured');
  });
});

describe('project_write_file tool', () => {
  let projectDir: string;
  let projectContext: ToolContext;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'openclaw-project-'));
    projectContext = {
      ...context,
      allowedProjectDirs: [projectDir],
    };
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('writes a file to an allowed project directory', async () => {
    const filePath = join(projectDir, 'output.txt');
    const result = await projectWriteFileHandler(
      { path: filePath, content: 'written content' },
      projectContext,
    );
    expect(result).toContain('File written');
    expect(result).toContain('15 bytes');

    // Verify the file was actually written
    const content = await readFile(filePath, 'utf-8');
    expect(content).toBe('written content');
  });

  it('rejects a path outside allowed project directories', async () => {
    const outsidePath = resolve(projectDir, '..', 'outside.txt');
    await expect(
      projectWriteFileHandler(
        { path: outsidePath, content: 'bad' },
        projectContext,
      ),
    ).rejects.toThrow('not within any allowed project directory');
  });

  it('rejects dotfiles like .env', async () => {
    const envPath = join(projectDir, '.env');
    await expect(
      projectWriteFileHandler(
        { path: envPath, content: 'SECRET=bad' },
        projectContext,
      ),
    ).rejects.toThrow('not allowed for security');
  });

  it('rejects writing to .git directory', async () => {
    const gitPath = join(projectDir, '.git', 'config');
    await expect(
      projectWriteFileHandler(
        { path: gitPath, content: 'bad config' },
        projectContext,
      ),
    ).rejects.toThrow('not allowed for security');
  });

  it('creates parent directories when writing', async () => {
    const nestedPath = join(projectDir, 'deep', 'nested', 'dir', 'file.txt');
    const result = await projectWriteFileHandler(
      { path: nestedPath, content: 'deep content' },
      projectContext,
    );
    expect(result).toContain('File written');

    const content = await readFile(nestedPath, 'utf-8');
    expect(content).toBe('deep content');
  });

  it('rejects path traversal with ".."', async () => {
    // Use string concatenation to preserve ".." (join resolves it away)
    const traversalPath = projectDir + '/subdir/../../../escape.txt';
    await expect(
      projectWriteFileHandler(
        { path: traversalPath, content: 'bad' },
        projectContext,
      ),
    ).rejects.toThrow('Path traversal');
  });

  it('rejects content exceeding 1MB', async () => {
    const filePath = join(projectDir, 'big.txt');
    const bigContent = 'x'.repeat(1024 * 1024 + 1);
    await expect(
      projectWriteFileHandler(
        { path: filePath, content: bigContent },
        projectContext,
      ),
    ).rejects.toThrow('exceeds maximum file size');
  });
});
