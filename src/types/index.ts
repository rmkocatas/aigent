// ============================================================
// OpenClaw Deploy — Core Type Definitions
// ============================================================

// --- LLM Provider ---

export type LlmProvider = 'anthropic' | 'openai' | 'gemini' | 'openrouter';

export interface LlmProviderConfig {
  provider: LlmProvider;
  apiKey: string;
  model?: string;
}

// --- Security Levels ---

export type SecurityLevel = 'L1' | 'L2' | 'L3';

export interface SecurityLevelDefinition {
  name: string;
  description: string;
  gateway: {
    bind: GatewayBind;
    authMode: 'token';
  };
  channels: {
    dmPolicy: DmPolicy;
    groupPolicy: GroupPolicy;
    requireMention: boolean;
  };
  sandbox: {
    mode: SandboxMode;
    scope: SandboxScope;
    workspaceAccess: WorkspaceAccess;
  };
  tools: {
    deny: string[];
    allow?: string[];
  };
  docker: DockerSecurityConfig;
  logging: {
    redactSensitive: 'tools' | 'all' | 'none';
  };
  discovery: {
    mdnsMode: 'off' | 'minimal' | 'full';
  };
  filePermissions: {
    directory: string;
    config: string;
    credentials: string;
  };
}

// --- Gateway ---

export type GatewayBind = 'loopback' | 'lan' | 'tailnet' | 'custom';

export interface GatewayConfig {
  mode: 'local' | 'remote';
  bind: GatewayBind;
  port: number;
  auth: {
    mode: 'token';
    token: string;
  };
}

// --- Channels ---

export type ChannelId =
  | 'webchat'
  | 'whatsapp'
  | 'telegram'
  | 'discord'
  | 'slack'
  | 'signal';

export type DmPolicy = 'pairing' | 'allowlist' | 'open' | 'disabled';
export type GroupPolicy = 'open' | 'allowlist';
export type AutomationLevel = 'full' | 'high' | 'medium' | 'low';

export interface ChannelSelection {
  id: ChannelId;
  enabled: boolean;
  token?: string;
  config?: Record<string, unknown>;
}

export interface ChannelDefinition {
  id: ChannelId;
  name: string;
  automationLevel: AutomationLevel;
  requiresExternalAccount: boolean;
  requiresExternalDaemon: boolean;
  credentialType: 'token' | 'oauth' | 'session' | 'none';
  configKeys: string[];
}

export interface ProvisioningStep {
  type: 'automated' | 'manual' | 'semi-automated';
  title: string;
  description: string;
  instructions?: string[];
  externalUrl?: string;
  verifyPrompt?: string;
}

// --- Sandbox ---

export type SandboxMode = 'off' | 'all' | 'non-main';
export type SandboxScope = 'agent' | 'session' | 'shared';
export type WorkspaceAccess = 'none' | 'ro' | 'rw';

// --- Docker ---

export interface DockerSecurityConfig {
  readOnlyRoot: boolean;
  capDrop: string[];
  capAdd: string[];
  securityOpt: string[];
  pidsLimit: number;
  memory: string;
  memorySwap: string;
  cpus: string;
  user: string;
  tmpfs: string[];
}

export interface DockerComposeConfig {
  services: Record<string, DockerServiceConfig>;
  volumes?: Record<string, DockerVolumeConfig>;
}

export interface DockerServiceConfig {
  image: string;
  container_name: string;
  restart: string;
  user: string;
  ports: string[];
  volumes: string[];
  environment: Record<string, string>;
  env_file: string[];
  read_only: boolean;
  cap_drop: string[];
  cap_add: string[];
  security_opt: string[];
  tmpfs: string[];
  deploy: {
    resources: {
      limits: {
        memory: string;
        cpus: string;
      };
    };
  };
  healthcheck: {
    test: string[];
    interval: string;
    timeout: string;
    retries: number;
    start_period: string;
  };
  logging: {
    driver: string;
    options: Record<string, string>;
  };
}

export interface DockerVolumeConfig {
  driver?: string;
}

// --- Environment Detection ---

export interface DetectedEnvironment {
  os: 'linux' | 'macos' | 'windows-wsl';
  dockerAvailable: boolean;
  dockerVersion?: string;
  dockerComposeAvailable: boolean;
  freePort: number;
  shell: 'bash' | 'zsh' | 'fish' | 'powershell' | 'unknown';
  nodeVersion: string;
  existingInstall?: string;
  hasSystemd: boolean;
  availableMemoryMB: number;
  cpuCount: number;
  isWSL: boolean;
  isTailscaleAvailable: boolean;
}

// --- Deployment ---

export interface DeploymentConfig {
  llm: LlmProviderConfig;
  channels: ChannelSelection[];
  securityLevel: SecurityLevel;
  gateway: {
    bind: GatewayBind;
    port: number;
  };
  deployment: {
    mode: 'docker' | 'native';
    workspace: string;
    installDir: string;
  };
  tls?: {
    enabled: boolean;
    domain?: string;
    email?: string;
  };
}

export interface GeneratedSecrets {
  gatewayToken: string;
  masterEncryptionKey: string;
}

export interface GeneratedFiles {
  openclawJson: string;
  dockerComposeYml?: string;
  envFile: string;
  caddyfile?: string;
  systemdService?: string;
}

export interface DeploymentResult {
  success: boolean;
  gatewayUrl: string;
  gatewayToken: string;
  errors: string[];
  warnings: string[];
  auditResults: AuditResult[];
}

// --- Security Audit ---

export type AuditSeverity = 'critical' | 'warning' | 'info' | 'pass';

export interface AuditResult {
  severity: AuditSeverity;
  check: string;
  message: string;
  remediation?: string;
  autoFixable: boolean;
  fixed?: boolean;
}

export interface AuditReport {
  timestamp: string;
  results: AuditResult[];
  overallStatus: 'pass' | 'warning' | 'critical';
  autoFixedCount: number;
}
