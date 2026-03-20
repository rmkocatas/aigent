// ============================================================
// OpenClaw Deploy — System Monitor
// ============================================================
//
// Collects system metrics every N seconds, logs to JSONL,
// and fires alerts when thresholds are breached.
//
// Metrics: logs/metrics/{yyyy-mm-dd}.jsonl (daily rotation)
// Alerts:  logs/alerts.jsonl (append-only)
// ============================================================

import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import type { MonitoringConfig, SystemMetrics, AlertEntry, AlertLevel } from '../../types/index.js';

export type AlertCallback = (message: string, level: AlertLevel) => void;

const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes between same alert type
const DATA_DIRS = ['memory', 'sessions', 'cache', 'logs', 'backups', 'autonomous', 'workspace', 'knowledge', 'notes', 'triggers', 'reminders'];

export class SystemMonitor {
  private interval: ReturnType<typeof setInterval> | null = null;
  private alertCallback: AlertCallback | null = null;
  private alertCooldowns = new Map<string, number>();
  private errorCount = 0;
  private lastMetrics: SystemMetrics | null = null;
  private recentAlerts: AlertEntry[] = [];

  private readonly metricsDir: string;
  private readonly alertsPath: string;

  constructor(
    private readonly config: MonitoringConfig,
    private readonly baseDir: string,
  ) {
    this.metricsDir = join(baseDir, 'logs', 'metrics');
    this.alertsPath = join(baseDir, 'logs', 'alerts.jsonl');
  }

  setAlertCallback(callback: AlertCallback): void {
    this.alertCallback = callback;
  }

  start(): void {
    if (!this.config.enabled || this.interval) return;

    this.interval = setInterval(
      () => { void this.collectMetrics(); },
      this.config.metricsIntervalMs,
    );
    this.interval.unref();

    // Collect immediately on start
    void this.collectMetrics();
    console.log('[monitor] System monitoring started');
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  trackError(): void {
    this.errorCount++;
  }

  getStatus(): SystemMetrics | null {
    return this.lastMetrics;
  }

  getRecentAlerts(count = 10): AlertEntry[] {
    return this.recentAlerts.slice(-count);
  }

  // ------------------------------------------------------------------
  // Alert
  // ------------------------------------------------------------------

  async alert(level: AlertLevel, type: string, message: string, metadata?: Record<string, unknown>): Promise<void> {
    const now = Date.now();
    const lastFired = this.alertCooldowns.get(type) ?? 0;
    if (now - lastFired < COOLDOWN_MS) return;

    this.alertCooldowns.set(type, now);

    const entry: AlertEntry = {
      timestamp: new Date().toISOString(),
      level,
      type,
      message,
      metadata,
    };

    this.recentAlerts.push(entry);
    if (this.recentAlerts.length > 50) {
      this.recentAlerts = this.recentAlerts.slice(-50);
    }

    // Append to JSONL
    try {
      await fs.mkdir(dirname(this.alertsPath), { recursive: true });
      await fs.appendFile(this.alertsPath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch (err) {
      console.error('[monitor] Failed to write alert:', (err as Error).message);
    }

    // Push critical/warning to Telegram
    if ((level === 'critical' || level === 'warning') && this.alertCallback) {
      const icon = level === 'critical' ? '\u{1F6A8}' : '\u26A0\uFE0F';
      this.alertCallback(`${icon} [${level.toUpperCase()}] ${message}`, level);
    }

    console.log(`[monitor] ${level.toUpperCase()}: ${message}`);
  }

  // ------------------------------------------------------------------
  // Metrics collection
  // ------------------------------------------------------------------

  private async collectMetrics(): Promise<void> {
    try {
      const diskUsage: Record<string, number> = {};
      for (const dir of DATA_DIRS) {
        diskUsage[dir] = await this.getDirSize(join(this.baseDir, dir));
        // Yield to event loop between dir scans to avoid blocking
        await new Promise((r) => setTimeout(r, 0));
      }

      const metrics: SystemMetrics = {
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        diskUsage,
        memorySizes: await this.getMemorySizes(),
        sessionCount: await this.getSessionCount(),
        cacheEntryCount: 0,
        cacheSizeBytes: 0,
      };

      // Cache stats
      try {
        const cachePath = join(this.baseDir, 'cache', 'responses.json');
        const content = await fs.readFile(cachePath, 'utf-8');
        const data = JSON.parse(content) as { entries?: unknown[] };
        metrics.cacheEntryCount = data.entries?.length ?? 0;
        metrics.cacheSizeBytes = Buffer.byteLength(content, 'utf-8');
      } catch {
        // No cache file
      }

      this.lastMetrics = metrics;
      await this.writeMetrics(metrics);
      await this.checkThresholds(metrics);

      // Reset error counter after each collection cycle
      this.errorCount = 0;
    } catch (err) {
      console.error('[monitor] Metrics collection failed:', (err as Error).message);
    }
  }

  private async getMemorySizes(): Promise<Record<string, number>> {
    const sizes: Record<string, number> = {};
    const semanticDir = join(this.baseDir, 'memory', 'semantic');

    try {
      const users = await fs.readdir(semanticDir, { withFileTypes: true });
      for (const entry of users) {
        if (!entry.isDirectory()) continue;
        const userDir = join(semanticDir, entry.name);
        for (const layer of ['identity', 'projects', 'knowledge', 'episodes']) {
          try {
            const stat = await fs.stat(join(userDir, `${layer}.json`));
            sizes[`${entry.name}/${layer}`] = stat.size;
          } catch {
            // Layer file doesn't exist
          }
        }
      }
    } catch {
      // No semantic dir
    }

    return sizes;
  }

  private async getSessionCount(): Promise<number> {
    try {
      const files = await fs.readdir(join(this.baseDir, 'sessions'));
      return files.filter((f) => f.endsWith('.json')).length;
    } catch {
      return 0;
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
      // Directory doesn't exist
    }
    return total;
  }

  private async writeMetrics(metrics: SystemMetrics): Promise<void> {
    const date = metrics.timestamp.split('T')[0]; // yyyy-mm-dd
    const filepath = join(this.metricsDir, `${date}.jsonl`);

    try {
      await fs.mkdir(this.metricsDir, { recursive: true });
      await fs.appendFile(filepath, JSON.stringify(metrics) + '\n', 'utf-8');
    } catch (err) {
      console.error('[monitor] Failed to write metrics:', (err as Error).message);
    }
  }

  // ------------------------------------------------------------------
  // Threshold checks
  // ------------------------------------------------------------------

  private async checkThresholds(metrics: SystemMetrics): Promise<void> {
    // Total disk usage across all data dirs
    const totalBytes = Object.values(metrics.diskUsage).reduce((a, b) => a + b, 0);
    const totalGB = totalBytes / (1024 * 1024 * 1024);

    // Alert if total data exceeds 10GB (reasonable for file-based storage)
    if (totalGB > 10) {
      await this.alert('critical', 'disk_usage_high',
        `Total data size: ${totalGB.toFixed(2)} GB — consider pruning old backups/logs`,
        { totalBytes });
    }

    // Error rate
    if (this.errorCount > this.config.alertThresholds.errorRatePerMinute) {
      await this.alert('warning', 'error_rate_spike',
        `Error rate: ${this.errorCount} errors since last check (threshold: ${this.config.alertThresholds.errorRatePerMinute})`,
        { errorCount: this.errorCount });
    }
  }
}
