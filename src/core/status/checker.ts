// ============================================================
// OpenClaw Deploy — Deployment Status Checker
// ============================================================

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  DeploymentStatus,
  ChannelStatus,
  ChannelId,
  ChannelSelection,
} from '../../types/index.js';
import { ContainerManager } from '../docker/container-manager.js';
import { checkHealth } from '../docker/health-check.js';

// ---------------------------------------------------------------------------
// Status check
// ---------------------------------------------------------------------------

export async function checkDeploymentStatus(
  installDir: string,
): Promise<DeploymentStatus> {
  // 1. Load config to determine gateway URL and channels
  let port = 3000;
  let bind = '127.0.0.1';
  let securityLevel = 'L2';
  let channels: ChannelSelection[] = [];

  try {
    const configPath = join(installDir, 'openclaw.json');
    const raw = await readFile(configPath, 'utf-8');
    const stripped = raw.replace(/^\s*\/\/.*$/gm, '');
    const parsed = JSON.parse(stripped) as Record<string, unknown>;

    const gw = parsed.gateway as Record<string, unknown> | undefined;
    port = (gw?.port as number) ?? 3000;
    bind = (gw?.bind as string) ?? '127.0.0.1';
    securityLevel = (parsed.securityLevel as string) ?? 'L2';
    channels = (parsed.channels as ChannelSelection[]) ?? [];
  } catch {
    return {
      running: false,
      containers: [],
      gatewayHealthy: false,
      gatewayUrl: `http://${bind}:${port}`,
      securityLevel,
      channels: [],
      error: 'Cannot read openclaw.json — is the deployment initialized?',
    };
  }

  const gatewayUrl = `http://${bind}:${port}`;

  // 2. Check Docker containers
  const manager = new ContainerManager(installDir);
  const containerStatus = await manager.status();

  // 3. Check gateway health
  const health = await checkHealth(gatewayUrl);

  // 4. Check channel statuses
  const channelStatuses: ChannelStatus[] = channels.map((ch) => ({
    id: ch.id as ChannelId,
    enabled: ch.enabled,
    connected: ch.enabled && containerStatus.running,
    ...(ch.enabled && !containerStatus.running
      ? { error: 'Containers not running' }
      : {}),
  }));

  return {
    running: containerStatus.running,
    containers: containerStatus.containers,
    gatewayHealthy: health.healthy,
    gatewayUrl,
    securityLevel,
    channels: channelStatuses,
  };
}
