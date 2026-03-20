import { createServer, type Server } from 'node:http';
import type { GatewayRuntimeConfig } from '../../types/index.js';
import { createRequestHandler, type RouterDeps } from './router.js';
import { SessionStore } from './session-store.js';
import { TrainingDataStore } from '../training/data-collector.js';
import { createTelegramBot, type TelegramBot } from '../channels/telegram/index.js';
import { createWhatsAppBot, type WhatsAppBot } from '../channels/whatsapp/index.js';
import { createDiscordBot, type DiscordBot } from '../channels/discord/index.js';
import { createToolRegistry } from '../tools/index.js';
import { ReminderScheduler } from '../services/reminder-scheduler.js';
import { ApprovalManager } from '../services/approval-manager.js';
import { AutonomousTaskExecutor } from '../services/autonomous/task-executor.js';
import { AutonomousTaskStore } from '../services/autonomous/task-store.js';
import { AuditLogger } from '../services/autonomous/audit-logger.js';
import { SkillLoader } from '../services/skill-loader.js';
import { MemoryEngine } from '../services/memory/memory-engine.js';
import { setMemoryEngine } from '../tools/builtins/semantic-memory.js';
import { MemoryDatabase, Migrator, SqliteActivityStore, SqliteCacheStore, setKnowledgeGraph, setFactHistory } from '../services/memory-db/index.js';
import { StrategyEngine } from '../services/strategies/strategy-engine.js';
import { CostTracker } from '../services/cost-tracker.js';
import { setCostTracker } from '../tools/builtins/cost-summary.js';
import { DocumentMemoryEngine } from '../services/document-memory/document-memory.js';
import { setDocumentMemory } from '../tools/index.js';
import { ResponseCache } from './response-cache.js';
import { EventTriggerManager } from '../services/event-triggers.js';
import { setTriggerManager } from '../tools/builtins/trigger-tools.js';
import { SystemMonitor } from '../services/system-monitor.js';
import { BackupManager } from '../services/backup-manager.js';
import { setSystemServices, setBrowserBridge, setTwitterClient, setDiscordBot, setEmailConfig, setVaultConfig, setMarketplaceManager } from '../tools/index.js';
import { MarketplaceManager } from '../services/marketplace/marketplace-manager.js';
import { BrowserBridge } from '../services/browser/browser-bridge.js';
import { TwitterClient } from '../services/twitter/twitter-client.js';
import { processChatMessage } from './chat-pipeline.js';
import { splitMessage } from '../channels/telegram/formatter.js';
import { DeliveryQueue } from '../channels/telegram/delivery-queue.js';
import { PipelineHooks } from '../services/pipeline-hooks.js';
import { OpenClawMcpServer } from '../services/mcp/mcp-server.js';
import { SharedAgentState } from '../services/mcp/shared-state.js';
import { AgentRegistry } from '../services/agents/agent-registry.js';
import { PersonaManager } from '../services/persona-manager.js';
import { ChannelLinker, DiscordChannelCache } from '../services/channel-linker.js';
import { join } from 'node:path';

export interface GatewayServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly server: Server;
  readonly sessions: SessionStore;
  readonly telegramBot: TelegramBot | null;
  readonly whatsappBot: WhatsAppBot | null;
  readonly discordBot: DiscordBot | null;
  readonly autonomousExecutor: AutonomousTaskExecutor | null;
}

export async function createGatewayServer(
  config: GatewayRuntimeConfig,
): Promise<GatewayServer> {
  const sessions = new SessionStore(
    config.session.idleTimeoutMinutes,
    config.session.maxConcurrent,
    config.session.persistDir ?? null,
  );

  // Cross-channel sync — ID aliasing
  const channelLinker = new ChannelLinker(config.crossChannel);
  if (config.crossChannel?.links?.length) {
    sessions.setResolveId((id) => channelLinker.resolveId(id));
    console.log(`[cross-channel] ${config.crossChannel.links.length} link(s) configured`);
  }

  let trainingStore: TrainingDataStore | null = null;
  if (config.training?.enabled && config.training.dataDir) {
    trainingStore = new TrainingDataStore(config.training.dataDir);
    await trainingStore.init();
  }

  const toolRegistry = createToolRegistry();
  const approvalManager = new ApprovalManager();

  // Skills loader (if enabled)
  const skillLoader = new SkillLoader();
  if (config.skills?.enabled) {
    await skillLoader.loadSkills(config.skills.skillsDir);
  }

  // Base directory for all data (workspace dir minus "workspace" suffix)
  const baseDir = config.tools.workspaceDir.replace(/workspace\/?$/, '');

  // SQLite memory database (if enabled)
  let memoryDb: MemoryDatabase | undefined;
  const memoryDir = config.tools.workspaceDir.replace(/workspace\/?$/, 'memory');

  if (config.memory?.enabled && config.memory.sqlite?.enabled !== false) {
    const dbPath = config.memory.sqlite?.dbPath ?? join(memoryDir, 'memory.db');
    memoryDb = await MemoryDatabase.create(dbPath);

    // Run one-time migration from JSON/JSONL if needed
    const migrator = new Migrator(memoryDb, baseDir);
    await migrator.migrateIfNeeded();
  }

  // Semantic memory engine (if enabled)
  let memoryEngine: MemoryEngine | undefined;
  if (config.memory?.enabled) {
    memoryEngine = new MemoryEngine(
      config.memory,
      config.ollama,
      config.anthropicApiKey,
      memoryDir,
      config.openaiApiKey,
      memoryDb,
    );
    setMemoryEngine(memoryEngine);

    // Wire knowledge graph and fact history singletons for tools
    const kg = memoryEngine.getKnowledgeGraph();
    const fh = memoryEngine.getFactHistory();
    if (kg) setKnowledgeGraph(kg);
    if (fh) setFactHistory(fh);
  }

  // Dynamic strategy engine (if enabled)
  let strategyEngine: StrategyEngine | undefined;
  if (config.strategies?.enabled) {
    strategyEngine = new StrategyEngine(
      config.strategies,
      config.ollama,
      config.anthropicApiKey,
      config.openaiApiKey,
    );
  }

  // Persona manager (if enabled)
  let personaManager: PersonaManager | undefined;
  if (config.personas?.enabled) {
    personaManager = new PersonaManager(config.personas, baseDir);
    await personaManager.load();
  }

  // Cost tracker
  const costTracker = new CostTracker(baseDir);
  setCostTracker(costTracker);

  // Document memory engine (if enabled)
  let documentMemory: DocumentMemoryEngine | undefined;
  if (config.documentMemory?.enabled) {
    const sqliteActivityStore = memoryDb ? new SqliteActivityStore(memoryDb) : undefined;
    documentMemory = new DocumentMemoryEngine(config.documentMemory, baseDir, config.anthropicApiKey, sqliteActivityStore);
    setDocumentMemory(documentMemory);
  }

  // Semantic response cache
  const sqliteCacheStore = memoryDb ? new SqliteCacheStore(memoryDb) : undefined;
  const responseCache = new ResponseCache(
    config.ollama,
    config.memory?.embeddingModel ?? 'nomic-embed-text',
    config.tools.workspaceDir.replace(/workspace\/?$/, ''),
    sqliteCacheStore,
  );

  // Pipeline hooks — observe LLM I/O across all channels
  const pipelineHooks = new PipelineHooks();
  pipelineHooks.onAfter((ctx, result) => {
    if (result.usage) {
      console.log(
        `[hooks] ${ctx.provider}/${ctx.model} iter=${ctx.iteration} ` +
        `in=${result.usage.inputTokens} out=${result.usage.outputTokens} ` +
        `cache_read=${result.usage.cacheReadInputTokens} ${result.durationMs}ms`,
      );
    }
  });

  const remindersDir = config.tools.workspaceDir.replace(/workspace\/?$/, 'reminders');
  const reminderScheduler = new ReminderScheduler(remindersDir);

  // Shared pipeline deps — mutable so discordChannelDirectory can be added after bot creation
  const sharedPipelineDeps: Record<string, unknown> = { config, sessions, trainingStore, toolRegistry, approvalManager, skillLoader, memoryEngine, strategyEngine, costTracker, responseCache, pipelineHooks, personaManager, documentMemory };

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
      sharedPipelineDeps as any,
    );
  }

  // Discord bot (if enabled + credentials present)
  let discordBot: DiscordBot | null = null;
  const discordEnabled = config.channels?.some(
    (ch) => ch.id === 'discord' && ch.enabled,
  );
  if (discordEnabled && config.discordBotToken && config.discordAppId) {
    discordBot = createDiscordBot(
      config.discordBotToken,
      config.discordAppId,
      sharedPipelineDeps as any,
    );
    setDiscordBot(discordBot);
  }

  // Discord channel directory cache (for cross-channel system prompt injection)
  let discordChannelCache: DiscordChannelCache | null = null;
  let discordChannelDirectory: (() => Promise<string>) | undefined;
  if (discordBot && channelLinker.hasDiscordGuild()) {
    const guildIds = channelLinker.getDiscordGuildIds();
    discordChannelCache = new DiscordChannelCache(
      (guildId) => discordBot!.listChannels(guildId),
      guildIds[0], // Use the first linked guild
    );
    discordChannelDirectory = async () => {
      const channels = await discordChannelCache!.getChannels();
      return discordChannelCache!.formatForSystemPrompt(channels);
    };
    // Add to shared deps so both bots see it
    sharedPipelineDeps.discordChannelDirectory = discordChannelDirectory;
  }

  const routerDeps: RouterDeps = {
    config,
    sessions,
    trainingStore,
    toolRegistry,
    skillLoader,
    memoryEngine,
    strategyEngine,
    costTracker,
    responseCache,
    pipelineHooks,
    personaManager,
    documentMemory,
    whatsappBot,
    configDir: baseDir,
  };
  const handler = createRequestHandler(routerDeps);

  const server = createServer(handler);

  // Telegram bot (if enabled + token present)
  let telegramBot: TelegramBot | null = null;
  const telegramEnabled = config.channels?.some(
    (ch) => ch.id === 'telegram' && ch.enabled,
  );
  if (telegramEnabled && config.telegramBotToken) {
    telegramBot = createTelegramBot(
      config.telegramBotToken,
      sharedPipelineDeps as any,
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
    if (discordBot && reminder.channel === 'discord') {
      const channelId = String(reminder.chatId);
      discordBot.sendMessage(channelId, `Reminder: ${reminder.message}`).catch(() => {});
    }
  });

  // Event trigger manager
  const triggerManager = new EventTriggerManager(baseDir);
  setTriggerManager(triggerManager);
  routerDeps.triggerManager = triggerManager;

  // Write-ahead delivery queue for crash recovery
  if (telegramBot) {
    const deliveryQueue = new DeliveryQueue(baseDir);
    telegramBot.setDeliveryQueue(deliveryQueue);
  }

  // Wire trigger callbacks — process through chat pipeline or autonomous executor
  triggerManager.onTrigger((trigger) => {
    // Resolve Telegram chatId for trigger delivery
    const resolveTelegramChatId = (): number => {
      let chatId = typeof trigger.targetId === 'string'
        ? Number(trigger.targetId.replace('telegram:', ''))
        : trigger.targetId;
      if (!chatId || Number.isNaN(chatId)) {
        chatId = config.telegramAllowedUsers[0] ?? 0;
      }
      return chatId as number;
    };

    // Error handler shared by both paths
    const handleTriggerError = (errMsg: string) => {
      console.error(`[trigger] "${trigger.name}" failed:`, errMsg);
      if (trigger.channel === 'telegram' && telegramBot) {
        const notifyId = resolveTelegramChatId();
        if (notifyId) {
          telegramBot.sendMessage(notifyId, `Trigger "${trigger.name}" failed: ${errMsg}`).catch(() => {});
        }
      } else if (trigger.channel === 'discord' && discordBot) {
        discordBot.sendMessage(String(trigger.targetId), `Trigger "${trigger.name}" failed: ${errMsg}`).catch(() => {});
      }
    };

    // ── Autonomous triggers: route through the autonomous task executor ──
    if (trigger.autonomous && autonomousExecutor) {
      const userId = trigger.channel === 'telegram'
        ? String(resolveTelegramChatId())
        : `trigger:${trigger.id}`;
      const chatId = trigger.channel === 'telegram'
        ? resolveTelegramChatId()
        : trigger.targetId;

      console.log(`[trigger] Firing autonomous trigger "${trigger.name}"`);
      autonomousExecutor.executeGoal(
        trigger.action,
        userId,
        chatId,
        trigger.channel,
      ).catch((err) => handleTriggerError((err as Error).message));
      return;
    }

    // ── Regular triggers: process through chat pipeline ──
    const deps = { config, sessions, trainingStore, toolRegistry, skillLoader, memoryEngine, strategyEngine, costTracker, responseCache, pipelineHooks, personaManager, discordChannelDirectory };
    processChatMessage(
      {
        message: trigger.action,
        conversationId: `trigger:${trigger.targetId}`,
        source: trigger.channel === 'discord' ? 'discord' : trigger.channel,
      },
      deps,
    ).then(async (result) => {
      if (trigger.channel === 'telegram' && telegramBot) {
        const chatId = resolveTelegramChatId();
        if (result.response) {
          const chunks = splitMessage(result.response, 4096);
          for (const chunk of chunks) {
            await telegramBot.sendMessage(chatId, chunk);
          }
        }
        if (result.generatedFiles?.length) {
          await telegramBot.sendGeneratedFiles(chatId, result.generatedFiles);
        }
      } else if (trigger.channel === 'discord' && discordBot) {
        const channelId = String(trigger.targetId);
        if (result.response) {
          await discordBot.sendMessage(channelId, result.response);
        }
        if (result.generatedFiles?.length) {
          await discordBot.sendFiles(channelId, result.generatedFiles);
        }
      }
    }).catch((err) => handleTriggerError((err as Error).message));
  });

  // System monitor (if enabled)
  let systemMonitor: SystemMonitor | undefined;
  if (config.monitoring?.enabled) {
    systemMonitor = new SystemMonitor(config.monitoring, baseDir);
    systemMonitor.setAlertCallback((message) => {
      // Send alerts to Telegram
      if (telegramBot && config.telegramAllowedUsers.length > 0) {
        for (const userId of config.telegramAllowedUsers) {
          telegramBot!.sendMessage(userId, message).catch(() => {});
        }
      }
      // Send alerts to Discord (linked channels)
      if (discordBot) {
        for (const link of channelLinker.getLinks()) {
          if (link.discordChannelId) {
            discordBot.sendMessage(link.discordChannelId, message).catch(() => {});
          }
        }
      }
    });
    routerDeps.systemMonitor = systemMonitor;
  }

  // Backup manager (if enabled)
  let backupManager: BackupManager | undefined;
  if (config.backup?.enabled) {
    backupManager = new BackupManager(config.backup, baseDir);
    if (systemMonitor) {
      backupManager.setAlertFn((status, errors) => {
        const level = status === 'failed' ? 'critical' as const : 'warning' as const;
        void systemMonitor!.alert(level, `backup_${status}`,
          `Backup ${status}: ${errors.join('; ')}`, { errors });
      });
    }
  }

  routerDeps.backupManager = backupManager;

  // Wire system tools
  if (systemMonitor && backupManager) {
    setSystemServices(systemMonitor, backupManager);
  }

  // Agent profiles for specialist autonomous execution
  const agentRegistry = new AgentRegistry();

  // Shared agent state (used by MCP + parallel autonomous execution)
  const sharedAgentState = new SharedAgentState(
    join(baseDir, 'autonomous', 'shared-state'),
  );

  // Wire autonomous task executor (if enabled)
  let autonomousExecutor: AutonomousTaskExecutor | null = null;
  let taskStore: AutonomousTaskStore | undefined;
  if (config.autonomous?.enabled) {
    const autonomousDir = config.tools.workspaceDir.replace(/workspace\/?$/, 'autonomous');
    taskStore = new AutonomousTaskStore(join(autonomousDir, 'tasks'));
    const auditLogger = new AuditLogger(join(autonomousDir, 'audit'));

    autonomousExecutor = new AutonomousTaskExecutor({
      chatPipelineDeps: { config, sessions, trainingStore, toolRegistry, skillLoader, memoryEngine, strategyEngine, costTracker, responseCache, pipelineHooks, personaManager, discordChannelDirectory },
      approvalManager,
      taskStore,
      auditLogger,
      config: config.autonomous,
      sharedState: sharedAgentState,
      agentRegistry,
      sendProgress: async (chatId, message, channel) => {
        if (channel === 'discord' && discordBot) {
          // Discord-originated task — send directly to the Discord channel/thread
          await discordBot.sendMessage(String(chatId), message);
        } else if (telegramBot) {
          const numericChatId = typeof chatId === 'string' ? Number(chatId) : chatId;
          await telegramBot.sendMessage(numericChatId, message);
        }
        // Cross-channel sync: also send to linked Discord channel for Telegram-originated tasks
        if (channel !== 'discord' && discordBot) {
          const link = channelLinker.getLink(`telegram:${chatId}`);
          if (link?.discordChannelId) {
            discordBot.sendMessage(link.discordChannelId, message).catch(() => {});
          }
        }
      },
      sendReport: (discordBot && config.autonomous?.reportChannelId)
        ? async (report: string) => { await discordBot!.sendMessage(config.autonomous!.reportChannelId!, report); }
        : undefined,
      sendFile: async (chatId, file) => {
        if (telegramBot) {
          const numericChatId = typeof chatId === 'string' ? Number(chatId) : chatId;
          await telegramBot.sendGeneratedFiles(numericChatId, [file]);
        }
        // Also send files to linked Discord channel
        if (discordBot) {
          const link = channelLinker.getLink(`telegram:${chatId}`);
          if (link?.discordChannelId) {
            discordBot.sendFiles(link.discordChannelId, [file]).catch(() => {});
          }
        }
      },
    });

    // Pass the executor to channel bots so they can route autonomous commands
    if (telegramBot) {
      telegramBot.setAutonomousExecutor(autonomousExecutor);
    }
    if (discordBot) {
      discordBot.setAutonomousExecutor(autonomousExecutor);
    }

    // Auto-escalation: when the regular chat tool loop hits its cap, launch an autonomous task
    sharedPipelineDeps.onIterationCapHit = async (ctx: { userId: string; chatId: number | string; channel: string; originalMessage: string; workSummary: string; toolsUsed: string[] }) => {
      const toolList = [...new Set(ctx.toolsUsed)].join(', ');
      const goal = [
        `User request: ${ctx.originalMessage.slice(0, 500)}`,
        '',
        `Work completed so far (before the tool limit was hit):`,
        ctx.workSummary.slice(0, 800),
        '',
        toolList ? `Tools already used: ${toolList}` : '',
        '',
        `Continue and complete this task. Do NOT repeat work already done. Pick up where it left off.`,
      ].filter(Boolean).join('\n');
      const channel = (ctx.channel === 'telegram' || ctx.channel === 'discord' || ctx.channel === 'webchat') ? ctx.channel : 'webchat';
      await autonomousExecutor!.executeGoal(goal, ctx.userId, ctx.chatId, channel as 'telegram' | 'webchat' | 'discord');
    };
  }
  routerDeps.taskStore = taskStore;
  routerDeps.autonomousExecutor = autonomousExecutor;

  routerDeps.telegramBotStatus = () => !!telegramBot;
  routerDeps.discordBotStatus = () => !!discordBot && discordBot.isReady();

  // MCP server (if enabled)
  let mcpServer: OpenClawMcpServer | null = null;
  if (config.mcp?.enabled) {
    mcpServer = new OpenClawMcpServer({
      config: { ...config.mcp, token: config.token },
      memoryEngine,
      toolRegistry,
      toolsConfig: config.tools,
      sharedAgentState,
      getActiveTasks: () => {
        if (!autonomousExecutor) return [];
        return autonomousExecutor.getActiveTaskIds().map((id) => {
          const task = autonomousExecutor!.getActiveTask(id);
          return {
            id,
            goal: task?.goal ?? '',
            status: task?.status ?? 'unknown',
            subtaskCount: task?.subtasks.length ?? 0,
          };
        });
      },
      getTaskDetails: (taskId: string) => {
        if (!autonomousExecutor) return null;
        const task = autonomousExecutor.getActiveTask(taskId);
        if (!task) return null;
        return {
          id: task.id,
          goal: task.goal,
          status: task.status,
          plan: task.plan,
          subtasks: task.subtasks.map((s) => ({
            index: s.index,
            description: s.description,
            status: s.status,
            result: s.result?.slice(0, 500),
            agentProfile: s.agentProfile,
            dependsOn: s.dependsOn,
            outputKey: s.outputKey,
          })),
          budget: task.budget,
          createdAt: task.createdAt,
        };
      },
    });
  }

  routerDeps.mcpPort = config.mcp?.port;

  // Browser bridge (Playwright MCP, if browser tools are allowed)
  let browserBridge: BrowserBridge | null = null;
  const browserToolsAllowed = config.tools.allow?.some((t) =>
    t.startsWith('browse_'),
  ) ?? false;
  if (browserToolsAllowed) {
    browserBridge = new BrowserBridge({
      browser: 'chromium',
      headless: false,
      executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined,
      userDataDir: process.env.BROWSER_USER_DATA_DIR || undefined,
      viewport: { width: 1280, height: 720 },
    });
    setBrowserBridge(browserBridge);
  }

  // Twitter client (agent-twitter-client, if enabled + credentials present)
  let twitterClient: TwitterClient | null = null;
  if (config.twitter?.enabled && config.twitterUsername && config.twitterPassword) {
    twitterClient = new TwitterClient({
      username: config.twitterUsername,
      password: config.twitterPassword,
      email: config.twitterEmail ?? undefined,
      twoFactorSecret: config.twitter2faSecret ?? undefined,
      cookiesPath: config.twitter.cookiesPath,
      proxyUrl: config.twitter.proxyUrl,
    });
    setTwitterClient(twitterClient);
  }
  routerDeps.twitterClientStatus = () => !!twitterClient;
  routerDeps.marketplaceManager = marketplaceManager;

  // Email tools (IMAP/SMTP or browser-based for ProtonMail)
  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    const user = process.env.EMAIL_USER;
    const isProtonMail = user.includes('protonmail') || user.includes('proton.me') || user.includes('pm.me');
    const mode = (process.env.EMAIL_MODE as 'imap' | 'browser') || (isProtonMail ? 'browser' : 'imap');
    const imapPort = Number(process.env.EMAIL_IMAP_PORT) || 993;
    const smtpPort = Number(process.env.EMAIL_SMTP_PORT) || 587;

    setEmailConfig({
      user,
      pass: process.env.EMAIL_PASS,
      fromName: process.env.EMAIL_FROM_NAME || 'MoltBot',
      mode,
      // IMAP settings (only used in imap mode)
      imapHost: process.env.EMAIL_IMAP_HOST || 'imap.gmail.com',
      imapPort,
      smtpHost: process.env.EMAIL_SMTP_HOST || 'smtp.gmail.com',
      smtpPort,
      imapSecure: imapPort === 993,
      smtpSecure: smtpPort === 465,
      // Browser settings (only used in browser mode)
      webmailUrl: process.env.EMAIL_WEBMAIL_URL || (isProtonMail ? 'https://mail.proton.me' : undefined),
    });
    console.log(`[server] Email tools configured for ${user} (${mode} mode)`);
  }

  // Credential vault (encrypted storage for site registrations)
  const masterKey = process.env.OPENCLAW_MASTER_ENCRYPTION_KEY;
  if (masterKey) {
    const vaultPath = join(baseDir, 'vault');
    setVaultConfig(vaultPath, masterKey);
    console.log('[server] Credential vault configured');
  }

  // Marketplace manager (MoltLaunch integration, if enabled)
  let marketplaceManager: MarketplaceManager | null = null;
  if (config.marketplace?.enabled && masterKey) {
    const { credentialGetHandler } = await import('../tools/builtins/credential-vault.js');
    const { credentialStoreHandler } = await import('../tools/builtins/credential-vault.js');

    marketplaceManager = new MarketplaceManager({
      config: config.marketplace,
      baseDir,
      costTracker,
      getCredential: async (site: string) => {
        try {
          const result = await credentialGetHandler({ site }, { workspaceDir: '', memoryDir: '', conversationId: '', userId: 'system', maxExecutionMs: 10_000 });
          if (result.includes('No credentials found')) return null;
          // Parse the password from the result
          const passMatch = result.match(/Password:\s*(.+)/);
          return passMatch ? { password: passMatch[1].trim() } : null;
        } catch { return null; }
      },
      storeCredential: async (site, url, email, password, notes) => {
        await credentialStoreHandler(
          { site, url, email, password, username: 'agent', notes },
          { workspaceDir: '', memoryDir: '', conversationId: '', userId: 'system', maxExecutionMs: 10_000 },
        );
      },
      executeGoal: async (goal, userId, chatId, channel) => {
        if (!autonomousExecutor) throw new Error('Autonomous executor not available');
        return autonomousExecutor.executeGoal(goal, userId, chatId, channel);
      },
      sendNotification: async (message: string) => {
        if (config.marketplace!.reportChannel === 'discord' && discordBot) {
          await discordBot.sendMessage(config.marketplace!.reportTargetId, message);
        } else if (telegramBot) {
          const chatId = Number(config.marketplace!.reportTargetId) || config.telegramAllowedUsers[0];
          if (chatId) await telegramBot.sendMessage(chatId, message);
        }
      },
    });
    setMarketplaceManager(marketplaceManager);
    console.log(`[server] Marketplace configured (mode: ${config.marketplace.automationMode})`);
  }

  return {
    server,
    sessions,
    telegramBot,
    whatsappBot,
    discordBot,
    autonomousExecutor,
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
      // Start Discord bot (non-blocking)
      if (discordBot) {
        discordBot.start().catch((err) => {
          console.error('[discord] Failed to start:', (err as Error).message);
        });
      }
      reminderScheduler.start();
      triggerManager.start();
      if (memoryEngine) memoryEngine.start();
      if (documentMemory) await documentMemory.start();
      if (strategyEngine) strategyEngine.start();
      if (systemMonitor) systemMonitor.start();
      if (backupManager) backupManager.start();
      if (mcpServer) await mcpServer.start();
      // Start browser bridge (non-blocking — don't block boot if Playwright is slow)
      if (browserBridge) {
        browserBridge.start().catch((err) => {
          console.error('[browser-bridge] Failed to start:', (err as Error).message);
        });
      }
      // Start Twitter client (non-blocking — don't block boot if login is slow)
      if (twitterClient) {
        twitterClient.start().catch((err) => {
          console.error('[twitter-client] Failed to start:', (err as Error).message);
        });
      }
      // Start marketplace manager (non-blocking)
      if (marketplaceManager) {
        marketplaceManager.start().catch((err) => {
          console.error('[marketplace] Failed to start:', (err as Error).message);
        });
      }
    },
    async stop() {
      if (marketplaceManager) await marketplaceManager.stop().catch(() => {});
      if (twitterClient) await twitterClient.stop().catch(() => {});
      if (browserBridge) await browserBridge.stop().catch(() => {});
      if (mcpServer) await mcpServer.stop();
      await sharedAgentState.flush();
      if (systemMonitor) systemMonitor.stop();
      if (backupManager) backupManager.stop();
      await costTracker.flush();
      await responseCache.flush();
      if (personaManager) await personaManager.flush();
      if (memoryEngine) memoryEngine.stop();
      if (documentMemory) documentMemory.stop();
      if (memoryDb) memoryDb.close();
      if (strategyEngine) strategyEngine.stop();
      triggerManager.stop();
      reminderScheduler.stop();
      if (discordBot) {
        await discordBot.stop();
      }
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
