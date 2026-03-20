// ============================================================
// OpenClaw Deploy — Discord Channel (Public API)
// ============================================================

export { DiscordBot } from './bot.js';
export type { DiscordBotConfig, DiscordBotDeps } from './bot.js';

import { DiscordBot } from './bot.js';
import type { DiscordBotDeps } from './bot.js';

export function createDiscordBot(
  token: string,
  appId: string,
  deps: DiscordBotDeps,
): DiscordBot {
  return new DiscordBot({ token, appId }, deps);
}
