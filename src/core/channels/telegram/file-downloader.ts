// ============================================================
// OpenClaw Deploy — Telegram File Downloader
// ============================================================

const DEFAULT_MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const DOWNLOAD_TIMEOUT_MS = 15_000; // 15 seconds

interface GetFileResponse {
  ok: boolean;
  result: {
    file_id: string;
    file_unique_id: string;
    file_size?: number;
    file_path?: string;
  };
}

/**
 * Downloads a file from Telegram's servers using the Bot API.
 *
 * 1. Calls `getFile` to resolve the `file_path` and optional `file_size`.
 * 2. Validates that the reported size is within the allowed limit.
 * 3. Downloads the raw file bytes from the Telegram file API.
 *
 * Rejects on timeout (15 s), path-traversal attempts, or oversized files.
 *
 * @param botToken     - The Telegram bot token
 * @param fileId       - The file_id from a Telegram message
 * @param maxSizeBytes - Maximum allowed file size in bytes (default 5 MB)
 * @returns The file contents as a Buffer and the resolved file_path
 */
export async function downloadTelegramFile(
  botToken: string,
  fileId: string,
  maxSizeBytes?: number,
): Promise<{ buffer: Buffer; filePath: string }> {
  const maxSize = maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES;

  // Step 1: resolve file_path via getFile
  const getFileUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`;

  const metaRes = await fetch(getFileUrl, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });

  if (!metaRes.ok) {
    throw new Error(`Telegram getFile failed: ${metaRes.status}`);
  }

  const meta = (await metaRes.json()) as GetFileResponse;
  if (!meta.ok || !meta.result.file_path) {
    throw new Error('Telegram getFile returned no file_path');
  }

  const filePath = meta.result.file_path;

  // Validate no path traversal
  if (filePath.includes('..') || filePath.startsWith('/')) {
    throw new Error('Suspicious file_path from Telegram API');
  }

  // Step 2: validate file_size before downloading
  if (meta.result.file_size !== undefined && meta.result.file_size > maxSize) {
    throw new Error(
      `File too large: ${meta.result.file_size} bytes exceeds limit of ${maxSize} bytes`,
    );
  }

  // Step 3: download the raw file
  const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;

  const fileRes = await fetch(fileUrl, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });

  if (!fileRes.ok) {
    throw new Error(`Telegram file download failed: ${fileRes.status}`);
  }

  const arrayBuf = await fileRes.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);

  // Double-check actual downloaded size
  if (buffer.length > maxSize) {
    throw new Error(
      `Downloaded file too large: ${buffer.length} bytes exceeds limit of ${maxSize} bytes`,
    );
  }

  return { buffer, filePath };
}
