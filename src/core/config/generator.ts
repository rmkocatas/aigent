// ============================================================
// OpenClaw Deploy — Config File Content Generator
// ============================================================

import type {
  DeploymentConfig,
  GeneratedSecrets,
  GeneratedFiles,
  SecurityLevelDefinition,
} from '../../types/index.js';

// ---------------------------------------------------------------------------
// Fallback security-level definitions.
// The canonical source is '../security/levels.js'. When that module is
// available its exports should be preferred, but we hardcode sane L2
// defaults here so the config module can work standalone.
// ---------------------------------------------------------------------------

type SecurityLevelMap = Record<string, SecurityLevelDefinition>;

let securityLevels: SecurityLevelMap | null = null;

async function loadSecurityLevels(): Promise<SecurityLevelMap | null> {
  try {
    const mod = await import('../security/levels.js') as { SECURITY_LEVELS?: SecurityLevelMap };
    return mod.SECURITY_LEVELS ?? null;
  } catch {
    return null;
  }
}

const FALLBACK_LEVELS: SecurityLevelMap = {
  L1: {
    name: 'Basic',
    description: 'Basic security for local development',
    gateway: { bind: 'loopback', authMode: 'token' },
    channels: { dmPolicy: 'open', groupPolicy: 'open', requireMention: false },
    sandbox: { mode: 'off', scope: 'shared', workspaceAccess: 'rw' },
    tools: { deny: [] },
    docker: {
      readOnlyRoot: false,
      capDrop: ['NET_RAW'],
      capAdd: [],
      securityOpt: [],
      pidsLimit: 256,
      memory: '2g',
      memorySwap: '2g',
      cpus: '2',
      user: '1000:1000',
      tmpfs: ['/tmp:size=256m'],
    },
    logging: { redactSensitive: 'tools' },
    discovery: { mdnsMode: 'full' },
    filePermissions: { directory: '0755', config: '0644', credentials: '0600' },
  },
  L2: {
    name: 'Standard',
    description: 'Hardened defaults for private deployment',
    gateway: { bind: 'loopback', authMode: 'token' },
    channels: { dmPolicy: 'pairing', groupPolicy: 'allowlist', requireMention: true },
    sandbox: { mode: 'all', scope: 'agent', workspaceAccess: 'ro' },
    tools: { deny: ['shell', 'computer', 'file_write'] },
    docker: {
      readOnlyRoot: true,
      capDrop: ['ALL'],
      capAdd: ['NET_BIND_SERVICE'],
      securityOpt: ['no-new-privileges:true'],
      pidsLimit: 128,
      memory: '1g',
      memorySwap: '1g',
      cpus: '1',
      user: '65534:65534',
      tmpfs: ['/tmp:size=128m,noexec,nosuid'],
    },
    logging: { redactSensitive: 'all' },
    discovery: { mdnsMode: 'minimal' },
    filePermissions: { directory: '0750', config: '0640', credentials: '0600' },
  },
  L3: {
    name: 'Maximum',
    description: 'Maximum security — highly restricted',
    gateway: { bind: 'loopback', authMode: 'token' },
    channels: { dmPolicy: 'allowlist', groupPolicy: 'allowlist', requireMention: true },
    sandbox: { mode: 'all', scope: 'session', workspaceAccess: 'none' },
    tools: { deny: ['shell', 'computer', 'file_write', 'file_read', 'browser'], allow: ['chat'] },
    docker: {
      readOnlyRoot: true,
      capDrop: ['ALL'],
      capAdd: [],
      securityOpt: ['no-new-privileges:true', 'seccomp=default'],
      pidsLimit: 64,
      memory: '512m',
      memorySwap: '512m',
      cpus: '0.5',
      user: '65534:65534',
      tmpfs: ['/tmp:size=64m,noexec,nosuid,nodev'],
    },
    logging: { redactSensitive: 'all' },
    discovery: { mdnsMode: 'off' },
    filePermissions: { directory: '0700', config: '0600', credentials: '0400' },
  },
};

function getLevel(level: string): SecurityLevelDefinition {
  if (securityLevels && securityLevels[level]) {
    return securityLevels[level];
  }
  return FALLBACK_LEVELS[level] ?? FALLBACK_LEVELS['L2'];
}

// ---------------------------------------------------------------------------
// Bind address resolution
// ---------------------------------------------------------------------------

function resolveBindAddress(bind: string): string {
  switch (bind) {
    case 'loopback': return '127.0.0.1';
    case 'lan': return '0.0.0.0';
    case 'tailnet': return '100.64.0.0';
    case 'custom': return '0.0.0.0';
    default: return '127.0.0.1';
  }
}

// ---------------------------------------------------------------------------
// API key env var name by provider
// ---------------------------------------------------------------------------

function apiKeyEnvVar(provider: string): string {
  switch (provider) {
    case 'anthropic': return 'ANTHROPIC_API_KEY';
    case 'openai': return 'OPENAI_API_KEY';
    case 'gemini': return 'GOOGLE_AI_API_KEY';
    case 'openrouter': return 'OPENROUTER_API_KEY';
    default: return 'LLM_API_KEY';
  }
}

// ---------------------------------------------------------------------------
// openclaw.json (JSON5-style with comments)
// ---------------------------------------------------------------------------

function generateOpenClawJson(
  config: DeploymentConfig,
  _secrets: GeneratedSecrets,
  levelDef: SecurityLevelDefinition,
): string {
  const bindAddr = resolveBindAddress(config.gateway.bind);

  const obj = {
    gateway: {
      bind: bindAddr,
      port: config.gateway.port,
      auth: {
        mode: 'token' as const,
        token: '${OPENCLAW_GATEWAY_TOKEN}',
      },
    },
    agents: {
      sandbox: {
        mode: levelDef.sandbox.mode,
        scope: levelDef.sandbox.scope,
        workspaceAccess: levelDef.sandbox.workspaceAccess,
      },
    },
    channels: config.channels
      .filter((ch) => ch.enabled)
      .map((ch) => ({
        id: ch.id,
        enabled: true,
        ...(ch.token ? { token: ch.token } : {}),
        ...(ch.config ? { config: ch.config } : {}),
      })),
    tools: {
      deny: levelDef.tools.deny,
      ...(levelDef.tools.allow ? { allow: levelDef.tools.allow } : {}),
    },
    ...(config.llm.provider === 'ollama' && config.llm.ollama ? {
      ollama: {
        baseUrl: config.llm.ollama.baseUrl,
        model: config.llm.ollama.model,
        ...(config.llm.ollama.keepAlive ? { keepAlive: config.llm.ollama.keepAlive } : {}),
      },
    } : {}),
    ...(config.llm.routing?.mode === 'hybrid' ? {
      routing: {
        mode: config.llm.routing.mode,
        primary: config.llm.routing.primary,
        ...(config.llm.routing.fallback ? { fallback: config.llm.routing.fallback } : {}),
        ...(config.llm.routing.rules ? { rules: config.llm.routing.rules } : {}),
      },
    } : {}),
    session: {
      idleTimeoutMinutes: 30,
      maxConcurrent: 4,
    },
    logging: {
      level: 'info',
      redactSensitive: levelDef.logging.redactSensitive,
    },
    discovery: {
      mdns: levelDef.discovery.mdnsMode,
    },
    ...(config.training?.enabled ? {
      training: {
        enabled: true,
        dataDir: config.training.dataDir,
        autoCollect: config.training.autoCollect,
        minEntries: config.training.minEntriesForTraining,
        autoTrain: config.training.autoTrain,
        baseModel: config.training.baseModel,
      },
    } : {}),
  };

  // Prefix a comment header, then the JSON body.
  const header = [
    '// OpenClaw configuration — generated by openclaw-deploy',
    `// Security level: ${config.securityLevel} (${levelDef.name})`,
    '// Environment variables are interpolated at runtime.',
    '',
  ].join('\n');

  return header + JSON.stringify(obj, null, 2) + '\n';
}

// ---------------------------------------------------------------------------
// docker-compose.yml
// ---------------------------------------------------------------------------

function generateDockerCompose(
  config: DeploymentConfig,
  _secrets: GeneratedSecrets,
  levelDef: SecurityLevelDefinition,
): string {
  const docker = levelDef.docker;
  const bindAddr = resolveBindAddress(config.gateway.bind);
  const port = config.gateway.port;
  const envVarName = apiKeyEnvVar(config.llm.provider);

  const lines: string[] = [
    '# Generated by openclaw-deploy — do not edit manually',
    `# Security level: ${config.securityLevel}`,
    '',
    'services:',
    '  openclaw:',
    '    image: ghcr.io/openclaw/openclaw:latest',
    '    container_name: openclaw',
    '    restart: unless-stopped',
    `    user: "${docker.user}"`,
    '    ports:',
    `      - "${bindAddr}:${port}:${port}"`,
    '    volumes:',
    `      - ${config.deployment.installDir}/openclaw.json:/app/config/openclaw.json:ro`,
    `      - openclaw-data:/app/data`,
  ];

  if (config.training?.enabled) {
    lines.push(`      - ${config.training.dataDir}:/app/training`);
  }

  if (levelDef.sandbox.workspaceAccess !== 'none') {
    const roFlag = levelDef.sandbox.workspaceAccess === 'ro' ? ':ro' : '';
    lines.push(`      - ${config.deployment.workspace}:/app/workspace${roFlag}`);
  }

  lines.push(
    '    env_file:',
    `      - ${config.deployment.installDir}/.env`,
    '    environment:',
    `      - OPENCLAW_GATEWAY_PORT=\${OPENCLAW_GATEWAY_PORT}`,
  );

  if (config.llm.provider === 'ollama') {
    lines.push(
      '      - OLLAMA_HOST=${OLLAMA_HOST}',
      '      - OLLAMA_MODEL=${OLLAMA_MODEL}',
    );
    lines.push(
      '    extra_hosts:',
      '      - "host.docker.internal:host-gateway"',
    );
  } else {
    lines.push(`      - ${envVarName}=\${${envVarName}}`);
  }

  if (docker.readOnlyRoot) {
    lines.push('    read_only: true');
  }

  if (docker.capDrop.length > 0) {
    lines.push('    cap_drop:');
    for (const cap of docker.capDrop) {
      lines.push(`      - ${cap}`);
    }
  }

  if (docker.capAdd.length > 0) {
    lines.push('    cap_add:');
    for (const cap of docker.capAdd) {
      lines.push(`      - ${cap}`);
    }
  }

  if (docker.securityOpt.length > 0) {
    lines.push('    security_opt:');
    for (const opt of docker.securityOpt) {
      lines.push(`      - ${opt}`);
    }
  }

  if (docker.tmpfs.length > 0) {
    lines.push('    tmpfs:');
    for (const t of docker.tmpfs) {
      lines.push(`      - ${t}`);
    }
  }

  lines.push(
    '    deploy:',
    '      resources:',
    '        limits:',
    `          memory: ${docker.memory}`,
    `          cpus: "${docker.cpus}"`,
    `    pids_limit: ${docker.pidsLimit}`,
    '    healthcheck:',
    `      test: ["CMD", "curl", "-f", "http://127.0.0.1:${port}/health"]`,
    '      interval: 30s',
    '      timeout: 10s',
    '      retries: 3',
    '      start_period: 15s',
    '    logging:',
    '      driver: json-file',
    '      options:',
    '        max-size: "10m"',
    '        max-file: "3"',
    '',
    'volumes:',
    '  openclaw-data:',
    '    driver: local',
    '',
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// .env file
// ---------------------------------------------------------------------------

function generateEnvFile(
  config: DeploymentConfig,
  secrets: GeneratedSecrets,
): string {
  const lines: string[] = [
    '# OpenClaw environment — generated by openclaw-deploy',
    '# Keep this file private (chmod 600).',
    '',
    `OPENCLAW_GATEWAY_TOKEN=${secrets.gatewayToken}`,
  ];

  if (config.llm.provider === 'ollama') {
    const baseUrl = config.llm.ollama?.baseUrl ?? 'http://localhost:11434';
    const model = config.llm.ollama?.model ?? config.llm.model ?? 'llama3.3:70b';
    lines.push(`OLLAMA_BASE_URL=${baseUrl}`);
    lines.push(`OLLAMA_MODEL=${model}`);
    if (config.deployment.mode === 'docker') {
      lines.push('OLLAMA_HOST=http://host.docker.internal:11434');
    }
  } else {
    const envVarName = apiKeyEnvVar(config.llm.provider);
    lines.push(`${envVarName}=${config.llm.apiKey}`);
  }

  lines.push(
    `OPENCLAW_GATEWAY_PORT=${config.gateway.port}`,
    `OPENCLAW_INSTALL_DIR=${config.deployment.installDir}`,
    `OPENCLAW_WORKSPACE=${config.deployment.workspace}`,
    '',
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Caddyfile (optional — only if TLS is enabled)
// ---------------------------------------------------------------------------

function generateCaddyfile(config: DeploymentConfig): string | undefined {
  if (!config.tls?.enabled || !config.tls.domain) {
    return undefined;
  }

  const lines: string[] = [
    `${config.tls.domain} {`,
    `  reverse_proxy 127.0.0.1:${config.gateway.port}`,
  ];

  if (config.tls.email) {
    lines.push(`  tls ${config.tls.email}`);
  }

  lines.push(
    '  header {',
    '    Strict-Transport-Security "max-age=31536000; includeSubDomains"',
    '    X-Content-Type-Options "nosniff"',
    '    X-Frame-Options "DENY"',
    '  }',
    '}',
    '',
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateOpenClawConfig(
  config: DeploymentConfig,
  secrets: GeneratedSecrets,
): Promise<GeneratedFiles> {
  // Attempt to load the real security levels module.
  if (!securityLevels) {
    securityLevels = await loadSecurityLevels();
  }

  const levelDef = getLevel(config.securityLevel);

  const files: GeneratedFiles = {
    openclawJson: generateOpenClawJson(config, secrets, levelDef),
    envFile: generateEnvFile(config, secrets),
  };

  if (config.deployment.mode === 'docker') {
    files.dockerComposeYml = generateDockerCompose(config, secrets, levelDef);
  }

  const caddyfile = generateCaddyfile(config);
  if (caddyfile) {
    files.caddyfile = caddyfile;
  }

  return files;
}
