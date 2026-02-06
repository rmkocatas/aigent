// ============================================================
// OpenClaw Deploy — Security Level Definitions
// ============================================================

import type { SecurityLevel, SecurityLevelDefinition } from '../../types/index.js';

export const SECURITY_LEVELS: Record<SecurityLevel, SecurityLevelDefinition> = {
  L1: {
    name: 'Solo / Local',
    description: 'Single-user local development. Loopback-only, token auth, minimal restrictions.',
    gateway: {
      bind: 'loopback',
      authMode: 'token',
    },
    channels: {
      dmPolicy: 'pairing',
      groupPolicy: 'allowlist',
      requireMention: false,
    },
    sandbox: {
      mode: 'off',
      scope: 'shared',
      workspaceAccess: 'rw',
    },
    tools: {
      deny: ['exec', 'process'],
    },
    docker: {
      readOnlyRoot: false,
      capDrop: [],
      capAdd: [],
      securityOpt: [],
      pidsLimit: 0,
      memory: '',
      memorySwap: '',
      cpus: '',
      user: '',
      tmpfs: [],
    },
    logging: {
      redactSensitive: 'tools',
    },
    discovery: {
      mdnsMode: 'minimal',
    },
    filePermissions: {
      directory: '700',
      config: '600',
      credentials: '600',
    },
  },

  L2: {
    name: 'Team / Shared',
    description: 'Multi-user shared deployment. Per-channel sessions, sandbox non-main, hardened Docker.',
    gateway: {
      bind: 'loopback',
      authMode: 'token',
    },
    channels: {
      dmPolicy: 'pairing',
      groupPolicy: 'allowlist',
      requireMention: true,
    },
    sandbox: {
      mode: 'non-main',
      scope: 'agent',
      workspaceAccess: 'rw',
    },
    tools: {
      deny: ['browser', 'canvas', 'nodes', 'cron', 'exec', 'process'],
    },
    docker: {
      readOnlyRoot: true,
      capDrop: ['ALL'],
      capAdd: ['CHOWN', 'SETUID', 'SETGID'],
      securityOpt: ['no-new-privileges'],
      pidsLimit: 256,
      memory: '1g',
      memorySwap: '2g',
      cpus: '2.0',
      user: '1000:1000',
      tmpfs: ['/tmp:size=100M'],
    },
    logging: {
      redactSensitive: 'tools',
    },
    discovery: {
      mdnsMode: 'minimal',
    },
    filePermissions: {
      directory: '700',
      config: '600',
      credentials: '600',
    },
  },

  L3: {
    name: 'Maximum',
    description: 'Maximum security. Full sandbox, session-scoped, read-only workspace, allow-list tools only.',
    gateway: {
      bind: 'loopback',
      authMode: 'token',
    },
    channels: {
      dmPolicy: 'pairing',
      groupPolicy: 'allowlist',
      requireMention: true,
    },
    sandbox: {
      mode: 'all',
      scope: 'session',
      workspaceAccess: 'ro',
    },
    tools: {
      deny: ['browser', 'canvas', 'nodes', 'cron', 'exec', 'process'],
      allow: ['read', 'sessions_list', 'sessions_history'],
    },
    docker: {
      readOnlyRoot: true,
      capDrop: ['ALL'],
      capAdd: ['CHOWN', 'SETUID', 'SETGID'],
      securityOpt: ['no-new-privileges'],
      pidsLimit: 256,
      memory: '512m',
      memorySwap: '2g',
      cpus: '2.0',
      user: '1000:1000',
      tmpfs: ['/tmp:size=100M'],
    },
    logging: {
      redactSensitive: 'all',
    },
    discovery: {
      mdnsMode: 'off',
    },
    filePermissions: {
      directory: '700',
      config: '600',
      credentials: '600',
    },
  },
};

export const DEFAULT_SECURITY_LEVEL: SecurityLevel = 'L2';

export function getSecurityLevel(level: SecurityLevel): SecurityLevelDefinition {
  return SECURITY_LEVELS[level];
}
