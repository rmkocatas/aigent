import { describe, it, expect, vi } from 'vitest';
import {
  removeDeploymentFiles,
} from '../../../src/core/teardown/teardown.js';

// Mock fs
vi.mock('node:fs/promises', () => ({
  rm: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn().mockResolvedValue({ isFile: () => true }),
}));

// Mock child_process
vi.mock('node:child_process', () => ({
  execFile: vi.fn((_cmd, _args, _opts, cb) => {
    cb(null, '', '');
  }),
}));

// Mock ContainerManager
vi.mock('../../../src/core/docker/container-manager.js', () => ({
  ContainerManager: vi.fn().mockImplementation(() => ({
    stop: vi.fn().mockResolvedValue({ success: true }),
  })),
}));

describe('removeDeploymentFiles', () => {
  it('removes known config files that exist', async () => {
    const result = await removeDeploymentFiles('/test/dir');
    expect(result.removed).toContain('openclaw.json');
    expect(result.removed).toContain('.env');
    expect(result.removed).toContain('docker-compose.yml');
    expect(result.removed).toContain('Caddyfile');
    expect(result.errors).toHaveLength(0);
  });

  it('skips files that do not exist', async () => {
    const { stat } = await import('node:fs/promises');
    (stat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ENOENT'));

    const result = await removeDeploymentFiles('/test/dir');
    expect(result.removed).toHaveLength(0);
  });

  it('returns removed file names', async () => {
    const { stat } = await import('node:fs/promises');
    let callCount = 0;
    (stat as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      if (callCount <= 2) return Promise.resolve({ isFile: () => true });
      return Promise.reject(new Error('ENOENT'));
    });

    const result = await removeDeploymentFiles('/test/dir');
    expect(result.removed.length).toBe(2);
  });
});
