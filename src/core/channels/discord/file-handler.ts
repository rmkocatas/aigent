// ============================================================
// OpenClaw Deploy — Discord File Handler
// ============================================================

const DOWNLOAD_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_SIZE = 25 * 1024 * 1024; // 25 MB default Discord limit

export interface DownloadedAttachment {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

/**
 * Download a Discord attachment from its CDN URL.
 * Discord attachments are directly accessible — no two-step like Telegram.
 */
export async function downloadDiscordAttachment(
  url: string,
  maxSizeBytes = DEFAULT_MAX_SIZE,
): Promise<DownloadedAttachment> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Discord attachment download failed: ${res.status} ${res.statusText}`);
  }

  const arrayBuf = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);

  if (buffer.length > maxSizeBytes) {
    throw new Error(
      `File too large: ${(buffer.length / 1024 / 1024).toFixed(1)}MB exceeds limit of ${(maxSizeBytes / 1024 / 1024).toFixed(0)}MB`,
    );
  }

  const pathname = new URL(url).pathname;
  const filename = pathname.split('/').pop() ?? 'attachment';
  const mimeType = res.headers.get('content-type') ?? 'application/octet-stream';

  return { buffer, filename, mimeType };
}
