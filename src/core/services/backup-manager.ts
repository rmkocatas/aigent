// ============================================================
// OpenClaw Deploy — Backup Manager
// ============================================================
//
// Automatically backs up critical data directories on a
// configurable interval. Retention pruning removes old backups.
//
// Backup layout: backups/{yyyy-mm-ddTHH-mm-ss}/
//   memory/        — semantic memory
//   knowledge/     — web clips, read-later
//   notes/         — user notes
//   reminders/     — pending reminders
//   triggers/      — scheduled triggers
//   autonomous/    — task state + audit
//   openclaw.json  — config
//   metadata.json  — backup metadata
//
// Registry: backups/registry.json (last 30 entries)
// ============================================================

import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import type { BackupConfig, BackupMetadata } from '../../types/index.js';

const CRITICAL_DIRS = ['memory', 'reminders', 'autonomous', 'knowledge', 'notes', 'triggers'];
const CRITICAL_FILES = ['openclaw.json'];

export type BackupAlertFn = (status: 'failed' | 'partial', errors: string[]) => void;

export class BackupManager {
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastBackup: BackupMetadata | null = null;
  private alertFn: BackupAlertFn | null = null;

  private readonly backupsDir: string;
  private readonly registryPath: string;

  constructor(
    private readonly config: BackupConfig,
    private readonly baseDir: string,
  ) {
    this.backupsDir = join(baseDir, 'backups');
    this.registryPath = join(this.backupsDir, 'registry.json');
  }

  setAlertFn(fn: BackupAlertFn): void {
    this.alertFn = fn;
  }

  start(): void {
    if (!this.config.enabled || this.interval) return;

    this.interval = setInterval(
      () => { void this.runBackup(); },
      this.config.intervalMs,
    );
    this.interval.unref();

    const hours = Math.round(this.config.intervalMs / 3600000);
    console.log(`[backup] Backup manager started (every ${hours}h, retain ${this.config.retentionDays}d)`);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  getLastBackup(): BackupMetadata | null {
    return this.lastBackup;
  }

  async getBackupHistory(): Promise<BackupMetadata[]> {
    try {
      const content = await fs.readFile(this.registryPath, 'utf-8');
      return JSON.parse(content) as BackupMetadata[];
    } catch {
      return [];
    }
  }

  // ------------------------------------------------------------------
  // Run backup
  // ------------------------------------------------------------------

  async runBackup(): Promise<BackupMetadata> {
    const startTime = Date.now();
    const ts = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const backupDir = join(this.backupsDir, ts);
    const errors: string[] = [];
    const copiedDirs: string[] = [];

    try {
      await fs.mkdir(backupDir, { recursive: true });

      // Critical directories (skip silently if they don't exist yet)
      for (const dir of CRITICAL_DIRS) {
        const src = join(this.baseDir, dir);
        const dest = join(backupDir, dir);
        try {
          await fs.access(src);
          await fs.cp(src, dest, { recursive: true });
          copiedDirs.push(dir);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            // Directory doesn't exist yet — not an error, just unused
            continue;
          }
          errors.push(`${dir}: ${(err as Error).message}`);
        }
      }

      // Critical files
      for (const file of CRITICAL_FILES) {
        const src = join(this.baseDir, file);
        const dest = join(backupDir, file);
        try {
          await fs.copyFile(src, dest);
          copiedDirs.push(file);
        } catch (err) {
          errors.push(`${file}: ${(err as Error).message}`);
        }
      }

      // Optional directories
      if (this.config.includeSessions) {
        await this.copyOptional('sessions', backupDir, copiedDirs);
      }
      if (this.config.includeCache) {
        await this.copyOptional('cache', backupDir, copiedDirs);
      }

      const totalSize = await this.getDirSize(backupDir);

      const metadata: BackupMetadata = {
        id: ts,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        totalSizeBytes: totalSize,
        dirs: copiedDirs,
        status: errors.length === 0 ? 'success' : (copiedDirs.length > 0 ? 'partial' : 'failed'),
        errors,
      };

      // Write metadata inside backup
      await fs.writeFile(join(backupDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8');

      // Update central registry
      await this.updateRegistry(metadata);

      // Prune old backups
      await this.pruneOldBackups();

      this.lastBackup = metadata;

      if (metadata.status === 'success') {
        console.log(`[backup] Completed: ${formatBytes(totalSize)} in ${metadata.durationMs}ms`);
      } else {
        console.warn(`[backup] Completed with ${errors.length} error(s): ${errors.join('; ')}`);
        if (this.alertFn) {
          this.alertFn(metadata.status as 'failed' | 'partial', errors);
        }
      }

      return metadata;
    } catch (err) {
      const metadata: BackupMetadata = {
        id: ts,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        totalSizeBytes: 0,
        dirs: copiedDirs,
        status: 'failed',
        errors: [...errors, (err as Error).message],
      };

      this.lastBackup = metadata;
      console.error('[backup] Failed:', (err as Error).message);

      if (this.alertFn) {
        this.alertFn('failed', metadata.errors);
      }

      return metadata;
    }
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private async copyOptional(dir: string, backupDir: string, copiedDirs: string[]): Promise<void> {
    const src = join(this.baseDir, dir);
    const dest = join(backupDir, dir);
    try {
      await fs.access(src);
      await fs.cp(src, dest, { recursive: true });
      copiedDirs.push(dir);
    } catch {
      // Optional — silently skip
    }
  }

  private async updateRegistry(metadata: BackupMetadata): Promise<void> {
    let registry: BackupMetadata[] = [];
    try {
      const content = await fs.readFile(this.registryPath, 'utf-8');
      registry = JSON.parse(content) as BackupMetadata[];
    } catch {
      // No registry yet
    }

    registry.push(metadata);
    if (registry.length > 30) {
      registry = registry.slice(-30);
    }

    await fs.mkdir(dirname(this.registryPath), { recursive: true });
    await fs.writeFile(this.registryPath, JSON.stringify(registry, null, 2), 'utf-8');
  }

  private async pruneOldBackups(): Promise<void> {
    const cutoff = Date.now() - (this.config.retentionDays * 24 * 60 * 60 * 1000);

    try {
      const entries = await fs.readdir(this.backupsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const metaPath = join(this.backupsDir, entry.name, 'metadata.json');
        try {
          const raw = await fs.readFile(metaPath, 'utf-8');
          const meta = JSON.parse(raw) as BackupMetadata;
          if (new Date(meta.timestamp).getTime() < cutoff) {
            await fs.rm(join(this.backupsDir, entry.name), { recursive: true });
            console.log(`[backup] Pruned: ${entry.name}`);
          }
        } catch {
          // No metadata — check dir stat instead
          try {
            const stat = await fs.stat(join(this.backupsDir, entry.name));
            if (stat.mtimeMs < cutoff) {
              await fs.rm(join(this.backupsDir, entry.name), { recursive: true });
              console.log(`[backup] Pruned (no metadata): ${entry.name}`);
            }
          } catch {
            // Skip
          }
        }
      }
    } catch {
      // No backups dir yet
    }
  }

  private async getDirSize(dirPath: string): Promise<number> {
    let total = 0;
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);
        if (entry.isDirectory()) {
          total += await this.getDirSize(fullPath);
        } else {
          const stat = await fs.stat(fullPath);
          total += stat.size;
        }
      }
    } catch {
      // Ignore
    }
    return total;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
