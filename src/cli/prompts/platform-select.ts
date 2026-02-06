// ============================================================
// OpenClaw Deploy — Platform Selection Prompt
// ============================================================

import { checkbox } from '@inquirer/prompts';
import type { ChannelId } from '../../types/index.js';

interface PlatformChoice {
  name: string;
  value: ChannelId;
  checked: boolean;
  disabled: string | false;
}

export async function promptPlatforms(): Promise<ChannelId[]> {
  const choices: PlatformChoice[] = [
    { name: 'Web Chat (built-in, always on)', value: 'webchat', checked: true, disabled: 'always enabled' },
    { name: 'Telegram — Create bot via @BotFather', value: 'telegram', checked: false, disabled: false },
    { name: 'WhatsApp — Scan QR code in Control UI', value: 'whatsapp', checked: false, disabled: false },
    { name: 'Discord — Create app in Developer Portal', value: 'discord', checked: false, disabled: false },
    { name: 'Slack — Create app in Slack console', value: 'slack', checked: false, disabled: false },
    { name: 'Signal — Requires signal-cli daemon', value: 'signal', checked: false, disabled: false },
  ];

  const selected = await checkbox({
    message: 'Select messaging platforms:',
    choices,
  });

  // Ensure webchat is always included
  const result = selected as ChannelId[];
  if (!result.includes('webchat')) {
    result.unshift('webchat');
  }

  return result;
}
