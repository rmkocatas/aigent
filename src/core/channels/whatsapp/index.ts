// ============================================================
// OpenClaw Deploy — WhatsApp Channel
// ============================================================

export { WhatsAppBot } from './bot.js';
export type { WhatsAppBotConfig, WhatsAppBotDeps } from './bot.js';
export { handleWhatsAppWebhook, verifyWhatsAppWebhook } from './webhook-handler.js';

import { WhatsAppBot, type WhatsAppBotDeps } from './bot.js';

export function createWhatsAppBot(
  accessToken: string,
  phoneNumberId: string,
  verifyToken: string,
  deps: WhatsAppBotDeps,
): WhatsAppBot {
  return new WhatsAppBot(
    { accessToken, phoneNumberId, verifyToken },
    deps,
  );
}
