import { createServer, type Server } from 'node:http';
import type { GatewayRuntimeConfig } from '../../types/index.js';
import { createRequestHandler } from './router.js';
import { SessionStore } from './session-store.js';
import { TrainingDataStore } from '../training/data-collector.js';
import { createTelegramBot, type TelegramBot } from '../channels/telegram/index.js';
import { createWhatsAppBot, type WhatsAppBot } from '../channels/whatsapp/index.js';
import { createToolRegistry } from '../tools/index.js';
import { ReminderScheduler } from '../services/reminder-scheduler.js';
import { ApprovalManager } from '../services/approval-manager.js';

export interface GatewayServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly server: Server;
  readonly sessions: SessionStore;
  readonly telegramBot: TelegramBot | null;
  readonly whatsappBot: WhatsAppBot | null;
}

export async function createGatewayServer(
  config: GatewayRuntimeConfig,
): Promise<GatewayServer> {
  const sessions = new SessionStore(
    config.session.idleTimeoutMinutes,
    config.session.maxConcurrent,
    config.session.persistDir ?? null,
  );

  let trainingStore: TrainingDataStore | null = null;
  if (config.training?.enabled && config.training.dataDir) {
    trainingStore = new TrainingDataStore(config.training.dataDir);
    await trainingStore.init();
  }

  const toolRegistry = createToolRegistry();
  const approvalManager = new ApprovalManager();

  const remindersDir = config.tools.workspaceDir.replace(/workspace\/?$/, 'reminders');
  const reminderScheduler = new ReminderScheduler(remindersDir);

  // WhatsApp bot (if enabled + credentials present)
  let whatsappBot: WhatsAppBot | null = null;
  const whatsappEnabled = config.channels?.some(
    (ch) => ch.id === 'whatsapp' && ch.enabled,
  );
  if (
    whatsappEnabled &&
    config.whatsappAccessToken &&
    config.whatsappPhoneNumberId &&
    config.whatsappVerifyToken
  ) {
    whatsappBot = createWhatsAppBot(
      config.whatsappAccessToken,
      config.whatsappPhoneNumberId,
      config.whatsappVerifyToken,
      { config, sessions, trainingStore, toolRegistry, approvalManager },
    );
  }

  const handler = createRequestHandler({
    config,
    sessions,
    trainingStore,
    toolRegistry,
    whatsappBot,
  });

  const server = createServer(handler);

  // Telegram bot (if enabled + token present)
  let telegramBot: TelegramBot | null = null;
  const telegramEnabled = config.channels?.some(
    (ch) => ch.id === 'telegram' && ch.enabled,
  );
  if (telegramEnabled && config.telegramBotToken) {
    telegramBot = createTelegramBot(
      config.telegramBotToken,
      { config, sessions, trainingStore, toolRegistry, approvalManager },
    );
    approvalManager.setSendFunction((chatId, text) => telegramBot!.sendMessage(chatId, text));
  }

  // Wire reminder scheduler callback
  reminderScheduler.onReminder((reminder) => {
    if (telegramBot && reminder.channel === 'telegram') {
      const chatId = typeof reminder.chatId === 'string'
        ? Number(reminder.chatId)
        : reminder.chatId;
      telegramBot.sendMessage(chatId, `Reminder: ${reminder.message}`).catch(() => {});
    }
    if (whatsappBot && reminder.channel === 'whatsapp') {
      const to = String(reminder.chatId);
      whatsappBot.sendTextMessage(to, `Reminder: ${reminder.message}`).catch(() => {});
    }
  });

  return {
    server,
    sessions,
    telegramBot,
    whatsappBot,
    async start() {
      sessions.start();
      await new Promise<void>((resolve, reject) => {
        server.on('error', reject);
        server.listen(config.port, config.bind, () => {
          resolve();
        });
      });
      // Start Telegram polling (non-blocking)
      if (telegramBot) {
        telegramBot.start().catch(() => {});
      }
      reminderScheduler.start();
    },
    async stop() {
      reminderScheduler.stop();
      if (telegramBot) {
        await telegramBot.stop();
      }
      sessions.stop();
      return new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}
