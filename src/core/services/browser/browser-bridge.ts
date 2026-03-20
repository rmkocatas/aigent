// ============================================================
// OpenClaw Deploy — Playwright MCP Browser Bridge
// ============================================================
//
// Spawns Playwright MCP as a headless subprocess via stdio,
// connects as an MCP client, and exposes a simple call() API
// for MoltBot's browser tools to invoke.
// ============================================================

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export interface BrowserBridgeConfig {
  /** Browser or chrome channel to use (default: chromium) */
  browser?: string;
  /** Run headless — false = visible window, harder to detect (default: true) */
  headless?: boolean;
  /** Path to browser executable (e.g. real Chrome instead of bundled Chromium) */
  executablePath?: string;
  /** Persistent user data dir — keeps cookies/history across restarts */
  userDataDir?: string;
  /** Viewport size (default: 1280x720) */
  viewport?: { width: number; height: number };
  /** Additional Playwright MCP CLI args */
  extraArgs?: string[];
}

export class BrowserBridge {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private connected = false;
  private readonly config: BrowserBridgeConfig;

  constructor(config?: BrowserBridgeConfig) {
    this.config = config ?? {};
  }

  async start(): Promise<void> {
    if (this.connected) return;

    const args = [
      '-y', '@playwright/mcp@latest',
      '--browser', this.config.browser ?? 'chromium',
    ];

    // Only add --headless if explicitly requested (default: headed for stealth)
    if (this.config.headless !== false) {
      args.push('--headless');
    }

    if (this.config.executablePath) {
      args.push('--executable-path', this.config.executablePath);
    }

    if (this.config.userDataDir) {
      args.push('--user-data-dir', this.config.userDataDir);
    }

    if (this.config.viewport) {
      args.push('--viewport-size', `${this.config.viewport.width}x${this.config.viewport.height}`);
    }

    if (this.config.extraArgs) {
      args.push(...this.config.extraArgs);
    }

    this.transport = new StdioClientTransport({
      command: 'npx',
      args,
      stderr: 'pipe',
    });

    this.client = new Client(
      { name: 'moltbot-browser', version: '1.0.0' },
    );

    // Log stderr for debugging
    const stderr = this.transport.stderr;
    if (stderr && typeof (stderr as any).on === 'function') {
      (stderr as any).on('data', (chunk: Buffer) => {
        const msg = chunk.toString().trim();
        if (msg) console.log(`[browser-bridge] ${msg}`);
      });
    }

    await this.client.connect(this.transport);
    this.connected = true;
    const mode = this.config.headless === false ? 'headed' : 'headless';
    console.log(`[browser-bridge] Playwright MCP connected (${mode})`);

    // List available tools for logging
    const { tools } = await this.client.listTools();
    console.log(`[browser-bridge] ${tools.length} browser tools available`);
  }

  async stop(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
    this.connected = false;
    console.log('[browser-bridge] Disconnected');
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Call a Playwright MCP tool by name with the given arguments.
   * Returns the text content from the result.
   */
  async call(toolName: string, args: Record<string, unknown> = {}, timeoutMs = 30000): Promise<string> {
    if (!this.client || !this.connected) {
      throw new Error('Browser bridge not connected. Call start() first.');
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Browser tool '${toolName}' timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    const result = await Promise.race([
      this.client.callTool({ name: toolName, arguments: args }),
      timeoutPromise,
    ]);

    // Extract text content from the result
    const contents = result.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    if (!contents || contents.length === 0) {
      return '(no content returned)';
    }

    const parts: string[] = [];
    for (const item of contents) {
      if (item.type === 'text' && item.text) {
        parts.push(item.text);
      } else if (item.type === 'image' && item.data) {
        // Return image as base64 marker for downstream handling
        parts.push(`<<IMAGE_BASE64:${item.mimeType ?? 'image/png'}:${item.data}>>`);
      } else {
        parts.push(JSON.stringify(item));
      }
    }

    return parts.join('\n');
  }

  /**
   * List all available Playwright MCP tools.
   */
  async listTools(): Promise<Array<{ name: string; description?: string }>> {
    if (!this.client || !this.connected) return [];
    const { tools } = await this.client.listTools();
    return tools.map((t) => ({ name: t.name, description: t.description }));
  }
}
