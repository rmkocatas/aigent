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

function stripJsonComments(text: string): string {
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
  const dir = resolveHome(configDir ?? '~/.openclaw');

  const envContent = await readFile(join(dir, '.env'), 'utf-8');
  const envVars = parseEnvFile(envContent);

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
    ollama: config.ollama
      ? { baseUrl: config.ollama.baseUrl, model: config.ollama.model }
      : null,
    anthropicApiKey: envVars.ANTHROPIC_API_KEY ?? null,
    routing: config.routing ?? null,
    training: config.training
      ? {
          enabled: config.training.enabled ?? false,
          dataDir: resolveHome(config.training.dataDir ?? '~/.openclaw/training'),
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
      workspaceDir: resolveHome(config.agents?.workspace ?? '~/.openclaw/workspace'),
      maxExecutionMs: config.agents?.maxExecutionMs ?? 30000,
      allowedProjectDirs: config.tools?.allowedProjectDirs ?? [],
    },
    session: {
      idleTimeoutMinutes: config.session?.idleTimeoutMinutes ?? 30,
      maxConcurrent: config.session?.maxConcurrent ?? 4,
      persistDir: resolveHome(config.session?.persistDir ?? '~/.openclaw/sessions'),
    },
    whisperApiKey: envVars.WHISPER_API_KEY || envVars.OPENAI_API_KEY || null,
  };
}
