import { describe, it, expect, vi } from 'vitest';
import { checkDeploymentStatus } from '../../../src/core/status/checker.js';

// Mock dependencies
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

vi.mock('../../../src/core/docker/container-manager.js', () => ({
  ContainerManager: vi.fn().mockImplementation(() => ({
    status: vi.fn().mockResolvedValue({ running: true, containers: ['openclaw'] }),
  })),
}));

vi.mock('../../../src/core/docker/health-check.js', () => ({
  checkHealth: vi.fn().mockResolvedValue({ healthy: true }),
}));

describe('checkDeploymentStatus', () => {
  it('returns full status when config is valid', async () => {
    const { readFile } = await import('node:fs/promises');
    (readFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({
      gateway: { bind: '127.0.0.1', port: 3000 },
      securityLevel: 'L2',
      channels: [
        { id: 'webchat', enabled: true },
        { id: 'telegram', enabled: true },
      ],
    }));

    const status = await checkDeploymentStatus('/test/dir');

    expect(status.running).toBe(true);
    expect(status.gatewayHealthy).toBe(true);
    expect(status.gatewayUrl).toBe('http://127.0.0.1:3000');
    expect(status.securityLevel).toBe('L2');
    expect(status.channels).toHaveLength(2);
  });

  it('returns error when config cannot be read', async () => {
    const { readFile } = await import('node:fs/promises');
    (readFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ENOENT'));

    const status = await checkDeploymentStatus('/test/dir');

    expect(status.running).toBe(false);
    expect(status.error).toContain('Cannot read openclaw.json');
  });

  it('marks channels as disconnected when containers not running', async () => {
    const { readFile } = await import('node:fs/promises');
    (readFile as ReturnType<typeof vi.fn>).mockResolvedValue(JSON.stringify({
      gateway: { bind: '127.0.0.1', port: 3000 },
      channels: [{ id: 'telegram', enabled: true }],
    }));

    const { ContainerManager } = await import('../../../src/core/docker/container-manager.js');
    (ContainerManager as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      status: vi.fn().mockResolvedValue({ running: false, containers: [] }),
    }));

    const status = await checkDeploymentStatus('/test/dir');
    expect(status.channels[0].connected).toBe(false);
  });
});
