/**
 * Admin REST API handlers for the MoltBot/OpenClaw management dashboard.
 * All endpoints are behind /api/admin/ and require Bearer token auth.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { HandlerDeps } from './handlers.js';
import { readBody } from './handlers.js';
import { stripJsonComments } from './config-loader.js';
import type { AutonomousTaskStore } from '../services/autonomous/task-store.js';
import type { AutonomousTaskExecutor } from '../services/autonomous/task-executor.js';
import type { EventTriggerManager } from '../services/event-triggers.js';
import type { SystemMonitor } from '../services/system-monitor.js';
import type { BackupManager } from '../services/backup-manager.js';
import type { MarketplaceManager } from '../services/marketplace/marketplace-manager.js';
import { redactSensitive } from '../services/log-redactor.js';

// ── Extended deps for admin routes ──────────────────────────────────

export interface AdminHandlerDeps extends HandlerDeps {
  taskStore?: AutonomousTaskStore;
  autonomousExecutor?: AutonomousTaskExecutor | null;
  triggerManager?: EventTriggerManager;
  systemMonitor?: SystemMonitor;
  backupManager?: BackupManager;
  configDir: string;
  telegramBotStatus?: () => boolean;
  discordBotStatus?: () => boolean;
  twitterClientStatus?: () => boolean;
  mcpPort?: number;
  marketplaceManager?: MarketplaceManager | null;
}

// ── Utility functions ───────────────────────────────────────────────

function matchPath(
  pattern: string,
  pathname: string,
): Record<string, string> | null {
  const patternParts = pattern.split('/');
  const pathParts = pathname.split('/');
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

function send(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function sendError(res: ServerResponse, status: number, error: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: redactSensitive(error) }));
}

function requireService<T>(
  res: ServerResponse,
  service: T | undefined | null,
  name: string,
): service is T {
  if (!service) {
    sendError(res, 503, `${name} is not enabled`);
    return false;
  }
  return true;
}

function parseQuery(req: IncomingMessage): URLSearchParams {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  return url.searchParams;
}

// ── Config section mapping ──────────────────────────────────────────

const CONFIG_SECTIONS: Record<string, string> = {
  persona: 'persona',
  routing: 'routing',
  tools: 'tools',
  session: 'session',
  autonomous: 'autonomous',
  compaction: 'compaction',
  memory: 'memory',
  strategies: 'strategies',
  monitoring: 'monitoring',
  backup: 'backup',
  mcp: 'mcp',
  personas: 'personas',
  training: 'training',
  telegram: 'telegram',
  skills: 'skills',
  twitter: 'twitter',
  logging: 'logging',
  marketplace: 'marketplace',
};

const REDACTED_KEYS = new Set([
  'token', 'anthropicApiKey', 'telegramBotToken', 'groqApiKey',
  'cookiesPath', 'twitterPassword', 'twitter2faSecret', 'twitterEmail',
  'whatsappAccessToken', 'whisperApiKey', 'sdApiUrl',
  'openaiApiKey', 'hfToken', 'huggingfaceToken', 'discordBotToken',
  'discordAppId', 'browserExecutablePath', 'browserUserDataDir',
  'password', 'secret', 'credential', 'apiKey', 'apiSecret', 'privateKey',
]);

function redactConfig(obj: unknown, depth = 0): unknown {
  if (depth > 5 || obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return obj;
  if (Array.isArray(obj)) return obj.map((v) => redactConfig(v, depth + 1));
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (REDACTED_KEYS.has(k) && typeof v === 'string' && v.length > 0) {
        result[k] = '***REDACTED***';
      } else {
        result[k] = redactConfig(v, depth + 1);
      }
    }
    return result;
  }
  return obj;
}

// ── Available models list ───────────────────────────────────────────

const ANTHROPIC_MODELS = [
  'claude-opus-4-6',
  'claude-sonnet-4-5-20250929',
  'claude-haiku-4-5-20251001',
];

async function getOllamaModels(baseUrl: string | undefined): Promise<string[]> {
  if (!baseUrl) return [];
  try {
    const resp = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok) return [];
    const data = await resp.json() as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

// ── Directory scanner for memory/strategy user listing ──────────────

async function listSubdirectories(dirPath: string): Promise<string[]> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function dirSize(dirPath: string): Promise<number> {
  try {
    const entries = await readdir(dirPath);
    let total = 0;
    for (const entry of entries) {
      const s = await stat(join(dirPath, entry)).catch(() => null);
      if (s?.isFile()) total += s.size;
    }
    return total;
  } catch {
    return 0;
  }
}

async function safeReadJson(filePath: string): Promise<unknown[]> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ── Main admin route dispatcher ─────────────────────────────────────

export async function handleAdminRoute(
  method: string,
  path: string,
  req: IncomingMessage,
  res: ServerResponse,
  deps: AdminHandlerDeps,
): Promise<void> {
  try {
    let params: Record<string, string> | null;

    // ═══ TASKS ═══
    if (method === 'GET' && path === '/api/admin/tasks') return handleTaskList(req, res, deps);
    if (method === 'POST' && path === '/api/admin/tasks') return handleTaskCreate(req, res, deps);
    if (method === 'GET' && path === '/api/admin/tasks/kill-switch/status') return handleKillSwitchStatus(res, deps);
    if (method === 'POST' && path === '/api/admin/tasks/kill-switch') return handleKillSwitch(res, deps);
    if (method === 'POST' && path === '/api/admin/tasks/kill-switch/reset') return handleKillSwitchReset(res, deps);
    params = matchPath('/api/admin/tasks/:id/kill', path);
    if (params && method === 'POST') return handleTaskKill(res, deps, params.id);
    params = matchPath('/api/admin/tasks/:id', path);
    if (params && method === 'GET') return handleTaskGet(res, deps, params.id);

    // ═══ TRIGGERS ═══
    if (method === 'GET' && path === '/api/admin/triggers') return handleTriggerList(res, deps);
    if (method === 'POST' && path === '/api/admin/triggers') return handleTriggerCreate(req, res, deps);
    params = matchPath('/api/admin/triggers/:id', path);
    if (params && method === 'PATCH') return handleTriggerUpdate(req, res, deps, params.id);
    if (params && method === 'DELETE') return handleTriggerDelete(res, deps, params.id);

    // ═══ COSTS ═══
    if (method === 'GET' && path === '/api/admin/costs') return handleCosts(req, res, deps);

    // ═══ SYSTEM ═══
    if (method === 'GET' && path === '/api/admin/system/status') return handleSystemStatus(res, deps);
    if (method === 'GET' && path === '/api/admin/system/alerts') return handleSystemAlerts(req, res, deps);
    if (method === 'GET' && path === '/api/admin/system/health') return handleSystemHealth(res, deps);
    if (method === 'GET' && path === '/api/admin/system/cache') return handleSystemCache(res, deps);

    // ═══ BACKUPS ═══
    if (method === 'GET' && path === '/api/admin/backups') return handleBackupList(res, deps);
    if (method === 'GET' && path === '/api/admin/backups/last') return handleBackupLast(res, deps);
    if (method === 'POST' && path === '/api/admin/backups') return handleBackupRun(res, deps);

    // ═══ CONFIG ═══
    if (method === 'GET' && path === '/api/admin/config/full') return handleConfigFull(res, deps);
    params = matchPath('/api/admin/config/:section', path);
    if (params && method === 'GET') return handleConfigSection(res, deps, params.section);
    if (params && method === 'PATCH') return handleConfigPatch(req, res, deps, params.section);

    // ═══ ROUTING / MODEL SHIFTING ═══
    if (method === 'GET' && path === '/api/admin/routing') return handleRoutingGet(res, deps);
    if (method === 'PATCH' && path === '/api/admin/routing') return handleRoutingPatch(req, res, deps);

    // ═══ SKILLS ═══
    if (method === 'GET' && path === '/api/admin/skills') return handleSkillList(res, deps);
    params = matchPath('/api/admin/skills/:name/manifest', path);
    if (params && method === 'PUT') return handleSkillManifestUpdate(req, res, deps, params.name);
    params = matchPath('/api/admin/skills/:name/instructions', path);
    if (params && method === 'PUT') return handleSkillInstructionsUpdate(req, res, deps, params.name);
    params = matchPath('/api/admin/skills/:name', path);
    if (params && method === 'GET') return handleSkillGet(res, deps, params.name);

    // ═══ MEMORY ═══
    if (method === 'GET' && path === '/api/admin/memory') return handleMemoryUserList(res, deps);
    params = matchPath('/api/admin/memory/:userId/search', path);
    if (params && method === 'GET') return handleMemorySearch(req, res, deps, params.userId);
    params = matchPath('/api/admin/memory/:userId/consolidate', path);
    if (params && method === 'POST') return handleMemoryConsolidate(res, deps, params.userId);
    params = matchPath('/api/admin/memory/:userId/stats', path);
    if (params && method === 'GET') return handleMemoryStats(res, deps, params.userId);
    params = matchPath('/api/admin/memory/:userId/:memoryId', path);
    if (params && method === 'DELETE') return handleMemoryForget(res, deps, params.userId, params.memoryId);
    params = matchPath('/api/admin/memory/:userId', path);
    if (params && method === 'GET') return handleMemoryLayers(res, deps, params.userId);
    if (params && method === 'POST') return handleMemoryRemember(req, res, deps, params.userId);

    // ═══ STRATEGIES ═══
    if (method === 'GET' && path === '/api/admin/strategies') return handleStrategyUserList(res, deps);
    params = matchPath('/api/admin/strategies/:userId/consolidate', path);
    if (params && method === 'POST') return handleStrategyConsolidate(res, deps, params.userId);
    params = matchPath('/api/admin/strategies/:userId/:classification', path);
    if (params && method === 'GET') return handleStrategyBucket(res, deps, params.userId, params.classification);
    if (params && method === 'DELETE') return handleStrategyDelete(res, deps, params.userId, params.classification);
    params = matchPath('/api/admin/strategies/:userId', path);
    if (params && method === 'GET') return handleStrategyAll(res, deps, params.userId);

    // ═══ PERSONAS ═══
    if (method === 'GET' && path === '/api/admin/personas') return handlePersonaList(res, deps);
    params = matchPath('/api/admin/personas/:chatId/voice/toggle', path);
    if (params && method === 'POST') return handlePersonaVoiceToggle(res, deps, params.chatId);
    params = matchPath('/api/admin/personas/:chatId/voice', path);
    if (params && method === 'GET') return handlePersonaVoice(res, deps, params.chatId);
    params = matchPath('/api/admin/personas/:chatId/switch', path);
    if (params && method === 'POST') return handlePersonaSwitch(req, res, deps, params.chatId);
    params = matchPath('/api/admin/personas/:chatId/reset', path);
    if (params && method === 'POST') return handlePersonaReset(res, deps, params.chatId);
    params = matchPath('/api/admin/personas/:chatId/active', path);
    if (params && method === 'GET') return handlePersonaActive(res, deps, params.chatId);

    // ═══ TOOLS ═══
    if (method === 'GET' && path === '/api/admin/tools') return handleToolList(res, deps);
    if (method === 'GET' && path === '/api/admin/tools/available') return handleToolAvailable(res, deps);
    if (method === 'GET' && path === '/api/admin/tools/filtered') return handleToolFiltered(req, res, deps);

    // ═══ SESSIONS ═══
    if (method === 'GET' && path === '/api/admin/sessions') return handleSessionList(res, deps);
    params = matchPath('/api/admin/sessions/:id/reset', path);
    if (params && method === 'POST') return handleSessionReset(res, deps, params.id);
    params = matchPath('/api/admin/sessions/:id', path);
    if (params && method === 'GET') return handleSessionGet(res, deps, params.id);

    // ═══ MARKETPLACE ═══
    if (method === 'GET' && path === '/api/admin/marketplace/status') return handleMarketplaceStatus(res, deps);
    if (method === 'GET' && path === '/api/admin/marketplace/tasks') return handleMarketplaceTasks(res, deps);
    if (method === 'GET' && path === '/api/admin/marketplace/earnings') return handleMarketplaceEarnings(req, res, deps);
    if (method === 'PATCH' && path === '/api/admin/marketplace/mode') return handleMarketplaceMode(req, res, deps);
    if (method === 'GET' && path === '/api/admin/marketplace/feedback') return handleMarketplaceFeedback(res, deps);

    // 404 within admin namespace
    sendError(res, 404, 'Admin endpoint not found');
  } catch (err) {
    if (!res.headersSent) {
      sendError(res, 500, (err as Error).message);
    }
  }
}

// ── TASK HANDLERS ───────────────────────────────────────────────────

async function handleTaskList(req: IncomingMessage, res: ServerResponse, deps: AdminHandlerDeps): Promise<void> {
  if (!requireService(res, deps.taskStore, 'Autonomous system')) return;
  const query = parseQuery(req);
  const statusFilter = query.get('status');
  let tasks = await deps.taskStore.loadAll();
  if (statusFilter) tasks = tasks.filter((t) => t.status === statusFilter);
  send(res, 200, { tasks });
}

async function handleTaskGet(res: ServerResponse, deps: AdminHandlerDeps, id: string): Promise<void> {
  if (!requireService(res, deps.taskStore, 'Autonomous system')) return;
  const task = await deps.taskStore.load(id);
  if (!task) return sendError(res, 404, `Task ${id} not found`);
  send(res, 200, task);
}

async function handleTaskCreate(req: IncomingMessage, res: ServerResponse, deps: AdminHandlerDeps): Promise<void> {
  if (!requireService(res, deps.autonomousExecutor, 'Autonomous executor')) return;
  const body = JSON.parse(await readBody(req));
  if (!body.goal || typeof body.goal !== 'string') return sendError(res, 400, 'Missing goal');
  const task = await deps.autonomousExecutor.executeGoal(
    body.goal,
    body.userId ?? 'admin',
    body.chatId ?? 'admin-dashboard',
    body.channel ?? 'webchat',
  );
  send(res, 201, { task: { id: task.id, goal: task.goal, status: task.status } });
}

function handleTaskKill(res: ServerResponse, deps: AdminHandlerDeps, id: string): void {
  if (!requireService(res, deps.autonomousExecutor, 'Autonomous executor')) return;
  const success = deps.autonomousExecutor.killTask(id);
  send(res, 200, { success });
}

function handleKillSwitch(res: ServerResponse, deps: AdminHandlerDeps): void {
  if (!requireService(res, deps.autonomousExecutor, 'Autonomous executor')) return;
  const killed = deps.autonomousExecutor.killSwitch();
  send(res, 200, { killed });
}

function handleKillSwitchReset(res: ServerResponse, deps: AdminHandlerDeps): void {
  if (!requireService(res, deps.autonomousExecutor, 'Autonomous executor')) return;
  deps.autonomousExecutor.resetKillSwitch();
  send(res, 200, { success: true });
}

function handleKillSwitchStatus(res: ServerResponse, deps: AdminHandlerDeps): void {
  if (!requireService(res, deps.autonomousExecutor, 'Autonomous executor')) return;
  send(res, 200, { active: deps.autonomousExecutor.isKillSwitchActive() });
}

// ── TRIGGER HANDLERS ────────────────────────────────────────────────

async function handleTriggerList(res: ServerResponse, deps: AdminHandlerDeps): Promise<void> {
  if (!requireService(res, deps.triggerManager, 'Trigger manager')) return;
  const triggers = await deps.triggerManager.loadTriggers();
  send(res, 200, { triggers });
}

async function handleTriggerCreate(req: IncomingMessage, res: ServerResponse, deps: AdminHandlerDeps): Promise<void> {
  if (!requireService(res, deps.triggerManager, 'Trigger manager')) return;
  const body = JSON.parse(await readBody(req));
  if (!body.name || !body.schedule || !body.action) {
    return sendError(res, 400, 'Missing required fields: name, schedule, action');
  }
  const trigger = await deps.triggerManager.addTrigger({
    id: body.id ?? crypto.randomUUID().slice(0, 8),
    name: body.name,
    enabled: body.enabled !== false,
    schedule: body.schedule,
    action: body.action,
    channel: body.channel ?? 'telegram',
    targetId: body.targetId ?? deps.config.telegramAllowedUsers[0] ?? 0,
  });
  send(res, 201, { trigger });
}

async function handleTriggerUpdate(req: IncomingMessage, res: ServerResponse, deps: AdminHandlerDeps, id: string): Promise<void> {
  if (!requireService(res, deps.triggerManager, 'Trigger manager')) return;
  const body = JSON.parse(await readBody(req));
  if (typeof body.enabled === 'boolean') {
    const success = await deps.triggerManager.toggleTrigger(id, body.enabled);
    if (!success) return sendError(res, 404, `Trigger ${id} not found`);
  }
  // Support updating other fields by rewriting the trigger
  if (body.name || body.schedule || body.action) {
    const triggers = await deps.triggerManager.loadTriggers();
    const idx = triggers.findIndex((t) => t.id === id);
    if (idx === -1) return sendError(res, 404, `Trigger ${id} not found`);
    if (body.name) triggers[idx].name = body.name;
    if (body.schedule) triggers[idx].schedule = body.schedule;
    if (body.action) triggers[idx].action = body.action;
    if (body.channel) triggers[idx].channel = body.channel;
    if (body.targetId !== undefined) triggers[idx].targetId = body.targetId;
    await deps.triggerManager.saveTriggers(triggers);
  }
  send(res, 200, { success: true });
}

async function handleTriggerDelete(res: ServerResponse, deps: AdminHandlerDeps, id: string): Promise<void> {
  if (!requireService(res, deps.triggerManager, 'Trigger manager')) return;
  const success = await deps.triggerManager.removeTrigger(id);
  if (!success) return sendError(res, 404, `Trigger ${id} not found`);
  send(res, 200, { success: true });
}

// ── COST HANDLER ────────────────────────────────────────────────────

async function handleCosts(req: IncomingMessage, res: ServerResponse, deps: AdminHandlerDeps): Promise<void> {
  if (!requireService(res, deps.costTracker, 'Cost tracker')) return;
  const query = parseQuery(req);
  const period = query.get('period') as 'today' | 'week' | 'month' | 'all' ?? 'month';
  const summary = await deps.costTracker.getSummary(period);
  send(res, 200, summary);
}

// ── SYSTEM HANDLERS ─────────────────────────────────────────────────

function handleSystemStatus(res: ServerResponse, deps: AdminHandlerDeps): void {
  if (!requireService(res, deps.systemMonitor, 'System monitor')) return;
  const status = deps.systemMonitor.getStatus();
  send(res, 200, status ?? { error: 'No metrics collected yet' });
}

function handleSystemAlerts(req: IncomingMessage, res: ServerResponse, deps: AdminHandlerDeps): void {
  if (!requireService(res, deps.systemMonitor, 'System monitor')) return;
  const query = parseQuery(req);
  const count = parseInt(query.get('count') ?? '20', 10);
  const alerts = deps.systemMonitor.getRecentAlerts(count);
  send(res, 200, { alerts });
}

async function handleSystemHealth(res: ServerResponse, deps: AdminHandlerDeps): Promise<void> {
  const mem = process.memoryUsage();
  const result: Record<string, unknown> = {
    gateway: {
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      memoryMB: Math.round(mem.rss / 1024 / 1024),
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
    },
  };

  // Ping Ollama (free, no GPU load)
  const ollamaUrl = deps.config.ollama?.baseUrl;
  if (ollamaUrl) {
    try {
      const resp = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (resp.ok) {
        const data = await resp.json() as { models?: Array<{ name: string }> };
        result.ollama = { status: 'ok', models: (data.models ?? []).map((m) => m.name) };
      } else {
        result.ollama = { status: 'error', code: resp.status };
      }
    } catch {
      result.ollama = { status: 'unreachable' };
    }
  }

  // Telegram status
  if (deps.telegramBotStatus) {
    result.telegram = { status: 'ok', polling: deps.telegramBotStatus() };
  }

  // Discord status
  if (deps.discordBotStatus) {
    result.discord = { status: 'ok', connected: deps.discordBotStatus() };
  }

  // Twitter status
  if (deps.twitterClientStatus) {
    result.twitter = { status: 'ok', connected: deps.twitterClientStatus() };
  }

  // MCP status
  if (deps.mcpPort) {
    result.mcp = { status: 'ok', port: deps.mcpPort };
  }

  send(res, 200, result);
}

function handleSystemCache(res: ServerResponse, deps: AdminHandlerDeps): void {
  if (!requireService(res, deps.responseCache, 'Response cache')) return;
  send(res, 200, deps.responseCache.getStats());
}

// ── BACKUP HANDLERS ─────────────────────────────────────────────────

async function handleBackupList(res: ServerResponse, deps: AdminHandlerDeps): Promise<void> {
  if (!requireService(res, deps.backupManager, 'Backup manager')) return;
  const backups = await deps.backupManager.getBackupHistory();
  send(res, 200, { backups });
}

function handleBackupLast(res: ServerResponse, deps: AdminHandlerDeps): void {
  if (!requireService(res, deps.backupManager, 'Backup manager')) return;
  const last = deps.backupManager.getLastBackup();
  send(res, 200, last ?? { message: 'No backups yet' });
}

async function handleBackupRun(res: ServerResponse, deps: AdminHandlerDeps): Promise<void> {
  if (!requireService(res, deps.backupManager, 'Backup manager')) return;
  const result = await deps.backupManager.runBackup();
  send(res, 200, result);
}

// ── CONFIG HANDLERS ─────────────────────────────────────────────────

async function handleConfigFull(res: ServerResponse, deps: AdminHandlerDeps): Promise<void> {
  try {
    const raw = await readFile(join(deps.configDir, 'openclaw.json'), 'utf-8');
    const clean = stripJsonComments(raw);
    const config = JSON.parse(clean);
    send(res, 200, redactConfig(config));
  } catch (err) {
    sendError(res, 500, `Failed to read config: ${(err as Error).message}`);
  }
}

async function handleConfigSection(res: ServerResponse, deps: AdminHandlerDeps, section: string): Promise<void> {
  const key = CONFIG_SECTIONS[section];
  if (!key) return sendError(res, 400, `Unknown config section: ${section}. Valid: ${Object.keys(CONFIG_SECTIONS).join(', ')}`);
  try {
    const raw = await readFile(join(deps.configDir, 'openclaw.json'), 'utf-8');
    const clean = stripJsonComments(raw);
    const config = JSON.parse(clean);
    send(res, 200, redactConfig(config[key] ?? {}));
  } catch (err) {
    sendError(res, 500, `Failed to read config: ${(err as Error).message}`);
  }
}

async function handleConfigPatch(req: IncomingMessage, res: ServerResponse, deps: AdminHandlerDeps, section: string): Promise<void> {
  const key = CONFIG_SECTIONS[section];
  if (!key) return sendError(res, 400, `Unknown config section: ${section}`);

  const body = JSON.parse(await readBody(req));
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return sendError(res, 400, 'Patch body must be a plain object');

  // Prototype pollution protection — reject dangerous keys
  const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  for (const k of Object.keys(body)) {
    if (FORBIDDEN_KEYS.has(k)) {
      return sendError(res, 400, `Forbidden key in patch body: "${k}"`);
    }
  }

  const configPath = join(deps.configDir, 'openclaw.json');
  try {
    const raw = await readFile(configPath, 'utf-8');
    const clean = stripJsonComments(raw);
    const config = JSON.parse(clean);

    // Backup before writing
    const backupName = `openclaw.json.backup.${Date.now()}`;
    await writeFile(join(deps.configDir, backupName), raw, 'utf-8');

    // Safe merge — only copy own properties, skip prototype-polluting keys
    const existing = config[key] ?? {};
    const merged: Record<string, unknown> = { ...existing };
    for (const [k, v] of Object.entries(body)) {
      if (Object.prototype.hasOwnProperty.call(body, k) && !FORBIDDEN_KEYS.has(k)) {
        merged[k] = v;
      }
    }
    config[key] = merged;

    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
    send(res, 200, {
      success: true,
      section,
      backup: backupName,
      note: 'Restart required for changes to take effect',
    });
  } catch (err) {
    sendError(res, 500, `Failed to update config: ${(err as Error).message}`);
  }
}

// ── ROUTING / MODEL SHIFTING HANDLERS ───────────────────────────────

async function handleRoutingGet(res: ServerResponse, deps: AdminHandlerDeps): Promise<void> {
  try {
    const raw = await readFile(join(deps.configDir, 'openclaw.json'), 'utf-8');
    const clean = stripJsonComments(raw);
    const config = JSON.parse(clean);
    const ollamaModels = await getOllamaModels(deps.config.ollama?.baseUrl);
    send(res, 200, {
      routing: config.routing ?? null,
      availableModels: {
        anthropic: ANTHROPIC_MODELS,
        ollama: ollamaModels,
      },
    });
  } catch (err) {
    sendError(res, 500, `Failed to read routing config: ${(err as Error).message}`);
  }
}

async function handleRoutingPatch(req: IncomingMessage, res: ServerResponse, deps: AdminHandlerDeps): Promise<void> {
  const body = JSON.parse(await readBody(req));
  if (!body.rules && !body.mode && !body.primary) {
    return sendError(res, 400, 'Provide at least one of: rules, mode, primary');
  }

  const configPath = join(deps.configDir, 'openclaw.json');
  try {
    const raw = await readFile(configPath, 'utf-8');
    const clean = stripJsonComments(raw);
    const config = JSON.parse(clean);

    const backupName = `openclaw.json.backup.${Date.now()}`;
    await writeFile(join(deps.configDir, backupName), raw, 'utf-8');

    if (!config.routing) config.routing = {};
    if (body.mode) config.routing.mode = body.mode;
    if (body.primary) config.routing.primary = body.primary;
    if (body.rules) config.routing.rules = body.rules;

    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
    send(res, 200, {
      success: true,
      routing: config.routing,
      backup: backupName,
      note: 'Restart required for changes to take effect',
    });
  } catch (err) {
    sendError(res, 500, `Failed to update routing: ${(err as Error).message}`);
  }
}

// ── SKILL HANDLERS ──────────────────────────────────────────────────

function handleSkillList(res: ServerResponse, deps: AdminHandlerDeps): void {
  if (!requireService(res, deps.skillLoader, 'Skill loader')) return;
  const skills = deps.skillLoader.allSkills.map((s) => ({
    name: s.manifest.name,
    version: s.manifest.version,
    description: (s.manifest as Record<string, unknown>).description ?? '',
    triggers: (s.manifest as Record<string, unknown>).triggers ?? {},
  }));
  send(res, 200, { skills });
}

function handleSkillGet(res: ServerResponse, deps: AdminHandlerDeps, name: string): void {
  if (!requireService(res, deps.skillLoader, 'Skill loader')) return;
  const skill = deps.skillLoader.getSkill(name);
  if (!skill) return sendError(res, 404, `Skill "${name}" not found`);
  send(res, 200, { manifest: skill.manifest, instructions: skill.instructions });
}

async function handleSkillManifestUpdate(req: IncomingMessage, res: ServerResponse, deps: AdminHandlerDeps, name: string): Promise<void> {
  if (!requireService(res, deps.skillLoader, 'Skill loader')) return;
  if (!deps.config.skills?.skillsDir) return sendError(res, 503, 'Skills directory not configured');

  const skill = deps.skillLoader.getSkill(name);
  if (!skill) return sendError(res, 404, `Skill "${name}" not found`);

  const body = JSON.parse(await readBody(req));
  const manifestPath = join(deps.config.skills.skillsDir, name, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(body, null, 2), 'utf-8');
  await deps.skillLoader.loadSkills(deps.config.skills.skillsDir);
  send(res, 200, { success: true });
}

async function handleSkillInstructionsUpdate(req: IncomingMessage, res: ServerResponse, deps: AdminHandlerDeps, name: string): Promise<void> {
  if (!requireService(res, deps.skillLoader, 'Skill loader')) return;
  if (!deps.config.skills?.skillsDir) return sendError(res, 503, 'Skills directory not configured');

  const skill = deps.skillLoader.getSkill(name);
  if (!skill) return sendError(res, 404, `Skill "${name}" not found`);

  const body = JSON.parse(await readBody(req));
  if (!body.instructions || typeof body.instructions !== 'string') {
    return sendError(res, 400, 'Missing instructions string');
  }
  const instructionsPath = join(deps.config.skills.skillsDir, name, 'instructions.md');
  await writeFile(instructionsPath, body.instructions, 'utf-8');
  await deps.skillLoader.loadSkills(deps.config.skills.skillsDir);
  send(res, 200, { success: true });
}

// ── MEMORY HANDLERS ─────────────────────────────────────────────────

async function handleMemoryUserList(res: ServerResponse, deps: AdminHandlerDeps): Promise<void> {
  const memoryDir = deps.config.tools.workspaceDir.replace(/workspace\/?$/, 'memory/semantic');
  const users = await listSubdirectories(memoryDir);
  send(res, 200, { users });
}

async function handleMemoryLayers(res: ServerResponse, deps: AdminHandlerDeps, userId: string): Promise<void> {
  const memoryDir = deps.config.tools.workspaceDir.replace(/workspace\/?$/, 'memory/semantic');
  const userDir = join(memoryDir, userId);
  const layers = {
    identity: await safeReadJson(join(userDir, 'identity.json')),
    projects: await safeReadJson(join(userDir, 'projects.json')),
    knowledge: await safeReadJson(join(userDir, 'knowledge.json')),
    episodes: await safeReadJson(join(userDir, 'episodes.json')),
  };
  // Strip embeddings to reduce response size
  for (const entries of Object.values(layers)) {
    for (const entry of entries as Array<Record<string, unknown>>) {
      delete entry.embedding;
    }
  }
  send(res, 200, layers);
}

async function handleMemorySearch(req: IncomingMessage, res: ServerResponse, deps: AdminHandlerDeps, userId: string): Promise<void> {
  if (!requireService(res, deps.memoryEngine, 'Memory engine')) return;
  const query = parseQuery(req);
  const q = query.get('q') ?? '';
  const max = parseInt(query.get('max') ?? '10', 10);
  if (!q) return sendError(res, 400, 'Missing q parameter');
  const results = await deps.memoryEngine.search(userId, q, max);
  send(res, 200, { results });
}

async function handleMemoryRemember(req: IncomingMessage, res: ServerResponse, deps: AdminHandlerDeps, userId: string): Promise<void> {
  if (!requireService(res, deps.memoryEngine, 'Memory engine')) return;
  const body = JSON.parse(await readBody(req));
  if (!body.fact || typeof body.fact !== 'string') return sendError(res, 400, 'Missing fact string');
  const result = await deps.memoryEngine.explicitStore(userId, body.fact, 'admin-api', body.layer);
  send(res, 201, { result });
}

async function handleMemoryForget(res: ServerResponse, deps: AdminHandlerDeps, userId: string, memoryId: string): Promise<void> {
  if (!requireService(res, deps.memoryEngine, 'Memory engine')) return;
  const result = await deps.memoryEngine.explicitForget(userId, memoryId);
  send(res, 200, { result });
}

async function handleMemoryConsolidate(res: ServerResponse, deps: AdminHandlerDeps, userId: string): Promise<void> {
  if (!requireService(res, deps.memoryEngine, 'Memory engine')) return;
  const report = await deps.memoryEngine.runConsolidation(userId);
  send(res, 200, { report });
}

async function handleMemoryStats(res: ServerResponse, deps: AdminHandlerDeps, userId: string): Promise<void> {
  const memoryDir = deps.config.tools.workspaceDir.replace(/workspace\/?$/, 'memory/semantic');
  const userDir = join(memoryDir, userId);
  const layers = ['identity', 'projects', 'knowledge', 'episodes'] as const;
  const stats: Record<string, { count: number; bytes: number }> = {};
  let totalBytes = 0;
  for (const layer of layers) {
    const filePath = join(userDir, `${layer}.json`);
    try {
      const s = await stat(filePath);
      const entries = await safeReadJson(filePath);
      stats[layer] = { count: (entries as unknown[]).length, bytes: s.size };
      totalBytes += s.size;
    } catch {
      stats[layer] = { count: 0, bytes: 0 };
    }
  }
  send(res, 200, { ...stats, totalBytes });
}

// ── STRATEGY HANDLERS ───────────────────────────────────────────────

async function handleStrategyUserList(res: ServerResponse, deps: AdminHandlerDeps): Promise<void> {
  const storageDir = deps.config.strategies?.storageDir ?? '';
  if (!storageDir) return send(res, 200, { users: [] });
  const users = await listSubdirectories(storageDir);
  send(res, 200, { users });
}

async function handleStrategyAll(res: ServerResponse, deps: AdminHandlerDeps, userId: string): Promise<void> {
  const storageDir = deps.config.strategies?.storageDir ?? '';
  if (!storageDir) return sendError(res, 503, 'Strategies not configured');
  const userDir = join(storageDir, userId);
  const buckets = ['general', 'simple', 'tool_simple', 'web_content', 'coding', 'complex', 'default'];
  const result: Record<string, unknown[]> = {};
  for (const bucket of buckets) {
    const entries = await safeReadJson(join(userDir, `${bucket}.json`));
    // Strip embeddings
    for (const entry of entries as Array<Record<string, unknown>>) {
      delete entry.embedding;
    }
    result[bucket] = entries;
  }
  send(res, 200, result);
}

async function handleStrategyBucket(res: ServerResponse, deps: AdminHandlerDeps, userId: string, classification: string): Promise<void> {
  const storageDir = deps.config.strategies?.storageDir ?? '';
  if (!storageDir) return sendError(res, 503, 'Strategies not configured');
  const entries = await safeReadJson(join(storageDir, userId, `${classification}.json`));
  for (const entry of entries as Array<Record<string, unknown>>) {
    delete entry.embedding;
  }
  send(res, 200, { strategies: entries });
}

async function handleStrategyDelete(res: ServerResponse, deps: AdminHandlerDeps, userId: string, strategyId: string): Promise<void> {
  const storageDir = deps.config.strategies?.storageDir ?? '';
  if (!storageDir) return sendError(res, 503, 'Strategies not configured');
  const userDir = join(storageDir, userId);
  const buckets = ['general', 'simple', 'tool_simple', 'web_content', 'coding', 'complex', 'default'];
  for (const bucket of buckets) {
    const filePath = join(userDir, `${bucket}.json`);
    const entries = await safeReadJson(filePath) as Array<Record<string, unknown>>;
    const idx = entries.findIndex((e) => e.id === strategyId);
    if (idx !== -1) {
      entries.splice(idx, 1);
      await writeFile(filePath, JSON.stringify(entries, null, 2), 'utf-8');
      return send(res, 200, { success: true, bucket });
    }
  }
  sendError(res, 404, `Strategy ${strategyId} not found`);
}

async function handleStrategyConsolidate(res: ServerResponse, deps: AdminHandlerDeps, userId: string): Promise<void> {
  if (!requireService(res, deps.strategyEngine, 'Strategy engine')) return;
  const report = await deps.strategyEngine.runConsolidation(userId);
  send(res, 200, { report });
}

// ── PERSONA HANDLERS ────────────────────────────────────────────────

function handlePersonaList(res: ServerResponse, deps: AdminHandlerDeps): void {
  if (!requireService(res, deps.personaManager, 'Persona manager')) return;
  const personas = deps.personaManager.listPersonas();
  send(res, 200, { personas });
}

function handlePersonaActive(res: ServerResponse, deps: AdminHandlerDeps, chatId: string): void {
  if (!requireService(res, deps.personaManager, 'Persona manager')) return;
  const persona = deps.personaManager.getActivePersona(chatId);
  send(res, 200, persona);
}

async function handlePersonaSwitch(req: IncomingMessage, res: ServerResponse, deps: AdminHandlerDeps, chatId: string): Promise<void> {
  if (!requireService(res, deps.personaManager, 'Persona manager')) return;
  const body = JSON.parse(await readBody(req));
  if (!body.personaId) return sendError(res, 400, 'Missing personaId');
  const persona = deps.personaManager.switchPersona(chatId, body.personaId);
  if (!persona) return sendError(res, 404, `Persona "${body.personaId}" not found`);
  send(res, 200, persona);
}

function handlePersonaReset(res: ServerResponse, deps: AdminHandlerDeps, chatId: string): void {
  if (!requireService(res, deps.personaManager, 'Persona manager')) return;
  const persona = deps.personaManager.resetPersona(chatId);
  send(res, 200, persona);
}

function handlePersonaVoice(res: ServerResponse, deps: AdminHandlerDeps, chatId: string): void {
  if (!requireService(res, deps.personaManager, 'Persona manager')) return;
  send(res, 200, { enabled: deps.personaManager.isVoiceModeEnabled(chatId) });
}

function handlePersonaVoiceToggle(res: ServerResponse, deps: AdminHandlerDeps, chatId: string): void {
  if (!requireService(res, deps.personaManager, 'Persona manager')) return;
  const enabled = deps.personaManager.toggleVoiceMode(chatId);
  send(res, 200, { enabled });
}

// ── TOOL HANDLERS ───────────────────────────────────────────────────

function handleToolList(res: ServerResponse, deps: AdminHandlerDeps): void {
  if (!requireService(res, deps.toolRegistry, 'Tool registry')) return;
  const tools = deps.toolRegistry.allToolNames;
  send(res, 200, { tools, count: tools.length });
}

function handleToolAvailable(res: ServerResponse, deps: AdminHandlerDeps): void {
  if (!requireService(res, deps.toolRegistry, 'Tool registry')) return;
  const tools = deps.toolRegistry.getAvailableTools(deps.config.tools);
  send(res, 200, {
    tools: tools.map((t) => ({ name: t.name, description: t.description, categories: (t as Record<string, unknown>).categories })),
    count: tools.length,
  });
}

function handleToolFiltered(req: IncomingMessage, res: ServerResponse, deps: AdminHandlerDeps): void {
  if (!requireService(res, deps.toolRegistry, 'Tool registry')) return;
  const query = parseQuery(req);
  const classification = query.get('classification') ?? 'complex';
  const tools = deps.toolRegistry.getFilteredTools(deps.config.tools, classification as any);
  send(res, 200, {
    tools: tools.map((t) => ({ name: t.name, description: t.description })),
    count: tools.length,
    classification,
  });
}

// ── SESSION HANDLERS ────────────────────────────────────────────────

function handleSessionList(res: ServerResponse, deps: AdminHandlerDeps): void {
  send(res, 200, {
    activeCount: deps.sessions.activeCount,
    maxConcurrent: deps.config.session.maxConcurrent,
  });
}

function handleSessionGet(res: ServerResponse, deps: AdminHandlerDeps, id: string): void {
  const conversation = deps.sessions.getConversation(id);
  if (!conversation) return sendError(res, 404, `Session ${id} not found`);
  send(res, 200, conversation);
}

function handleSessionReset(res: ServerResponse, deps: AdminHandlerDeps, id: string): void {
  deps.sessions.reset(id);
  send(res, 200, { success: true });
}

// ── MARKETPLACE HANDLERS ─────────────────────────────────────────────

async function handleMarketplaceStatus(res: ServerResponse, deps: AdminHandlerDeps): Promise<void> {
  if (!requireService(res, deps.marketplaceManager, 'Marketplace manager')) return;
  const wallet = deps.marketplaceManager.getWallet();
  const config = deps.marketplaceManager.getConfig();
  const stats = await deps.marketplaceManager.getAgentStats();
  send(res, 200, {
    wallet: wallet ? { address: wallet.address, agentId: wallet.agentId, onChainMinted: wallet.onChainMinted } : null,
    wsConnected: deps.marketplaceManager.isWsConnected(),
    automationMode: config.automationMode,
    maxConcurrentTasks: config.maxConcurrentTasks,
    stats,
  });
}

async function handleMarketplaceTasks(res: ServerResponse, deps: AdminHandlerDeps): Promise<void> {
  if (!requireService(res, deps.marketplaceManager, 'Marketplace manager')) return;
  const tasks = await deps.marketplaceManager.getAllTasks();
  send(res, 200, { tasks });
}

async function handleMarketplaceEarnings(req: IncomingMessage, res: ServerResponse, deps: AdminHandlerDeps): Promise<void> {
  if (!requireService(res, deps.marketplaceManager, 'Marketplace manager')) return;
  const query = parseQuery(req);
  const period = (query.get('period') as 'today' | 'week' | 'month' | 'all') ?? 'all';
  const { records, totalEth } = await deps.marketplaceManager.getEarnings(period);
  send(res, 200, { records, totalEth, period });
}

async function handleMarketplaceMode(req: IncomingMessage, res: ServerResponse, deps: AdminHandlerDeps): Promise<void> {
  if (!requireService(res, deps.marketplaceManager, 'Marketplace manager')) return;
  const body = JSON.parse(await readBody(req));
  const mode = body.mode;
  if (mode !== 'supervised' && mode !== 'full_auto') {
    return sendError(res, 400, 'Mode must be "supervised" or "full_auto"');
  }
  // Update in-memory config (persisting requires config file update)
  const config = deps.marketplaceManager.getConfig();
  (config as any).automationMode = mode;
  send(res, 200, { success: true, mode, note: 'Runtime mode changed. Update openclaw.json to persist.' });
}

async function handleMarketplaceFeedback(res: ServerResponse, deps: AdminHandlerDeps): Promise<void> {
  if (!requireService(res, deps.marketplaceManager, 'Marketplace manager')) return;
  const feedback = await deps.marketplaceManager.getFeedback();
  send(res, 200, { feedback, count: feedback.length });
}
