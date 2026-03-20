import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GatewayRuntimeConfig } from '../../types/index.js';

function resolveHome(p: string): string {
  if (p.startsWith('~/')) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return p.replace('~', home);
  }
  return p;
}

function parseEnvFile(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    vars[key] = value;
  }
  return vars;
}

export function stripJsonComments(text: string): string {
  return text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

function interpolateVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\$\{(\w+)\}/g, (_, key) => vars[key] ?? '');
}

export async function loadGatewayConfig(
  configDir?: string,
): Promise<GatewayRuntimeConfig> {
  const dir = resolveHome(configDir ?? process.env.OPENCLAW_CONFIG_DIR ?? '~/.openclaw');

  const envContent = await readFile(join(dir, '.env'), 'utf-8');
  const envVars = parseEnvFile(envContent);

  // Populate process.env so tools reading env vars directly (e.g. image generator) work
  for (const [key, value] of Object.entries(envVars)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  const jsonRaw = await readFile(join(dir, 'openclaw.json'), 'utf-8');
  const jsonClean = stripJsonComments(jsonRaw);
  const jsonInterpolated = interpolateVars(jsonClean, envVars);
  const config = JSON.parse(jsonInterpolated);

  return {
    bind: config.gateway?.bind ?? '127.0.0.1',
    port: config.gateway?.port ?? 18789,
    token: config.gateway?.auth?.token ?? envVars.OPENCLAW_GATEWAY_TOKEN ?? '',
    systemPrompt: config.persona?.systemPrompt ?? null,
    channels: config.channels ?? [{ id: 'webchat', enabled: true }],
    telegramBotToken: envVars.TELEGRAM_BOT_TOKEN || null,
    telegramAllowedUsers: config.telegram?.allowedUsers ?? [],
    telegramReactions: {
      processing: config.telegram?.reactions?.processing ?? '\u23f3',
      error: config.telegram?.reactions?.error ?? '\u274c',
    },
    ollama: config.ollama
      ? {
          baseUrl: config.ollama.baseUrl,
          model: config.ollama.model,
          fastModel: config.ollama.fastModel ?? undefined,
          keepAlive: config.ollama.keepAlive ?? undefined,
          numCtx: config.ollama.numCtx ?? undefined,
          numPredict: config.ollama.numPredict ?? undefined,
          extraOptions: config.ollama.options ?? undefined,
        }
      : null,
    anthropicApiKey: envVars.ANTHROPIC_API_KEY ?? null,
    openaiApiKey: envVars.OPENAI_API_KEY ?? null,
    routing: config.routing ?? null,
    training: config.training
      ? {
          enabled: config.training.enabled ?? false,
          dataDir: resolveHome(config.training.dataDir ?? `${dir}/training`),
          autoCollect: config.training.autoCollect ?? true,
          minEntriesForTraining: config.training.minEntries ?? 500,
          autoTrain: config.training.autoTrain ?? false,
          baseModel: config.training.baseModel ?? 'llama3.3:70b',
          loraRank: config.training.loraRank ?? 16,
          epochs: config.training.epochs ?? 3,
        }
      : null,
    tools: {
      deny: config.tools?.deny ?? [],
      allow: config.tools?.allow ?? undefined,
      sandboxMode: config.agents?.sandbox?.mode ?? 'off',
      workspaceDir: resolveHome(config.agents?.workspace ?? `${dir}/workspace`),
      maxExecutionMs: config.agents?.maxExecutionMs ?? 120000,
      allowedProjectDirs: config.tools?.allowedProjectDirs ?? [],
      httpDenyTools: config.tools?.httpDenyTools ?? [
        'run_code',
        'project_write_file',
        'install_package',
        'write_file',
        'project_read_file',
        'send_file',
        'trigger_add',
        'trigger_remove',
        'trigger_toggle',
        'workflow_run',
        'system_backup',
      ],
    },
    session: {
      idleTimeoutMinutes: config.session?.idleTimeoutMinutes ?? 30,
      maxConcurrent: config.session?.maxConcurrent ?? 4,
      persistDir: resolveHome(config.session?.persistDir ?? `${dir}/sessions`),
    },
    autonomous: config.autonomous?.enabled
      ? {
          enabled: true,
          defaultBudget: {
            maxTokens: config.autonomous.budget?.maxTokens ?? 50_000,
            maxApiCalls: config.autonomous.budget?.maxApiCalls ?? 20,
            maxToolCalls: config.autonomous.budget?.maxToolCalls ?? 30,
            maxDurationMs: config.autonomous.budget?.maxDurationMinutes
              ? config.autonomous.budget.maxDurationMinutes * 60_000
              : 10 * 60_000,
            maxSubtasks: config.autonomous.budget?.maxSubtasks ?? 10,
          },
          safetyTierOverrides: config.autonomous.safetyTierOverrides ?? undefined,
          autoApproveModerate: config.autonomous.autoApproveModerate ?? true,
          maxConcurrentTasks: config.autonomous.maxConcurrentTasks ?? 1,
          progressIntervalMs: config.autonomous.progressIntervalMs ?? 60_000,
          planningModel: (config.routing?.mode === 'single' ? config.routing.primary ?? 'ollama' : 'anthropic') as any,
          maxSpawnDepth: config.autonomous.maxSpawnDepth ?? 1,
          reportChannelId: config.autonomous.reportChannelId ?? undefined,
        }
      : null,
    compaction: {
      enabled: config.compaction?.enabled ?? true,
      triggerThreshold: config.compaction?.triggerThreshold ?? 0.75,
      keepRecentCount: config.compaction?.keepRecentCount ?? 10,
      summaryMaxTokens: config.compaction?.summaryMaxTokens ?? 500,
      provider: config.compaction?.provider ?? 'ollama',
    },
    skills: config.skills?.enabled
      ? {
          enabled: true,
          skillsDir: resolveHome(config.skills.skillsDir ?? `${dir}/skills`),
          maxActiveSkills: config.skills.maxActiveSkills ?? 2,
        }
      : null,
    memory: config.memory?.enabled
      ? {
          enabled: true,
          embeddingModel: config.memory.embeddingModel ?? 'nomic-embed-text',
          extractionProvider: config.memory.extractionProvider ?? 'ollama',
          maxMemoriesPerUser: config.memory.maxMemoriesPerUser ?? 500,
          autoExtract: config.memory.autoExtract ?? true,
          autoInject: config.memory.autoInject ?? true,
          injectionTokenBudget: config.memory.injectionTokenBudget ?? 800,
          consolidationIntervalMs:
            (config.memory.consolidationIntervalHours ?? 6) * 60 * 60 * 1000,
          decayRate: config.memory.decayRate ?? 0.02,
          mergeThreshold: config.memory.mergeThreshold ?? 0.92,
          minStrength: config.memory.minStrength ?? 0.1,
          searchDefaults: {
            maxResults: config.memory.searchDefaults?.maxResults ?? 10,
            semanticWeight: config.memory.searchDefaults?.semanticWeight ?? 0.5,
            lexicalWeight: config.memory.searchDefaults?.lexicalWeight ?? 0.3,
            symbolicWeight: config.memory.searchDefaults?.symbolicWeight ?? 0.2,
          },
          sqlite: {
            enabled: config.memory.sqlite?.enabled ?? true,
            dbPath: config.memory.sqlite?.dbPath,
          },
        }
      : null,
    strategies: config.strategies?.enabled
      ? {
          enabled: true,
          storageDir: resolveHome(config.strategies.storageDir ?? `${dir}/strategies`),
          extractionProvider: config.strategies.extractionProvider ?? 'ollama',
          autoExtract: config.strategies.autoExtract ?? true,
          autoInject: config.strategies.autoInject ?? true,
          injectionTokenBudget: config.strategies.injectionTokenBudget ?? 200,
          maxStrategiesPerUser: config.strategies.maxStrategiesPerUser ?? 100,
          maxGeneralStrategies: config.strategies.maxGeneralStrategies ?? 15,
          maxPerClassification: config.strategies.maxPerClassification ?? 20,
          consolidationIntervalMs:
            (config.strategies.consolidationIntervalHours ?? 12) * 60 * 60 * 1000,
          minStrength: config.strategies.minStrength ?? 0.15,
          mergeThreshold: config.strategies.mergeThreshold ?? 0.90,
          minSuccessRate: config.strategies.minSuccessRate ?? 0.3,
        }
      : null,
    monitoring: config.monitoring?.enabled
      ? {
          enabled: true,
          metricsIntervalMs: config.monitoring.metricsIntervalMs ?? 60_000,
          alertThresholds: {
            diskUsagePercent: config.monitoring.alertThresholds?.diskUsagePercent ?? 90,
            errorRatePerMinute: config.monitoring.alertThresholds?.errorRatePerMinute ?? 10,
          },
        }
      : null,
    backup: config.backup?.enabled
      ? {
          enabled: true,
          intervalMs: config.backup.intervalMs ?? 21_600_000,
          retentionDays: config.backup.retentionDays ?? 7,
          includeSessions: config.backup.includeSessions ?? false,
          includeCache: config.backup.includeCache ?? false,
        }
      : null,
    mcp: config.mcp?.enabled
      ? {
          enabled: true,
          transport: config.mcp.transport ?? 'sse',
          port: config.mcp.port ?? 18790,
          exposedTools: config.mcp.exposedTools ?? undefined,
          exposeMemory: config.mcp.exposeMemory ?? true,
          exposeAgentState: config.mcp.exposeAgentState ?? true,
        }
      : null,
    personas: config.personas?.enabled
      ? {
          enabled: true,
          defaultPersonaId: config.personas.defaultPersonaId ?? 'default',
          definitions: (config.personas.definitions ?? []).map((d: any) => ({
            id: d.id,
            name: d.name,
            description: d.description ?? '',
            // Fall back to the base persona.systemPrompt if persona has no own prompt
            systemPrompt: d.systemPrompt || config.persona?.systemPrompt || '',
            preferredVoice: d.preferredVoice ?? undefined,
          })),
        }
      : null,
    whisperApiKey: envVars.WHISPER_API_KEY || envVars.HF_TOKEN || envVars.GROQ_API_KEY || envVars.OPENAI_API_KEY || null,
    whisperApiUrl: resolveWhisperUrl(envVars),
    whisperModel: resolveWhisperModel(envVars),
    whisperProvider: resolveWhisperProvider(envVars),
    whatsappAccessToken: envVars.WHATSAPP_ACCESS_TOKEN || null,
    whatsappPhoneNumberId: envVars.WHATSAPP_PHONE_NUMBER_ID || null,
    whatsappVerifyToken: envVars.WHATSAPP_VERIFY_TOKEN || null,
    whatsappAllowedNumbers: config.whatsapp?.allowedNumbers ?? [],
    sdApiUrl: envVars.SD_API_URL || null,
    twitter: config.twitter?.enabled
      ? {
          enabled: true,
          cookiesPath: resolveHome(config.twitter.cookiesPath ?? `${dir}/twitter/cookies.json`),
          proxyUrl: envVars.TWITTER_PROXY_URL || config.twitter.proxyUrl || undefined,
        }
      : null,
    twitterUsername: envVars.TWITTER_USERNAME || null,
    twitterPassword: envVars.TWITTER_PASSWORD || null,
    twitterEmail: envVars.TWITTER_EMAIL || null,
    twitter2faSecret: envVars.TWITTER_2FA_SECRET || null,
    // --- Discord ---
    discordBotToken: envVars.DISCORD_BOT_TOKEN || null,
    discordAppId: envVars.DISCORD_APP_ID || null,
    discordAllowedGuilds: config.discord?.allowedGuilds ?? [],
    discordAutoRespond: config.discord?.autoRespond ?? false,
    discordAutoArchiveDuration: config.discord?.autoArchiveDuration ?? null,
    // --- Cross-Channel Sync ---
    crossChannel: config.crossChannel?.links?.length
      ? {
          links: (config.crossChannel.links as any[]).map((l: any) => ({
            canonicalId: l.canonicalId,
            aliases: l.aliases ?? [],
            telegramChatId: l.telegramChatId ?? undefined,
            discordGuildId: l.discordGuildId ?? undefined,
            discordChannelId: l.discordChannelId ?? undefined,
          })),
        }
      : null,
    // --- Streaming ---
    telegramStreaming: {
      enabled: config.telegram?.streaming !== false,
      throttleMs: config.telegram?.streaming?.throttleMs ?? 1500,
      minCharsBeforeFirstSend: config.telegram?.streaming?.minCharsBeforeFirstSend ?? 20,
      minCharsBeforeEdit: config.telegram?.streaming?.minCharsBeforeEdit ?? 40,
      useDraftForDMs: config.telegram?.streaming?.useDraftForDMs ?? true,
    },
    discordStreaming: {
      enabled: config.discord?.streaming !== false,
      throttleMs: config.discord?.streaming?.throttleMs ?? 1500,
      minCharsBeforeFirstSend: config.discord?.streaming?.minCharsBeforeFirstSend ?? 20,
      minCharsBeforeEdit: config.discord?.streaming?.minCharsBeforeEdit ?? 40,
    },
    // --- Marketplace ---
    marketplace: config.marketplace?.enabled
      ? {
          enabled: true,
          automationMode: config.marketplace.automationMode ?? 'supervised',
          approvalThresholdEth: config.marketplace.approvalThresholdEth ?? 0.01,
          basePriceEth: config.marketplace.basePriceEth ?? 0.015,
          maxPriceEth: config.marketplace.maxPriceEth ?? 0.5,
          profitMargin: config.marketplace.profitMargin ?? 2.0,
          ethPriceUsd: config.marketplace.ethPriceUsd ?? 2500,
          advertisedSkills: config.marketplace.advertisedSkills ?? [],
          agentDescription: config.marketplace.agentDescription ?? 'OpenClaw autonomous AI agent',
          wsReconnectMs: config.marketplace.wsReconnectMs ?? 5000,
          pollIntervalMs: config.marketplace.pollIntervalMs ?? 300000,
          maxConcurrentTasks: config.marketplace.maxConcurrentTasks ?? 2,
          reportChannel: config.marketplace.reportChannel ?? 'telegram',
          reportTargetId: config.marketplace.reportTargetId ?? String(config.telegram?.allowedUsers?.[0] ?? ''),
          studyIntervalHours: config.marketplace.studyIntervalHours ?? 24,
        }
      : null,
    // --- Document Memory ---
    documentMemory: config.documentMemory?.enabled
      ? {
          enabled: true,
          autoInject: config.documentMemory.autoInject ?? true,
          soulTokenBudget: config.documentMemory.soulTokenBudget ?? 600,
          memoryTokenBudget: config.documentMemory.memoryTokenBudget ?? 800,
          tasksTokenBudget: config.documentMemory.tasksTokenBudget ?? 400,
          memoryMaxBytes: config.documentMemory.memoryMaxBytes ?? 8192,
          tasksMaxBytes: config.documentMemory.tasksMaxBytes ?? 4096,
          activityLogging: config.documentMemory.activityLogging ?? true,
          activityRetentionDays: config.documentMemory.activityRetentionDays ?? 30,
        }
      : null,
  };
}

// --- Whisper provider resolution (priority: WHISPER > GROQ > HF > OPENAI) ---

// Priority: WHISPER_API_KEY > HF_TOKEN > GROQ_API_KEY > OPENAI_API_KEY

function resolveWhisperProvider(env: Record<string, string>): 'openai' | 'huggingface' {
  if (env.WHISPER_API_KEY || env.OPENAI_API_KEY) return 'openai';
  if (env.HF_TOKEN) return 'huggingface';
  if (env.GROQ_API_KEY) return 'openai'; // Groq is OpenAI-compatible
  return 'openai';
}

function resolveWhisperUrl(env: Record<string, string>): string {
  if (env.WHISPER_API_KEY) return 'https://api.openai.com/v1/audio/transcriptions';
  if (env.HF_TOKEN) return ''; // HF constructs URL from model name
  if (env.GROQ_API_KEY) return 'https://api.groq.com/openai/v1/audio/transcriptions';
  return 'https://api.openai.com/v1/audio/transcriptions';
}

function resolveWhisperModel(env: Record<string, string>): string {
  if (env.WHISPER_API_KEY || env.OPENAI_API_KEY) return 'whisper-1';
  if (env.HF_TOKEN) return 'openai/whisper-large-v3-turbo';
  if (env.GROQ_API_KEY) return 'whisper-large-v3-turbo';
  return 'whisper-1';
}
