// ============================================================
// OpenClaw Deploy — System Monitoring & Backup Tools
// ============================================================

import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';
import type { SystemMonitor } from '../../services/system-monitor.js';
import type { BackupManager } from '../../services/backup-manager.js';

let monitorRef: SystemMonitor | null = null;
let backupRef: BackupManager | null = null;

export function setSystemServices(monitor: SystemMonitor, backup: BackupManager): void {
  monitorRef = monitor;
  backupRef = backup;
}

// ---- system_status ----

export const systemStatusDefinition: ToolDefinition = {
  name: 'system_status',
  description: 'Get current system health: uptime, disk usage per data directory, memory sizes, cache stats, last backup info, and recent alerts.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  routing: {
    useWhen: ['user asks about system health, disk usage, backup status, or recent errors'],
    avoidWhen: [],
  },
};

export const systemStatusHandler: ToolHandler = async () => {
  if (!monitorRef) {
    return 'System monitoring is not enabled.';
  }

  const metrics = monitorRef.getStatus();
  const lastBackup = backupRef?.getLastBackup() ?? null;
  const alerts = monitorRef.getRecentAlerts(5);

  if (!metrics) {
    return 'No metrics collected yet. Check back in a minute.';
  }

  const lines: string[] = [];

  // Uptime
  const h = Math.floor(metrics.uptime / 3600);
  const m = Math.floor((metrics.uptime % 3600) / 60);
  lines.push(`System Status`);
  lines.push(`Uptime: ${h}h ${m}m`);
  lines.push(`Active sessions: ${metrics.sessionCount}`);

  // Cache
  if (metrics.cacheEntryCount > 0) {
    lines.push(`Cache: ${metrics.cacheEntryCount} entries (${formatBytes(metrics.cacheSizeBytes)})`);
  }

  // Disk usage
  lines.push('\nDisk Usage:');
  let totalBytes = 0;
  for (const [dir, bytes] of Object.entries(metrics.diskUsage)) {
    if (bytes > 0) {
      lines.push(`  ${dir}: ${formatBytes(bytes)}`);
      totalBytes += bytes;
    }
  }
  lines.push(`  TOTAL: ${formatBytes(totalBytes)}`);

  // Memory layers
  const memEntries = Object.entries(metrics.memorySizes);
  if (memEntries.length > 0) {
    lines.push('\nMemory Layers:');
    for (const [key, bytes] of memEntries) {
      lines.push(`  ${key}: ${formatBytes(bytes)}`);
    }
  }

  // Last backup
  if (lastBackup) {
    const ago = Math.round((Date.now() - new Date(lastBackup.timestamp).getTime()) / 60000);
    lines.push(`\nLast Backup: ${ago}min ago (${lastBackup.status})`);
    lines.push(`  Size: ${formatBytes(lastBackup.totalSizeBytes)}, Duration: ${lastBackup.durationMs}ms`);
    lines.push(`  Backed up: ${lastBackup.dirs.join(', ')}`);
    if (lastBackup.errors.length > 0) {
      lines.push(`  Errors: ${lastBackup.errors.join('; ')}`);
    }
  } else {
    lines.push('\nNo backups yet.');
  }

  // Alerts
  if (alerts.length > 0) {
    lines.push(`\nRecent Alerts (${alerts.length}):`);
    for (const a of alerts) {
      lines.push(`  [${a.level}] ${a.message}`);
    }
  } else {
    lines.push('\nNo recent alerts.');
  }

  return lines.join('\n');
};

// ---- system_backup ----

export const systemBackupDefinition: ToolDefinition = {
  name: 'system_backup',
  description: 'Trigger a manual backup of all critical data (memory, notes, knowledge, reminders, triggers, autonomous, config).',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  routing: {
    useWhen: ['user explicitly requests a backup or asks to back up data'],
    avoidWhen: [],
  },
};

export const systemBackupHandler: ToolHandler = async () => {
  if (!backupRef) {
    return 'Backup manager is not enabled.';
  }

  const result = await backupRef.runBackup();

  if (result.status === 'success') {
    return [
      `Backup completed successfully.`,
      `Size: ${formatBytes(result.totalSizeBytes)}`,
      `Duration: ${result.durationMs}ms`,
      `Backed up: ${result.dirs.join(', ')}`,
    ].join('\n');
  } else if (result.status === 'partial') {
    return [
      `Backup completed with errors.`,
      `Size: ${formatBytes(result.totalSizeBytes)}`,
      `Backed up: ${result.dirs.join(', ')}`,
      `Errors: ${result.errors.join('; ')}`,
    ].join('\n');
  } else {
    return `Backup failed: ${result.errors.join('; ')}`;
  }
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
