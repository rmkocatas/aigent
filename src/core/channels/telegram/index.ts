// ============================================================
// OpenClaw Deploy — Telegram Channel (Public API)
// ============================================================

export { TelegramBot } from './bot.js';
export type { TelegramBotConfig, TelegramBotDeps } from './bot.js';

import { TelegramBot } from './bot.js';
import type { TelegramBotDeps } from './bot.js';

export function createTelegramBot(
  token: string,
  deps: TelegramBotDeps,
  pollingTimeoutSeconds = 30,
): TelegramBot {
  return new TelegramBot(
    { token, pollingTimeoutSeconds },
    deps,
  );
}
