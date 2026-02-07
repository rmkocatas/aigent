// ============================================================
// OpenClaw Deploy — Fetch URL Tool
// ============================================================

import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';
import { lookup } from 'node:dns/promises';

const MAX_CONTENT_SIZE = 30_000;

// ---------------------------------------------------------------------------
// SSRF Protection — block private/internal IP ranges
// ---------------------------------------------------------------------------

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;
  const [a, b] = parts;
  // 127.0.0.0/8 (loopback)
  if (a === 127) return true;
  // 10.0.0.0/8 (class A private)
  if (a === 10) return true;
  // 172.16.0.0/12 (class B private)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 (class C private)
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 (link-local)
  if (a === 169 && b === 254) return true;
  // 0.0.0.0/8 (unspecified)
  if (a === 0) return true;
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // ::1 (loopback)
  if (lower === '::1' || lower === '0000:0000:0000:0000:0000:0000:0000:0001') return true;
  // :: (unspecified)
  if (lower === '::' || lower === '0000:0000:0000:0000:0000:0000:0000:0000') return true;
  // fc00::/7 (unique local)
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  // fe80::/10 (link-local)
  if (lower.startsWith('fe80')) return true;
  return false;
}

export async function validateUrlSafety(url: string): Promise<void> {
  const parsed = new URL(url);
  const hostname = parsed.hostname;

  // Resolve hostname to IP to prevent DNS rebinding
  try {
    const result = await lookup(hostname);
    const ip = result.address;
    const family = result.family;

    if (family === 4 && isPrivateIPv4(ip)) {
      throw new Error(`SSRF blocked: ${hostname} resolves to private IP ${ip}`);
    }
    if (family === 6 && isPrivateIPv6(ip)) {
      throw new Error(`SSRF blocked: ${hostname} resolves to private IP ${ip}`);
    }
  } catch (err) {
    if ((err as Error).message.startsWith('SSRF blocked')) throw err;
    // DNS lookup failed — let fetch handle it
  }
}

export const fetchUrlDefinition: ToolDefinition = {
  name: 'fetch_url',
  description: 'Fetch and read the content of a webpage. Returns the text content of the page with HTML tags stripped.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch (must be http:// or https://).',
      },
    },
    required: ['url'],
  },
};

let lastRequestTime = 0;
const MIN_INTERVAL_MS = 2000;

export const fetchUrlHandler: ToolHandler = async (input) => {
  const url = input.url as string;
  if (!url || typeof url !== 'string') {
    throw new Error('Missing URL');
  }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error('URL must start with http:// or https://');
  }

  // SSRF check — resolve hostname and block private IPs
  await validateUrlSafety(url);

  // Rate limit
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  lastRequestTime = Date.now();

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; MoltBot/1.0)',
      'Accept': 'text/html, text/plain, application/json, */*',
    },
    signal: AbortSignal.timeout(10_000),
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const raw = await response.text();

  let text: string;
  if (contentType.includes('application/json')) {
    // Return JSON as-is (prettified)
    try {
      text = JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      text = raw;
    }
  } else if (contentType.includes('text/plain')) {
    text = raw;
  } else {
    // HTML — strip tags
    text = stripHtml(raw);
  }

  if (text.length > MAX_CONTENT_SIZE) {
    return text.slice(0, MAX_CONTENT_SIZE) + '\n\n[Content truncated — page exceeds 30KB]';
  }

  return text || '[Page returned no readable content]';
};

function stripHtml(html: string): string {
  return html
    // Remove script/style blocks entirely
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    // Replace block elements with newlines
    .replace(/<\/?(p|div|br|hr|h[1-6]|li|tr|blockquote|pre|section|article|header|footer)[^>]*>/gi, '\n')
    // Strip remaining tags
    .replace(/<[^>]*>/g, '')
    // Decode common entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Clean up whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();
}
