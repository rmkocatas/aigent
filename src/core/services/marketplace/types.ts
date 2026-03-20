// ============================================================
// OpenClaw Deploy — Marketplace Types
// ============================================================

export interface MarketplaceConfig {
  enabled: boolean;
  automationMode: 'supervised' | 'full_auto';
  approvalThresholdEth: number;
  basePriceEth: number;
  maxPriceEth: number;
  /** Minimum profit margin multiplier over estimated API cost (e.g. 2.0 = price must be ≥ 2× cost) */
  profitMargin: number;
  /** Current ETH/USD price for cost conversions (updated periodically or set manually) */
  ethPriceUsd: number;
  advertisedSkills: string[];
  agentDescription: string;
  wsReconnectMs: number;
  pollIntervalMs: number;
  maxConcurrentTasks: number;
  reportChannel: 'telegram' | 'discord';
  reportTargetId: string;
  studyIntervalHours: number;
}

export interface MarketplaceTask {
  id: string;
  title: string;
  description: string;
  category: string;
  budget: string;
  budgetEth: number;
  clientId: string;
  clientRating?: number;
  status: 'open' | 'quoted' | 'accepted' | 'in_progress' | 'submitted' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  deadline?: string;
  requirements?: string[];
  deliverables?: string[];
  tags?: string[];
}

export interface MarketplaceBounty {
  id: string;
  title: string;
  description: string;
  rewardEth: number;
  category: string;
  status: 'open' | 'claimed' | 'completed';
  createdAt: string;
  deadline?: string;
}

export interface EarningsRecord {
  taskId: string;
  title: string;
  amountEth: number;
  apiCostUsd: number;
  profitUsd: number;
  clientId: string;
  completedAt: string;
  category: string;
  durationMs: number;
}

export interface FeedbackEntry {
  taskId: string;
  rating: number;
  comment: string;
  category: string;
  receivedAt: string;
  lessonLearned?: string;
}

export interface WalletInfo {
  address: string;
  agentId: string;
  registeredAt: string;
  onChainMinted: boolean;
}

export interface TaskQuote {
  taskId: string;
  priceEth: number;
  estimatedDurationMinutes: number;
  approach: string;
}

export interface AgentStats {
  totalEarningsEth: number;
  tasksCompleted: number;
  tasksFailed: number;
  averageRating: number;
  completionRate: number;
  registeredAt: string;
}

export interface WsTaskEvent {
  type: 'task_posted' | 'quote_accepted' | 'task_cancelled' | 'payment_released' | 'feedback_received';
  taskId: string;
  data: Record<string, unknown>;
}
