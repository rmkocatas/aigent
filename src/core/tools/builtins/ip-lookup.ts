// ============================================================
// OpenClaw Deploy — IP Lookup Tool (ip-api.com)
// ============================================================

import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

let lastRequestTime = 0;
const MIN_INTERVAL_MS = 2000;

const IPV4_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

const PRIVATE_RANGES = [
  { start: [10, 0, 0, 0], end: [10, 255, 255, 255] },
  { start: [172, 16, 0, 0], end: [172, 31, 255, 255] },
  { start: [192, 168, 0, 0], end: [192, 168, 255, 255] },
  { start: [127, 0, 0, 0], end: [127, 255, 255, 255] },
  { start: [0, 0, 0, 0], end: [0, 0, 0, 0] },
];

function ipToOctets(ip: string): number[] {
  return ip.split('.').map(Number);
}

function isPrivateIp(ip: string): boolean {
  const octets = ipToOctets(ip);
  return PRIVATE_RANGES.some(({ start, end }) =>
    octets.every((o, i) => o >= start[i] && o <= end[i]),
  );
}

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

export const ipLookupDefinition: ToolDefinition = {
  name: 'ip_lookup',
  description: 'Look up geolocation information for a public IPv4 address.',
  parameters: {
    type: 'object',
    properties: {
      ip: { type: 'string', description: 'The IPv4 address to look up.' },
    },
    required: ['ip'],
  },
  routing: {
    useWhen: ['User provides an IP address and wants geolocation or ISP info'],
    avoidWhen: ['User is asking about networking concepts, not a specific IP'],
  },
};

export const ipLookupHandler: ToolHandler = async (input) => {
  const ip = (input.ip as string)?.trim();
  if (!ip) throw new Error('Missing IP address');

  const match = IPV4_REGEX.exec(ip);
  if (!match) throw new Error('Invalid IPv4 address format');

  const octets = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
  if (octets.some((o) => o > 255)) throw new Error('Invalid IPv4 address — octets must be 0-255');

  if (isPrivateIp(ip)) {
    throw new Error('Cannot look up private/reserved IP addresses');
  }

  await rateLimit();

  const url = `http://ip-api.com/json/${ip}?fields=status,message,country,regionName,city,zip,lat,lon,timezone,isp,org`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });

  if (!response.ok) throw new Error(`IP API error: ${response.status}`);

  const data = await response.json() as Record<string, unknown>;

  if (data.status === 'fail') {
    throw new Error(`Lookup failed: ${data.message}`);
  }

  const lines = [
    `IP: ${ip}`,
    `Country: ${data.country}`,
    `Region: ${data.regionName}`,
    `City: ${data.city}`,
    `ZIP: ${data.zip}`,
    `Coordinates: ${data.lat}, ${data.lon}`,
    `Timezone: ${data.timezone}`,
    `ISP: ${data.isp}`,
    `Organization: ${data.org}`,
  ];

  return lines.join('\n');
};
