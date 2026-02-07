import { describe, it, expect, vi, beforeEach } from 'vitest';
import { downloadWhatsAppMedia } from '../../../../src/core/channels/whatsapp/media-downloader.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe('downloadWhatsAppMedia', () => {
  it('downloads media in two steps (meta + binary)', async () => {
    // Step 1: Meta response with URL
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        url: 'https://media.whatsapp.net/file123',
        file_size: 1024,
        mime_type: 'image/jpeg',
      }),
    });

    // Step 2: Binary download
    const fakeBuffer = new ArrayBuffer(1024);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(fakeBuffer),
    });

    const result = await downloadWhatsAppMedia('test-token', 'media-id-123');

    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBe(1024);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Verify first call includes auth header
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer test-token');
  });

  it('throws when meta response fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    await expect(
      downloadWhatsAppMedia('token', 'bad-id'),
    ).rejects.toThrow('Failed to get media URL');
  });

  it('throws when no URL in meta response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ file_size: 100 }),
    });

    await expect(
      downloadWhatsAppMedia('token', 'media-id'),
    ).rejects.toThrow('no media URL');
  });

  it('throws when file exceeds max size (pre-check)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        url: 'https://media.whatsapp.net/big',
        file_size: 10 * 1024 * 1024,
      }),
    });

    await expect(
      downloadWhatsAppMedia('token', 'media-id', 5 * 1024 * 1024),
    ).rejects.toThrow('File too large');
  });

  it('throws when download response fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        url: 'https://media.whatsapp.net/file',
        file_size: 100,
      }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    await expect(
      downloadWhatsAppMedia('token', 'media-id'),
    ).rejects.toThrow('Failed to download media');
  });

  it('throws when downloaded buffer exceeds max size (post-check)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        url: 'https://media.whatsapp.net/file',
        // No file_size in meta — so pre-check passes
      }),
    });

    const bigBuffer = new ArrayBuffer(10 * 1024 * 1024);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(bigBuffer),
    });

    await expect(
      downloadWhatsAppMedia('token', 'media-id', 5 * 1024 * 1024),
    ).rejects.toThrow('Downloaded file too large');
  });
});
