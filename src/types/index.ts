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
  fastModel?: string;
  keepAlive?: string;
  numCtx?: number;
  numPredict?: number;
  /** Extra Ollama options passed directly to the /api/chat options object (e.g. num_gpu, flash_attn). */
  extraOptions?: Record<string, unknown>;
}

export interface ModelRoutingConfig {
  mode: ModelRoutingMode;
  primary: LlmProvider;
  fallback?: LlmProvider;
  rules?: RoutingRule[];
}

export interface RoutingRule {
  condition: PromptClassification;
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
  toolCalls?: Array<{ name: string; isError: boolean }>;
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

export interface GeneratedImage {
  type: 'url' | 'base64';
  data: string;
  mimeType: string;
  prompt: string;
}

export interface GeneratedFile {
  filename: string;
  mimeType: string;
  data: Buffer;
  caption?: string;
}

export interface TelegramPoll {
  question: string;
  options: string[];
  isAnonymous?: boolean;
  allowsMultipleAnswers?: boolean;
  type?: 'regular' | 'quiz';
  correctOptionId?: number;
}

export interface ToolRoutingHints {
  useWhen?: string[];
  avoidWhen?: string[];
}

export type ToolCategory = 'core' | 'file' | 'web' | 'code' | 'data' | 'memory' | 'notes' | 'reminders' | 'media' | 'marketplace';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
      items?: { type: string };
    }>;
    required?: string[];
  };
  routing?: ToolRoutingHints;
  categories?: ToolCategory[];
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
  /** Tools blocked from the HTTP/webchat channel (in addition to the global deny list) */
  httpDenyTools?: string[];
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

// --- WhatsApp Media Types ---

export interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'text' | 'image' | 'audio' | 'document' | 'reaction' | 'interactive';
  text?: { body: string };
  image?: WhatsAppMedia;
  audio?: WhatsAppMedia;
  document?: WhatsAppMedia & { filename?: string };
}

export interface WhatsAppMedia {
  id: string;
  mime_type?: string;
  sha256?: string;
  caption?: string;
}

// --- Scheduled Reminders ---

export interface Reminder {
  id: string;
  userId: string;
  chatId: number | string;
  channel: 'telegram' | 'webchat' | 'whatsapp' | 'discord';
  message: string;
  triggerAt: string;
  createdAt: string;
  fired: boolean;
  /** Cron expression for recurring reminders (e.g. "0 9 * * 1-5" for weekdays at 9am) */
  cronExpression?: string;
  /** Whether this is a recurring reminder */
  recurring?: boolean;
}

// --- Streaming ---

export interface StreamingConfig {
  enabled: boolean;
  throttleMs: number;
  minCharsBeforeFirstSend: number;
  minCharsBeforeEdit: number;
  /** Telegram only — use sendMessageDraft for DM typing previews */
  useDraftForDMs?: boolean;
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
  compactionSummary?: CompactionSummary;
}

// --- Conversation Compaction ---

export interface CompactionSummary {
  summary: string;
  messageCount: number;
  timestamp: string;
  tokenEstimate: number;
}

export interface CompactionConfig {
  enabled: boolean;
  triggerThreshold: number;
  keepRecentCount: number;
  summaryMaxTokens: number;
  provider: 'ollama' | 'anthropic';
}

// --- Skills System ---

export interface SkillManifest {
  name: string;
  description: string;
  version: string;
  triggers: {
    keywords?: string[];
    patterns?: string[];
    classifications?: PromptClassification[];
  };
  avoidWhen?: string[];
  requiredTools?: string[];
  provider?: LlmProvider;
}

export interface Skill {
  manifest: SkillManifest;
  instructions: string;
}

export interface SkillsConfig {
  enabled: boolean;
  skillsDir: string;
  maxActiveSkills: number;
}

export interface MemoryConfig {
  enabled: boolean;
  embeddingModel: string;
  extractionProvider: 'ollama' | 'anthropic';
  maxMemoriesPerUser: number;
  autoExtract: boolean;
  autoInject: boolean;
  injectionTokenBudget: number;
  consolidationIntervalMs: number;
  decayRate: number;
  mergeThreshold: number;
  minStrength: number;
  searchDefaults: {
    maxResults: number;
    semanticWeight: number;
    lexicalWeight: number;
    symbolicWeight: number;
  };
  sqlite?: {
    enabled: boolean;
    dbPath?: string;
  };
}

export interface StrategyConfig {
  enabled: boolean;
  storageDir: string;
  extractionProvider: 'ollama' | 'anthropic';
  autoExtract: boolean;
  autoInject: boolean;
  injectionTokenBudget: number;
  maxStrategiesPerUser: number;
  maxGeneralStrategies: number;
  maxPerClassification: number;
  consolidationIntervalMs: number;
  minStrength: number;
  mergeThreshold: number;
  minSuccessRate: number;
}

export type PromptClassification = 'simple' | 'complex' | 'coding' | 'tool_simple' | 'web_content' | 'default';

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

export type AutonomousSafetyTier = 'safe' | 'moderate' | 'sensitive' | 'dangerous';

export interface AutonomousRuntimeConfig {
  enabled: boolean;
  defaultBudget: {
    maxTokens: number;
    maxApiCalls: number;
    maxToolCalls: number;
    maxDurationMs: number;
    maxSubtasks: number;
  };
  safetyTierOverrides?: Record<string, AutonomousSafetyTier>;
  autoApproveModerate: boolean;
  maxConcurrentTasks: number;
  progressIntervalMs: number;
  planningModel: 'anthropic';
  maxSpawnDepth: number;
  /** Discord channel ID to post completion/failure reports to */
  reportChannelId?: string;
}

// --- Monitoring & Backup ---

export interface MonitoringConfig {
  enabled: boolean;
  metricsIntervalMs: number;
  alertThresholds: {
    diskUsagePercent: number;
    errorRatePerMinute: number;
  };
}

export interface BackupConfig {
  enabled: boolean;
  intervalMs: number;
  retentionDays: number;
  includeSessions: boolean;
  includeCache: boolean;
}

export interface SystemMetrics {
  timestamp: string;
  uptime: number;
  diskUsage: Record<string, number>;
  memorySizes: Record<string, number>;
  sessionCount: number;
  cacheEntryCount: number;
  cacheSizeBytes: number;
}

export interface BackupMetadata {
  id: string;
  timestamp: string;
  durationMs: number;
  totalSizeBytes: number;
  dirs: string[];
  status: 'success' | 'partial' | 'failed';
  errors: string[];
}

export type AlertLevel = 'info' | 'warning' | 'critical';

export interface AlertEntry {
  timestamp: string;
  level: AlertLevel;
  type: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface McpRuntimeConfig {
  enabled: boolean;
  transport: 'stdio' | 'sse';
  port: number;
  exposedTools?: string[];
  exposeMemory: boolean;
  exposeAgentState: boolean;
}

export interface GatewayRuntimeConfig {
  bind: string;
  port: number;
  token: string;
  systemPrompt: string | null;
  channels: ChannelSelection[];
  telegramBotToken: string | null;
  telegramAllowedUsers: number[];
  telegramReactions: { processing: string; error: string };
  ollama: OllamaConfig | null;
  anthropicApiKey: string | null;
  openaiApiKey: string | null;
  routing: ModelRoutingConfig | null;
  training: TrainingConfig | null;
  tools: ToolsConfig;
  session: {
    idleTimeoutMinutes: number;
    maxConcurrent: number;
    persistDir?: string;
  };
  autonomous: AutonomousRuntimeConfig | null;
  compaction: CompactionConfig;
  skills: SkillsConfig | null;
  memory: MemoryConfig | null;
  strategies: StrategyConfig | null;
  monitoring: MonitoringConfig | null;
  backup: BackupConfig | null;
  mcp: McpRuntimeConfig | null;
  whisperApiKey: string | null;
  whisperApiUrl: string;
  whisperModel: string;
  whisperProvider: 'openai' | 'huggingface';
  whatsappAccessToken: string | null;
  whatsappPhoneNumberId: string | null;
  whatsappVerifyToken: string | null;
  whatsappAllowedNumbers: string[];
  sdApiUrl: string | null;
  personas: PersonasConfig | null;
  twitter: TwitterConfig | null;
  twitterUsername: string | null;
  twitterPassword: string | null;
  twitterEmail: string | null;
  twitter2faSecret: string | null;
  // --- Discord ---
  discordBotToken: string | null;
  discordAppId: string | null;
  discordAllowedGuilds: string[];
  discordAutoRespond: boolean;
  discordAutoArchiveDuration: 60 | 1440 | 4320 | 10080 | null;
  // --- Cross-Channel Sync ---
  crossChannel: CrossChannelConfig | null;
  // --- Document Memory ---
  documentMemory: import('../core/services/document-memory/types.js').DocumentMemoryConfig | null;
  // --- Streaming ---
  telegramStreaming: StreamingConfig;
  discordStreaming: StreamingConfig;
  // --- Marketplace ---
  marketplace: import('../core/services/marketplace/types.js').MarketplaceConfig | null;
}

// --- Twitter ---

export interface TwitterConfig {
  enabled: boolean;
  cookiesPath: string;
  proxyUrl?: string;
}

// --- Discord ---

export interface DiscordConfig {
  enabled: boolean;
  allowedGuilds?: string[];
  autoRespond?: boolean;
  /** Thread auto-archive duration in minutes (60, 1440, 4320, 10080). */
  autoArchiveDuration?: 60 | 1440 | 4320 | 10080;
}

// --- Cross-Channel Sync ---

export interface ChannelLink {
  /** The canonical conversation ID (e.g. "telegram:1149781995") */
  canonicalId: string;
  /** Aliases that map to the canonical ID (e.g. ["discord:guildId:channelId"]) */
  aliases: string[];
  /** Telegram chat ID for this link (for Telegram dispatch) */
  telegramChatId?: number;
  /** Discord guild ID (for channel directory injection) */
  discordGuildId?: string;
  /** Primary Discord channel ID for this link (for Discord dispatch) */
  discordChannelId?: string;
}

export interface CrossChannelConfig {
  links: ChannelLink[];
}

// --- Personas ---

export interface PersonaDefinition {
  /** Unique identifier (e.g., 'default', 'professor', 'chef') */
  id: string;
  /** Display name shown in /personas listing */
  name: string;
  /** One-line description of the persona */
  description: string;
  /** Full system prompt — replaces config.systemPrompt when active */
  systemPrompt: string;
  /** Preferred TTS voice (alloy, echo, fable, onyx, nova, shimmer) */
  preferredVoice?: string;
}

export interface PersonasConfig {
  enabled: boolean;
  defaultPersonaId: string;
  definitions: PersonaDefinition[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export interface StreamChunk {
  content: string;
  done: boolean;
  provider: LlmProvider;
  model: string;
  toolUse?: ToolUseBlock;
  toolResult?: ToolResultBlock;
  stopReason?: 'end_turn' | 'tool_use';
  usage?: TokenUsage;
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

// --- Credentials ---

export interface CredentialEntry {
  key: string;
  value: string;
  source: 'env-file' | 'environment';
}

export interface CredentialListResult {
  credentials: CredentialEntry[];
  envFilePath: string;
}

export interface CredentialVerifyResult {
  key: string;
  provider: LlmProvider | null;
  valid: boolean;
  error?: string;
}

export interface CredentialRotateResult {
  rotatedKeys: string[];
  newSecrets: GeneratedSecrets;
}

// --- Update ---

export interface VersionCheckResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseNotes?: string;
  publishedAt?: string;
}

export interface UpdateResult {
  success: boolean;
  previousVersion: string;
  newVersion: string;
  pullOutput: string;
  healthCheckPassed: boolean;
  error?: string;
}

// --- Deployment Status ---

export interface ChannelStatus {
  id: ChannelId;
  enabled: boolean;
  connected: boolean;
  error?: string;
}

export interface DeploymentStatus {
  running: boolean;
  containers: string[];
  gatewayHealthy: boolean;
  gatewayUrl: string;
  securityLevel: string;
  channels: ChannelStatus[];
  uptime?: string;
  error?: string;
}

// --- Teardown ---

export interface TeardownResult {
  containersStopped: boolean;
  filesRemoved: string[];
  volumesRemoved: boolean;
  errors: string[];
}
