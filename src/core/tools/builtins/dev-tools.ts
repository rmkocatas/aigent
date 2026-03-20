// ============================================================
// OpenClaw Deploy — Developer Tools
// ============================================================
//
// Provides:
//   - git_diff_review: Review git changes in a project directory
//   - dep_audit: Check package.json for known vulnerabilities
//   - generate_tests: Generate test stubs for a source file
// ============================================================

import { readFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const MAX_DIFF_SIZE = 30_000;
const MAX_FILE_SIZE = 50_000;

// ---------------------------------------------------------------------------
// Path validation (reusable)
// ---------------------------------------------------------------------------

function validateProjectPath(path: string, allowedDirs: string[]): string {
  if (!path) throw new Error('Missing path');
  const resolved = resolve(path);
  const allowed = allowedDirs.some((dir) => resolved.startsWith(resolve(dir)));
  if (!allowed) throw new Error(`Path not in allowed directories: ${path}`);
  return resolved;
}

// ---------------------------------------------------------------------------
// git_diff_review: Review git changes
// ---------------------------------------------------------------------------

export const gitDiffReviewDefinition: ToolDefinition = {
  name: 'git_diff_review',
  description:
    'Get the git diff for a project directory. Shows staged and unstaged changes. ' +
    'The LLM can then review the code changes and provide feedback.',
  parameters: {
    type: 'object',
    properties: {
      project_path: {
        type: 'string',
        description: 'Path to the git repository (must be in allowed project dirs)',
      },
      staged_only: {
        type: 'boolean',
        description: 'Only show staged changes (default: false, shows all)',
      },
    },
    required: ['project_path'],
  },
  routing: {
    useWhen: ['User asks to review code changes or git diff', 'User wants a code review of their work'],
    avoidWhen: ['User wants to commit (they should use git directly)', 'User asks about git concepts'],
  },
};

export const gitDiffReviewHandler: ToolHandler = async (input, context) => {
  const projectPath = input.project_path as string;
  const stagedOnly = input.staged_only as boolean ?? false;
  const allowedDirs = context.allowedProjectDirs ?? [];

  const validPath = validateProjectPath(projectPath, allowedDirs);

  try {
    // Get git status
    const { stdout: statusOut } = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: validPath,
      timeout: 10_000,
    });

    if (!statusOut.trim()) {
      return 'No changes detected in this repository.';
    }

    // Get diff
    const diffArgs = stagedOnly ? ['diff', '--staged'] : ['diff', 'HEAD'];
    let diffOut: string;
    try {
      const result = await execFileAsync('git', diffArgs, {
        cwd: validPath,
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      });
      diffOut = result.stdout;
    } catch {
      // HEAD may not exist (new repo) — try plain diff
      const result = await execFileAsync('git', ['diff'], {
        cwd: validPath,
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      });
      diffOut = result.stdout;
    }

    // Get recent log for context
    let logOut = '';
    try {
      const result = await execFileAsync('git', ['log', '--oneline', '-5'], {
        cwd: validPath,
        timeout: 5_000,
      });
      logOut = result.stdout;
    } catch { /* ignore */ }

    let output = `Git Status:\n${statusOut}\n`;
    if (logOut) output += `\nRecent commits:\n${logOut}\n`;
    output += `\nDiff:\n${diffOut}`;

    if (output.length > MAX_DIFF_SIZE) {
      output = output.slice(0, MAX_DIFF_SIZE) +
        '\n\n[Diff truncated at 30KB. Review in smaller chunks.]';
    }

    return `Please review these code changes and provide feedback on:\n` +
      `- Code quality and potential bugs\n` +
      `- Security concerns\n` +
      `- Suggestions for improvement\n\n` +
      `---\n${output}`;
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('not a git repository')) {
      throw new Error(`${projectPath} is not a git repository`);
    }
    throw err;
  }
};

// ---------------------------------------------------------------------------
// dep_audit: Check for vulnerable dependencies
// ---------------------------------------------------------------------------

export const depAuditDefinition: ToolDefinition = {
  name: 'dep_audit',
  description:
    'Audit npm dependencies in a project for known vulnerabilities. ' +
    'Reads package.json and runs npm audit.',
  parameters: {
    type: 'object',
    properties: {
      project_path: {
        type: 'string',
        description: 'Path to the project with package.json',
      },
    },
    required: ['project_path'],
  },
  routing: {
    useWhen: ['User asks to check dependencies for vulnerabilities', 'User wants a security audit of their project'],
    avoidWhen: ['User wants to install packages (use install_package)'],
  },
};

export const depAuditHandler: ToolHandler = async (input, context) => {
  const projectPath = input.project_path as string;
  const allowedDirs = context.allowedProjectDirs ?? [];

  const validPath = validateProjectPath(projectPath, allowedDirs);

  // Read package.json
  let pkgJson: string;
  try {
    pkgJson = await readFile(join(validPath, 'package.json'), 'utf-8');
  } catch {
    throw new Error('No package.json found in the specified directory');
  }

  const pkg = JSON.parse(pkgJson) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  const depCount = Object.keys(pkg.dependencies ?? {}).length;
  const devDepCount = Object.keys(pkg.devDependencies ?? {}).length;

  // Run npm audit
  let auditOutput = '';
  try {
    const { stdout } = await execFileAsync('npm', ['audit', '--json'], {
      cwd: validPath,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    auditOutput = stdout;
  } catch (err) {
    // npm audit exits with non-zero if vulnerabilities found
    const execErr = err as { stdout?: string; stderr?: string };
    auditOutput = execErr.stdout ?? '';
    if (!auditOutput) {
      return `Dependencies: ${depCount} prod, ${devDepCount} dev.\n` +
        `npm audit failed. Check if node_modules exists (run npm install first).`;
    }
  }

  try {
    const auditData = JSON.parse(auditOutput) as {
      vulnerabilities?: Record<string, { severity: string; via: unknown[] }>;
      metadata?: { vulnerabilities: Record<string, number> };
    };

    const vulns = auditData.metadata?.vulnerabilities ?? {};
    const total = Object.values(vulns).reduce((a, b) => a + b, 0);

    let summary = `Dependencies: ${depCount} prod, ${devDepCount} dev\n`;
    summary += `Vulnerabilities: ${total} total`;

    if (total > 0) {
      summary += ` (${vulns.critical ?? 0} critical, ${vulns.high ?? 0} high, ` +
        `${vulns.moderate ?? 0} moderate, ${vulns.low ?? 0} low)`;

      // List vulnerable packages
      if (auditData.vulnerabilities) {
        summary += '\n\nAffected packages:\n';
        for (const [name, info] of Object.entries(auditData.vulnerabilities).slice(0, 20)) {
          summary += `- ${name} (${info.severity})\n`;
        }
      }
    } else {
      summary += ' — all clear!';
    }

    return summary;
  } catch {
    // Non-JSON output
    return `Dependencies: ${depCount} prod, ${devDepCount} dev.\n\n` +
      `Audit output:\n${auditOutput.slice(0, 5000)}`;
  }
};

// ---------------------------------------------------------------------------
// generate_tests: Generate test stubs for a file
// ---------------------------------------------------------------------------

export const generateTestsDefinition: ToolDefinition = {
  name: 'generate_tests',
  description:
    'Read a source file and generate test stubs/skeletons. ' +
    'Returns the file content with instructions for the LLM to write tests.',
  parameters: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Path to the source file to generate tests for',
      },
      framework: {
        type: 'string',
        description: 'Test framework to use: "jest", "vitest", "mocha", or "auto" (detect from package.json)',
        enum: ['jest', 'vitest', 'mocha', 'auto'],
      },
    },
    required: ['file_path'],
  },
  routing: {
    useWhen: ['User asks to generate tests for a file', 'User wants test coverage for their code'],
    avoidWhen: ['User wants to run existing tests', 'User is asking about testing concepts'],
  },
};

export const generateTestsHandler: ToolHandler = async (input, context) => {
  const filePath = input.file_path as string;
  const framework = (input.framework as string) || 'auto';
  const allowedDirs = context.allowedProjectDirs ?? [];

  const resolvedPath = resolve(filePath);
  const allowed = allowedDirs.some((dir) => resolvedPath.startsWith(resolve(dir)));
  if (!allowed) throw new Error('File not in allowed directories');

  let content: string;
  try {
    content = await readFile(resolvedPath, 'utf-8');
  } catch {
    throw new Error(`Cannot read file: ${filePath}`);
  }

  if (content.length > MAX_FILE_SIZE) {
    content = content.slice(0, MAX_FILE_SIZE) + '\n// [File truncated]';
  }

  const ext = extname(filePath);

  // Auto-detect framework by checking for package.json in parent dirs
  let detectedFramework = framework;
  if (framework === 'auto') {
    detectedFramework = 'vitest'; // default
    try {
      // Walk up looking for package.json
      let dir = join(resolvedPath, '..');
      for (let i = 0; i < 5; i++) {
        try {
          const pkg = await readFile(join(dir, 'package.json'), 'utf-8');
          if (pkg.includes('"vitest"')) { detectedFramework = 'vitest'; break; }
          if (pkg.includes('"jest"')) { detectedFramework = 'jest'; break; }
          if (pkg.includes('"mocha"')) { detectedFramework = 'mocha'; break; }
        } catch { /* continue */ }
        dir = join(dir, '..');
      }
    } catch { /* use default */ }
  }

  return (
    `Please generate comprehensive unit tests for this file using ${detectedFramework}.\n` +
    `File: ${filePath}\n` +
    `Language: ${ext.replace('.', '')}\n\n` +
    `Guidelines:\n` +
    `- Test all exported functions/classes\n` +
    `- Include edge cases and error scenarios\n` +
    `- Use descriptive test names\n` +
    `- Mock external dependencies\n\n` +
    `Source code:\n\`\`\`${ext.replace('.', '')}\n${content}\n\`\`\``
  );
};
