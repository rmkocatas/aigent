// ============================================================
// OpenClaw Deploy — Core Type Definitions
// ============================================================

// --- LLM Provider ---

export type LlmProvider = 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'ollama';

export type ModelRoutingMode = 'single' | 'hybrid';

export interface LlmProviderConfig {
  provider: LlmProvider;
  apiKey: string;
  model?: string;
  ollama?: OllamaConfig;
  routing?: ModelRoutingConfig;
}

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  keepAlive?: string;
}

export interface ModelRoutingConfig {
  mode: ModelRoutingMode;
  primary: LlmProvider;
  fallback?: LlmProvider;
  rules?: RoutingRule[];
}

export interface RoutingRule {
  condition: 'simple' | 'complex' | 'coding' | 'default';
  provider: LlmProvider;
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
  ollamaAvailable: boolean;
  ollamaVersion?: string;
  ollamaModels?: string[];
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
  training?: TrainingConfig;
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

// --- Training / Distillation ---

export interface TrainingEntry {
  id: string;
  prompt: string;
  response: string;
  provider: LlmProvider;
  model: string;
  timestamp: string;
  tokenCount?: number;
  category?: 'simple' | 'complex' | 'coding' | 'general';
}

export interface TrainingConfig {
  enabled: boolean;
  dataDir: string;
  autoCollect: boolean;
  minEntriesForTraining: number;
  autoTrain: boolean;
  baseModel: string;
  loraRank: number;
  epochs: number;
}

export interface TrainingStats {
  totalEntries: number;
  dataFileSizeMB: number;
  oldestEntry?: string;
  newestEntry?: string;
  readyForTraining: boolean;
  fineTunedVersions: string[];
  currentModel: string;
}

export type TrainingBackend = 'unsloth' | 'mlx' | 'transformers' | 'none';

export interface FineTuneConfig {
  baseModel: string;
  dataPath: string;
  outputDir: string;
  loraRank: number;
  epochs: number;
  batchSize: number;
  learningRate: number;
  backend: TrainingBackend;
}

export interface FineTuneResult {
  success: boolean;
  modelName: string;
  trainingTime: string;
  dataPointsUsed: number;
  error?: string;
}

// --- Tool Use ---

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ImageBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    data: string;
  };
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ImageBlock;

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required?: string[];
  };
}

export interface ToolExecutionResult {
  tool_use_id: string;
  output: string;
  is_error: boolean;
  duration_ms: number;
}

export interface ToolsConfig {
  deny: string[];
  allow?: string[];
  sandboxMode: SandboxMode;
  workspaceDir: string;
  maxExecutionMs: number;
  allowedProjectDirs?: string[];
}

// --- Telegram Media Types ---

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramVoice {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

// --- Scheduled Reminders ---

export interface Reminder {
  id: string;
  userId: string;
  chatId: number | string;
  channel: 'telegram' | 'webchat';
  message: string;
  triggerAt: string;
  createdAt: string;
  fired: boolean;
}

// --- Gateway Runtime ---

export interface ChatRequest {
  message: string;
  conversationId?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | ContentBlock[];
  timestamp: string;
}

export interface Conversation {
  id: string;
  messages: ChatMessage[];
  createdAt: string;
  lastActivity: string;
  provider?: LlmProvider;
}

export type PromptClassification = 'simple' | 'complex' | 'coding' | 'default';

export interface ClassificationResult {
  classification: PromptClassification;
  confidence: number;
  signals: string[];
}

export interface ProviderSelection {
  provider: LlmProvider;
  model: string;
  classification: PromptClassification;
}

export interface SSEEvent {
  event?: string;
  data: string;
  id?: string;
}

export interface GatewayRuntimeConfig {
  bind: string;
  port: number;
  token: string;
  systemPrompt: string | null;
  channels: ChannelSelection[];
  telegramBotToken: string | null;
  telegramAllowedUsers: number[];
  ollama: OllamaConfig | null;
  anthropicApiKey: string | null;
  routing: ModelRoutingConfig | null;
  training: TrainingConfig | null;
  tools: ToolsConfig;
  session: {
    idleTimeoutMinutes: number;
    maxConcurrent: number;
    persistDir?: string;
  };
  whisperApiKey: string | null;
}

export interface StreamChunk {
  content: string;
  done: boolean;
  provider: LlmProvider;
  model: string;
  toolUse?: ToolUseBlock;
  toolResult?: ToolResultBlock;
  stopReason?: 'end_turn' | 'tool_use';
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
