// ============================================================
// OpenClaw Deploy — File Permission Utilities
// ============================================================

import { chmod, stat, readdir } from 'node:fs/promises';
import { platform } from 'node:os';
import { join } from 'node:path';
import type { SecurityLevel } from '../../types/index.js';
import { getSecurityLevel } from './levels.js';

export function isWindows(): boolean {
  return platform() === 'win32';
}

export async function setSecurePermissions(
  dirPath: string,
  securityLevel: SecurityLevel,
): Promise<void> {
  if (isWindows()) {
    return;
  }

  const levelDef = getSecurityLevel(securityLevel);
  const dirMode = parseInt(levelDef.filePermissions.directory, 8);
  const fileMode = parseInt(levelDef.filePermissions.config, 8);

  await chmod(dirPath, dirMode);

  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && (entry.name.endsWith('.json') || entry.name.endsWith('.env'))) {
      await chmod(join(dirPath, entry.name), fileMode);
    }
  }
}

export async function verifyPermissions(
  dirPath: string,
): Promise<{ valid: boolean; issues: string[] }> {
  const issues: string[] = [];

  if (isWindows()) {
    return { valid: true, issues };
  }

  try {
    const dirStat = await stat(dirPath);
    const dirMode = dirStat.mode & 0o777;
    if (dirMode !== 0o700) {
      issues.push(
        `Directory ${dirPath} has mode ${dirMode.toString(8)}, expected 700`,
      );
    }

    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.json') || entry.name.endsWith('.env'))) {
        const filePath = join(dirPath, entry.name);
        const fileStat = await stat(filePath);
        const fileMode = fileStat.mode & 0o777;
        if (fileMode !== 0o600) {
          issues.push(
            `File ${filePath} has mode ${fileMode.toString(8)}, expected 600`,
          );
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    issues.push(`Failed to verify permissions: ${message}`);
  }

  return { valid: issues.length === 0, issues };
}
