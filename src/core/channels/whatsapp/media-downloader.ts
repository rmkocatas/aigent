// ============================================================
// OpenClaw Deploy — WhatsApp Media Downloader
// ============================================================
//
// Downloads media files from the WhatsApp Cloud API.
// Two-step process: (1) get media URL, (2) download binary.
// ============================================================

const API_BASE = 'https://graph.facebook.com/v21.0';

/**
 * Download a media file from WhatsApp Cloud API.
 *
 * @param accessToken - WhatsApp Business API access token
 * @param mediaId - Media ID from the incoming message
 * @param maxSizeBytes - Maximum allowed file size (default 5 MB)
 * @returns Buffer containing the media file data
 */
export async function downloadWhatsAppMedia(
  accessToken: string,
  mediaId: string,
  maxSizeBytes = 5 * 1024 * 1024,
): Promise<Buffer> {
  // Step 1: Retrieve media URL
  const metaResponse = await fetch(`${API_BASE}/${mediaId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!metaResponse.ok) {
    throw new Error(`Failed to get media URL: HTTP ${metaResponse.status}`);
  }

  const meta = await metaResponse.json() as {
    url?: string;
    file_size?: number;
    mime_type?: string;
  };

  if (!meta.url) {
    throw new Error('WhatsApp API returned no media URL');
  }

  // Validate size before downloading
  if (meta.file_size && meta.file_size > maxSizeBytes) {
    throw new Error(
      `File too large: ${meta.file_size} bytes (max ${maxSizeBytes} bytes)`,
    );
  }

  // Step 2: Download the actual media file
  const downloadResponse = await fetch(meta.url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!downloadResponse.ok) {
    throw new Error(`Failed to download media: HTTP ${downloadResponse.status}`);
  }

  const arrayBuffer = await downloadResponse.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Post-download size validation
  if (buffer.length > maxSizeBytes) {
    throw new Error(
      `Downloaded file too large: ${buffer.length} bytes (max ${maxSizeBytes} bytes)`,
    );
  }

  return buffer;
}
