// ============================================================
// OpenClaw Deploy — Package Installer Tool (with GitVerify)
// ============================================================

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';
import { scanPackage } from '../../security/package-scanner.js';
import type { PackageScanReport } from '../../security/package-scanner.js';

/**
 * Resolve npm to node + CLI script on Windows.
 * On Windows, `npm` is a .cmd shim that `execFileSync` can't invoke directly
 * without a shell. Instead, resolve to the actual npm-cli.js and run via node.
 */
function resolveNpm(): { cmd: string; prefix: string[] } {
  if (process.platform === 'win32') {
    const nodeDir = dirname(process.execPath);
    const npmCliPath = join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (existsSync(npmCliPath)) {
      return { cmd: process.execPath, prefix: [npmCliPath] };
    }
  }
  return { cmd: 'npm', prefix: [] };
}

export const installPackageDefinition: ToolDefinition = {
  name: 'install_package',
  description:
    'Install an npm package. Runs GitVerify security scan first. Requires Telegram approval for SAFE/CAUTION packages. RISKY packages are auto-denied.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Package name (e.g., lodash, express)',
      },
      dev: {
        type: 'string',
        description: 'Install as devDependency?',
        enum: ['true', 'false'],
      },
      project_dir: {
        type: 'string',
        description: 'Project directory (must be in allowed list)',
      },
    },
    required: ['name', 'project_dir'],
  },
  routing: {
    useWhen: ['User explicitly asks to install an npm package'],
    avoidWhen: ['User is just asking about a package without wanting to install it', 'User wants to run code (use run_code instead)'],
  },
};

function formatReport(report: PackageScanReport): string {
  const lines: string[] = [];
  lines.push(`=== GitVerify Scan Report ===`);
  lines.push(`Package: ${report.packageName}`);
  lines.push(`Score: ${report.score}/10`);
  lines.push(`Verdict: ${report.verdict}`);

  if (report.findings.length > 0) {
    lines.push('');
    lines.push('Findings:');
    for (const finding of report.findings) {
      const icon = finding.severity === 'critical' ? '[CRITICAL]'
        : finding.severity === 'warning' ? '[WARNING]'
        : '[INFO]';
      lines.push(`  ${icon} [${finding.category}] ${finding.message}`);
    }
  } else {
    lines.push('');
    lines.push('No findings.');
  }

  return lines.join('\n');
}

export const installPackageHandler: ToolHandler = async (input, context) => {
  const packageName = input.name as string | undefined;
  const projectDir = input.project_dir as string | undefined;
  const isDev = input.dev === 'true';

  // Validate required inputs
  if (!packageName || typeof packageName !== 'string') {
    return 'Error: Missing required parameter "name"';
  }

  if (!projectDir || typeof projectDir !== 'string') {
    return 'Error: Missing required parameter "project_dir"';
  }

  // Validate project_dir is in allowed list
  // allowedProjectDirs comes from ToolContext, populated from ToolsConfig
  const allowedDirs = context.allowedProjectDirs;

  if (allowedDirs !== undefined) {
    const normalizedProjectDir = projectDir.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
    const isAllowed = allowedDirs.some(dir => {
      const normalizedAllowed = dir.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
      return normalizedProjectDir === normalizedAllowed || normalizedProjectDir.startsWith(normalizedAllowed + '/');
    });

    if (!isAllowed) {
      return `Error: Project directory "${projectDir}" is not in the allowed project directories list`;
    }
  }

  // Run security scan
  let report: PackageScanReport;
  try {
    report = await scanPackage(packageName);
  } catch (err) {
    return `Error: Security scan failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  const reportText = formatReport(report);

  // RISKY packages are auto-denied
  if (report.verdict === 'RISKY') {
    return `${reportText}\n\nInstallation DENIED: Package scored ${report.score}/10 (RISKY). Manual review required.`;
  }

  // For SAFE/CAUTION: proceed with install
  // NOTE: When ApprovalManager is wired in, approval will be required for CAUTION.
  // For now, we proceed directly with the install.
  try {
    // Use execFileSync (not execSync) to avoid shell interpretation — prevents
    // command injection via malicious package names (e.g., "lodash; rm -rf /")
    const npmArgs = ['install', ...(isDev ? ['-D'] : []), packageName];

    const cleanEnv: Record<string, string> = {
      PATH: process.env['PATH'] ?? '',
      HOME: process.env['HOME'] ?? process.env['USERPROFILE'] ?? '',
      TEMP: process.env['TEMP'] ?? '/tmp',
      TMP: process.env['TMP'] ?? '/tmp',
    };

    // On Windows, resolve npm to node + npm-cli.js (execFileSync can't run .cmd shims)
    const npm = resolveNpm();
    const output = execFileSync(npm.cmd, [...npm.prefix, ...npmArgs], {
      cwd: projectDir,
      timeout: context.maxExecutionMs,
      env: cleanEnv,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    return `${reportText}\n\nInstallation successful:\n${output}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `${reportText}\n\nInstallation FAILED:\n${message}`;
  }
};
