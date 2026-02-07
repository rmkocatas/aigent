// ============================================================
// OpenClaw Deploy — Channel Manager
// ============================================================

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ChannelId,
  ChannelSelection,
  ChannelDefinition,
} from '../../types/index.js';

// ---------------------------------------------------------------------------
// Channel registry
// ---------------------------------------------------------------------------

export const CHANNEL_DEFINITIONS: ChannelDefinition[] = [
  {
    id: 'webchat',
    name: 'Web Chat',
    automationLevel: 'full',
    requiresExternalAccount: false,
    requiresExternalDaemon: false,
    credentialType: 'none',
    configKeys: [],
  },
  {
    id: 'telegram',
    name: 'Telegram',
    automationLevel: 'high',
    requiresExternalAccount: true,
    requiresExternalDaemon: false,
    credentialType: 'token',
    configKeys: ['TELEGRAM_BOT_TOKEN'],
  },
  {
    id: 'discord',
    name: 'Discord',
    automationLevel: 'high',
    requiresExternalAccount: true,
    requiresExternalDaemon: false,
    credentialType: 'token',
    configKeys: ['DISCORD_BOT_TOKEN', 'DISCORD_APP_ID'],
  },
  {
    id: 'slack',
    name: 'Slack',
    automationLevel: 'medium',
    requiresExternalAccount: true,
    requiresExternalDaemon: false,
    credentialType: 'oauth',
    configKeys: ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'SLACK_SIGNING_SECRET'],
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    automationLevel: 'low',
    requiresExternalAccount: true,
    requiresExternalDaemon: true,
    credentialType: 'session',
    configKeys: ['WHATSAPP_SESSION_DIR'],
  },
  {
    id: 'signal',
    name: 'Signal',
    automationLevel: 'low',
    requiresExternalAccount: true,
    requiresExternalDaemon: true,
    credentialType: 'session',
    configKeys: ['SIGNAL_CLI_CONFIG_DIR', 'SIGNAL_PHONE_NUMBER'],
  },
];

export function getChannelDefinition(id: ChannelId): ChannelDefinition | undefined {
  return CHANNEL_DEFINITIONS.find((ch) => ch.id === id);
}

// ---------------------------------------------------------------------------
// Config file operations
// ---------------------------------------------------------------------------

export async function loadChannelConfig(installDir: string): Promise<ChannelSelection[]> {
  const configPath = join(installDir, 'openclaw.json');
  const raw = await readFile(configPath, 'utf-8');
  const stripped = raw.replace(/^\s*\/\/.*$/gm, '');
  const parsed = JSON.parse(stripped) as { channels?: ChannelSelection[] };
  return parsed.channels ?? [{ id: 'webchat', enabled: true }];
}

export async function saveChannelConfig(
  installDir: string,
  channels: ChannelSelection[],
): Promise<void> {
  const configPath = join(installDir, 'openclaw.json');
  const raw = await readFile(configPath, 'utf-8');
  const stripped = raw.replace(/^\s*\/\/.*$/gm, '');
  const parsed = JSON.parse(stripped) as Record<string, unknown>;

  parsed.channels = channels.map((ch) => ({
    id: ch.id,
    enabled: ch.enabled,
    ...(ch.token ? { token: ch.token } : {}),
    ...(ch.config ? { config: ch.config } : {}),
  }));

  // Preserve comment header
  const headerMatch = raw.match(/^((?:\s*\/\/.*\n)*)/);
  const header = headerMatch ? headerMatch[1] : '';
  const body = JSON.stringify(parsed, null, 2) + '\n';
  await writeFile(configPath, header + body, 'utf-8');
}

export function enableChannel(
  channels: ChannelSelection[],
  id: ChannelId,
  token?: string,
): ChannelSelection[] {
  const existing = channels.find((ch) => ch.id === id);
  if (existing) {
    existing.enabled = true;
    if (token) existing.token = token;
    return channels;
  }
  return [...channels, { id, enabled: true, ...(token ? { token } : {}) }];
}

export function disableChannel(
  channels: ChannelSelection[],
  id: ChannelId,
): ChannelSelection[] {
  if (id === 'webchat') {
    throw new Error('Cannot disable webchat — it is always enabled.');
  }
  return channels.map((ch) =>
    ch.id === id ? { ...ch, enabled: false } : ch,
  );
}
