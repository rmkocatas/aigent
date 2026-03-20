// ============================================================
// OpenClaw Deploy — MoltLaunch Marketplace REST Client
// ============================================================

import type { MarketplaceTask, MarketplaceBounty, TaskQuote, AgentStats, WsTaskEvent } from './types.js';

const API_BASE = 'https://api.moltlaunch.com';

interface SignedRequestOptions {
  method: string;
  path: string;
  body?: unknown;
  privateKey: string;
  agentId: string;
}

export class MarketplaceClient {
  private privateKey: string | null = null;
  private agentId: string | null = null;

  setCredentials(privateKey: string, agentId: string): void {
    this.privateKey = privateKey;
    this.agentId = agentId;
  }

  private async signedFetch(opts: SignedRequestOptions): Promise<Response> {
    // EIP-191 signing via viem
    const { privateKeyToAccount } = await import('viem/accounts');
    const account = privateKeyToAccount(opts.privateKey as `0x${string}`);

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const message = `${opts.method}:${opts.path}:${timestamp}`;
    const signature = await account.signMessage({ message });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Agent-Id': opts.agentId,
      'X-Timestamp': timestamp,
      'X-Signature': signature,
    };

    const url = `${API_BASE}${opts.path}`;
    const fetchOpts: RequestInit = {
      method: opts.method,
      headers,
      signal: AbortSignal.timeout(30_000),
    };
    if (opts.body) {
      fetchOpts.body = JSON.stringify(opts.body);
    }

    return fetch(url, fetchOpts);
  }

  private ensureCredentials(): { privateKey: string; agentId: string } {
    if (!this.privateKey || !this.agentId) {
      throw new Error('Marketplace credentials not set. Run ensureRegistered() first.');
    }
    return { privateKey: this.privateKey, agentId: this.agentId };
  }

  // ── Registration ───────────────────────────────────────────────────

  async register(params: {
    privateKey: string;
    walletAddress: string;
    name: string;
    description: string;
    skills: string[];
  }): Promise<{ agentId: string }> {
    const { privateKeyToAccount } = await import('viem/accounts');
    const account = privateKeyToAccount(params.privateKey as `0x${string}`);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const message = `POST:/api/agents/register:${timestamp}`;
    const signature = await account.signMessage({ message });

    const resp = await fetch(`${API_BASE}/api/agents/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Timestamp': timestamp,
        'X-Signature': signature,
      },
      body: JSON.stringify({
        walletAddress: params.walletAddress,
        name: params.name,
        description: params.description,
        skills: params.skills,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Registration failed (${resp.status}): ${text}`);
    }

    return resp.json() as Promise<{ agentId: string }>;
  }

  // ── Task Discovery ─────────────────────────────────────────────────

  async browseTasks(params?: {
    category?: string;
    minBudgetEth?: number;
    maxBudgetEth?: number;
    limit?: number;
  }): Promise<MarketplaceTask[]> {
    const creds = this.ensureCredentials();
    const query = new URLSearchParams();
    if (params?.category) query.set('category', params.category);
    if (params?.minBudgetEth) query.set('minBudget', params.minBudgetEth.toString());
    if (params?.maxBudgetEth) query.set('maxBudget', params.maxBudgetEth.toString());
    if (params?.limit) query.set('limit', params.limit.toString());

    const path = `/api/tasks?${query.toString()}`;
    const resp = await this.signedFetch({
      method: 'GET',
      path,
      ...creds,
    });

    if (!resp.ok) throw new Error(`Browse tasks failed (${resp.status})`);
    const data = await resp.json() as { tasks: MarketplaceTask[] };
    return data.tasks;
  }

  async browseBounties(params?: {
    category?: string;
    limit?: number;
  }): Promise<MarketplaceBounty[]> {
    const creds = this.ensureCredentials();
    const query = new URLSearchParams();
    if (params?.category) query.set('category', params.category);
    if (params?.limit) query.set('limit', params.limit.toString());

    const path = `/api/bounties?${query.toString()}`;
    const resp = await this.signedFetch({
      method: 'GET',
      path,
      ...creds,
    });

    if (!resp.ok) throw new Error(`Browse bounties failed (${resp.status})`);
    const data = await resp.json() as { bounties: MarketplaceBounty[] };
    return data.bounties;
  }

  // ── Task Lifecycle ─────────────────────────────────────────────────

  async quoteTask(taskId: string, quote: TaskQuote): Promise<void> {
    const creds = this.ensureCredentials();
    const resp = await this.signedFetch({
      method: 'POST',
      path: `/api/tasks/${taskId}/quote`,
      body: quote,
      ...creds,
    });
    if (!resp.ok) throw new Error(`Quote failed (${resp.status})`);
  }

  async acceptTask(taskId: string): Promise<void> {
    const creds = this.ensureCredentials();
    const resp = await this.signedFetch({
      method: 'POST',
      path: `/api/tasks/${taskId}/accept`,
      ...creds,
    });
    if (!resp.ok) throw new Error(`Accept failed (${resp.status})`);
  }

  async submitTask(taskId: string, deliverables: { summary: string; artifacts?: string[] }): Promise<void> {
    const creds = this.ensureCredentials();
    const resp = await this.signedFetch({
      method: 'POST',
      path: `/api/tasks/${taskId}/submit`,
      body: deliverables,
      ...creds,
    });
    if (!resp.ok) throw new Error(`Submit failed (${resp.status})`);
  }

  async sendMessage(taskId: string, message: string): Promise<void> {
    const creds = this.ensureCredentials();
    const resp = await this.signedFetch({
      method: 'POST',
      path: `/api/tasks/${taskId}/messages`,
      body: { message },
      ...creds,
    });
    if (!resp.ok) throw new Error(`Send message failed (${resp.status})`);
  }

  async getTaskDetails(taskId: string): Promise<MarketplaceTask> {
    const creds = this.ensureCredentials();
    const resp = await this.signedFetch({
      method: 'GET',
      path: `/api/tasks/${taskId}`,
      ...creds,
    });
    if (!resp.ok) throw new Error(`Get task failed (${resp.status})`);
    return resp.json() as Promise<MarketplaceTask>;
  }

  // ── Agent Profile ──────────────────────────────────────────────────

  async getAgentStats(): Promise<AgentStats> {
    const creds = this.ensureCredentials();
    const resp = await this.signedFetch({
      method: 'GET',
      path: `/api/agents/${creds.agentId}/stats`,
      ...creds,
    });
    if (!resp.ok) throw new Error(`Get stats failed (${resp.status})`);
    return resp.json() as Promise<AgentStats>;
  }
}
