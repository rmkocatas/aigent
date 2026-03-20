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
  // 100.64.0.0/10 (CGNAT — Tailscale, carrier NAT)
  if (a === 100 && b >= 64 && b <= 127) return true;
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
  // IPv6 transition addresses — can tunnel to private IPv4
  // NAT64 (64:ff9b::/96)
  if (lower.startsWith('64:ff9b:')) return true;
  // 6to4 (2002::/16) — embeds IPv4 in bytes 3-6, could tunnel to private
  if (lower.startsWith('2002:')) return true;
  // Teredo (2001:0000::/32)
  if (lower.startsWith('2001:0000:') || lower.startsWith('2001:0:')) return true;
  // IPv4-mapped IPv6 (::ffff:x.x.x.x) — extract and check IPv4
  const v4MappedMatch = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(lower);
  if (v4MappedMatch) {
    return isPrivateIPv4(v4MappedMatch[1]);
  }
  return false;
}

/** Reject octal/hex IP literals (e.g., 0177.0.0.1, 0x7f000001) that bypass naive checks. */
function containsObfuscatedIPLiteral(hostname: string): boolean {
  // Octal notation: 0177.0.0.1
  if (/^0\d+\./.test(hostname)) return true;
  // Hex notation: 0x7f000001 or 0x7f.0x00.0x00.0x01
  if (/^0x[0-9a-f]+$/i.test(hostname)) return true;
  if (/0x[0-9a-f]+\./i.test(hostname)) return true;
  // Decimal integer notation: 2130706433
  if (/^\d{8,}$/.test(hostname)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// SSRF Protection — hostname deny list (cloud metadata, internal services)
// ---------------------------------------------------------------------------

const BLOCKED_HOSTNAMES: Set<string> = new Set([
  // Cloud metadata endpoints
  'metadata.google.internal',
  'metadata.azure.com',
  'instance-data',
  // Kubernetes internal DNS
  'kubernetes.default',
  'kubernetes.default.svc',
  'kubernetes.default.svc.cluster.local',
  // Docker internal DNS
  'host.docker.internal',
  'gateway.docker.internal',
  // Common internal
  'localhost',
  'internal',
]);

const BLOCKED_HOSTNAME_SUFFIXES: string[] = [
  '.internal',
  '.local',
  '.localhost',
  '.corp',
  '.intranet',
];

function isHostnameBlocked(hostname: string): boolean {
  const lower = hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(lower)) return true;

  for (const suffix of BLOCKED_HOSTNAME_SUFFIXES) {
    if (lower.endsWith(suffix)) return true;
  }

  // Block obfuscated IP literals (octal, hex, decimal integer)
  if (containsObfuscatedIPLiteral(lower)) return true;

  // Block raw private IPs typed directly as hostname (belt-and-suspenders with DNS check)
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(lower)) {
    if (isPrivateIPv4(lower)) return true;
    // AWS/cloud metadata IP
    if (lower === '169.254.169.254') return true;
  }

  return false;
}

export async function validateUrlSafety(url: string): Promise<void> {
  const parsed = new URL(url);
  const hostname = parsed.hostname;

  // Hostname deny list — checked before DNS to avoid resolving blocked names
  if (isHostnameBlocked(hostname)) {
    throw new Error(`SSRF blocked: hostname "${hostname}" is on the deny list`);
  }

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
  routing: {
    useWhen: ['User provides a specific URL to read', 'User wants to see the content of a webpage'],
    avoidWhen: ['User wants to search the web broadly (use web_search instead)', 'No URL has been mentioned'],
  },
};

const lastRequestByUser = new Map<string, number>();
const MIN_INTERVAL_MS = 2000;

// ---------------------------------------------------------------------------
// Data exfiltration protection
// ---------------------------------------------------------------------------

const MAX_URL_LENGTH = 2048;
const MAX_QUERY_PARAM_LENGTH = 500;

function checkExfiltration(url: string): void {
  if (url.length > MAX_URL_LENGTH) {
    throw new Error(
      `URL length (${url.length}) exceeds maximum (${MAX_URL_LENGTH}). ` +
      'Unusually long URLs may indicate data exfiltration.',
    );
  }

  // Check for suspiciously long query parameters
  try {
    const parsed = new URL(url);
    for (const [key, value] of parsed.searchParams) {
      if (value.length > MAX_QUERY_PARAM_LENGTH) {
        throw new Error(
          `Query parameter "${key}" value is suspiciously long (${value.length} chars). ` +
          'This may indicate data exfiltration.',
        );
      }
    }

    // Detect base64-encoded blobs in URL (path or query)
    const pathAndQuery = parsed.pathname + parsed.search;
    const base64Pattern = /[A-Za-z0-9+/=]{200,}/;
    if (base64Pattern.test(pathAndQuery)) {
      throw new Error(
        'URL contains a large base64-like encoded string. ' +
        'This may indicate data exfiltration.',
      );
    }
  } catch (err) {
    if ((err as Error).message.includes('exfiltration')) throw err;
    // URL parsing failed — let fetch handle it
  }
}

export const fetchUrlHandler: ToolHandler = async (input, context) => {
  const url = input.url as string;
  if (!url || typeof url !== 'string') {
    throw new Error('Missing URL');
  }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error('URL must start with http:// or https://');
  }

  // Block ws:// for non-loopback hosts (CWE-319: plaintext transport)
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'ws:') {
      const host = parsed.hostname.toLowerCase();
      if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
        throw new Error('Plaintext WebSocket (ws://) is only allowed for loopback addresses');
      }
    }
  } catch (err) {
    if ((err as Error).message.includes('WebSocket')) throw err;
  }

  // Data exfiltration check — block suspiciously long URLs and encoded payloads
  checkExfiltration(url);

  // SSRF check — resolve hostname and block private IPs
  await validateUrlSafety(url);

  // Per-user rate limit
  const userKey = context?.userId ?? '_global';
  const lastTime = lastRequestByUser.get(userKey) ?? 0;
  const now = Date.now();
  const elapsed = now - lastTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  lastRequestByUser.set(userKey, Date.now());

  // Manual redirect following to strip credentials on cross-origin hops
  // and re-validate each redirect target against SSRF rules.
  const MAX_REDIRECTS = 10;
  let currentUrl = url;
  let response: Response | undefined;

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    response = await fetch(currentUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MoltBot/1.0)',
        'Accept': 'text/html, text/plain, application/json, */*',
      },
      signal: AbortSignal.timeout(10_000),
      redirect: 'manual',
    });

    // If not a redirect, break out
    if (!response.status || response.status < 300 || response.status >= 400) break;

    const location = response.headers.get('location');
    if (!location) break;

    // Resolve relative redirects
    const nextUrl = new URL(location, currentUrl).href;

    // Re-validate redirect target against SSRF rules
    await validateUrlSafety(nextUrl);

    // Check exfiltration on redirect target
    checkExfiltration(nextUrl);

    currentUrl = nextUrl;

    if (i === MAX_REDIRECTS) {
      throw new Error(`Too many redirects (>${MAX_REDIRECTS})`);
    }
  }

  if (!response || !response.ok) {
    const status = response?.status ?? 0;
    const statusText = response?.statusText ?? 'unknown';
    throw new Error(`Failed to fetch URL: ${status} ${statusText}`);
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
