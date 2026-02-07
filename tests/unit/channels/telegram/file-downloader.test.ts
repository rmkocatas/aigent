import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { downloadTelegramFile } from '../../../../src/core/channels/telegram/file-downloader.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BOT_TOKEN = 'fake-bot-token';
const FILE_ID = 'AgACAgIAAxk';

function makeGetFileResponse(
  filePath: string,
  fileSize?: number,
): { ok: boolean; result: { file_id: string; file_unique_id: string; file_path: string; file_size?: number } } {
  return {
    ok: true,
    result: {
      file_id: FILE_ID,
      file_unique_id: 'unique1',
      file_path: filePath,
      ...(fileSize !== undefined ? { file_size: fileSize } : {}),
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function binaryResponse(data: Uint8Array, status = 200): Response {
  return new Response(data, { status });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('downloadTelegramFile', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('downloads a file successfully', async () => {
    const fileData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header bytes

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/getFile')) {
        return jsonResponse(makeGetFileResponse('photos/file_0.jpg', 4));
      }
      if (url.includes('/file/bot')) {
        return binaryResponse(fileData);
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof globalThis.fetch;

    const result = await downloadTelegramFile(BOT_TOKEN, FILE_ID);
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBe(4);
    expect(result.filePath).toBe('photos/file_0.jpg');
  });

  it('uses default 5MB max size when not specified', async () => {
    const sixMB = 6 * 1024 * 1024;

    globalThis.fetch = vi.fn(async () => {
      return jsonResponse(makeGetFileResponse('photos/big.jpg', sixMB));
    }) as typeof globalThis.fetch;

    await expect(downloadTelegramFile(BOT_TOKEN, FILE_ID)).rejects.toThrow(
      /too large/i,
    );
  });

  it('respects custom maxSizeBytes', async () => {
    globalThis.fetch = vi.fn(async () => {
      return jsonResponse(makeGetFileResponse('photos/file.jpg', 2000));
    }) as typeof globalThis.fetch;

    await expect(
      downloadTelegramFile(BOT_TOKEN, FILE_ID, 1000),
    ).rejects.toThrow(/too large/i);
  });

  it('rejects path traversal in file_path', async () => {
    globalThis.fetch = vi.fn(async () => {
      return jsonResponse(makeGetFileResponse('../../../etc/passwd', 100));
    }) as typeof globalThis.fetch;

    await expect(downloadTelegramFile(BOT_TOKEN, FILE_ID)).rejects.toThrow(
      /suspicious/i,
    );
  });

  it('rejects absolute path in file_path', async () => {
    globalThis.fetch = vi.fn(async () => {
      return jsonResponse(makeGetFileResponse('/etc/passwd', 100));
    }) as typeof globalThis.fetch;

    await expect(downloadTelegramFile(BOT_TOKEN, FILE_ID)).rejects.toThrow(
      /suspicious/i,
    );
  });

  it('throws when getFile returns not ok', async () => {
    globalThis.fetch = vi.fn(async () => {
      return jsonResponse({ ok: false, result: {} });
    }) as typeof globalThis.fetch;

    await expect(downloadTelegramFile(BOT_TOKEN, FILE_ID)).rejects.toThrow(
      /no file_path/i,
    );
  });

  it('throws when getFile HTTP status is not 200', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response('Not found', { status: 404 });
    }) as typeof globalThis.fetch;

    await expect(downloadTelegramFile(BOT_TOKEN, FILE_ID)).rejects.toThrow(
      /getFile failed.*404/,
    );
  });

  it('throws when file download HTTP status is not 200', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return jsonResponse(makeGetFileResponse('photos/file.jpg', 100));
      }
      return new Response('Server Error', { status: 500 });
    }) as typeof globalThis.fetch;

    await expect(downloadTelegramFile(BOT_TOKEN, FILE_ID)).rejects.toThrow(
      /download failed.*500/,
    );
  });

  it('rejects downloaded file that exceeds max size', async () => {
    // file_size reports small but actual download is bigger
    const bigData = new Uint8Array(2000);

    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        // Report a small file_size to pass the pre-check
        return jsonResponse(makeGetFileResponse('photos/file.jpg', 500));
      }
      return binaryResponse(bigData);
    }) as typeof globalThis.fetch;

    await expect(
      downloadTelegramFile(BOT_TOKEN, FILE_ID, 1000),
    ).rejects.toThrow(/too large/i);
  });

  it('passes when file_size is not reported and download fits', async () => {
    const fileData = new Uint8Array([1, 2, 3, 4]);

    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        // No file_size in response
        return jsonResponse(makeGetFileResponse('photos/file.jpg'));
      }
      return binaryResponse(fileData);
    }) as typeof globalThis.fetch;

    const result = await downloadTelegramFile(BOT_TOKEN, FILE_ID);
    expect(result.buffer.length).toBe(4);
    expect(result.filePath).toBe('photos/file.jpg');
  });

  it('calls correct URLs with bot token and file_id', async () => {
    const fileData = new Uint8Array([0xff]);
    const calledUrls: string[] = [];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      calledUrls.push(url);
      if (url.includes('/getFile')) {
        return jsonResponse(makeGetFileResponse('documents/file.pdf', 1));
      }
      return binaryResponse(fileData);
    }) as typeof globalThis.fetch;

    await downloadTelegramFile(BOT_TOKEN, FILE_ID);

    expect(calledUrls[0]).toContain(`/bot${BOT_TOKEN}/getFile`);
    expect(calledUrls[0]).toContain(`file_id=${FILE_ID}`);
    expect(calledUrls[1]).toBe(
      `https://api.telegram.org/file/bot${BOT_TOKEN}/documents/file.pdf`,
    );
  });
});
