import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCurrentVersion } from '../../../src/core/update/updater.js';

// Mock fs for getCurrentVersion
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

describe('getCurrentVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts version from docker-compose image tag', async () => {
    const { readFile } = await import('node:fs/promises');
    (readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      'services:\n  openclaw:\n    image: ghcr.io/openclaw/openclaw:v0.2.0\n',
    );
    const version = await getCurrentVersion('/test/dir');
    expect(version).toBe('v0.2.0');
  });

  it('returns latest when no tag specified', async () => {
    const { readFile } = await import('node:fs/promises');
    (readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      'services:\n  openclaw:\n    image: ghcr.io/openclaw/openclaw:latest\n',
    );
    const version = await getCurrentVersion('/test/dir');
    expect(version).toBe('latest');
  });

  it('returns unknown when file does not exist', async () => {
    const { readFile } = await import('node:fs/promises');
    (readFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ENOENT'));
    const version = await getCurrentVersion('/test/dir');
    expect(version).toBe('unknown');
  });

  it('returns latest when no image tag match found', async () => {
    const { readFile } = await import('node:fs/promises');
    (readFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      'services:\n  openclaw:\n    ports:\n      - "3000:3000"\n',
    );
    const version = await getCurrentVersion('/test/dir');
    expect(version).toBe('latest');
  });
});
