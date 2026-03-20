// ============================================================
// OpenClaw Deploy — MoltLaunch WebSocket Listener
// ============================================================

import WebSocket from 'ws';
import type { WsTaskEvent } from './types.js';

const WS_URL = 'wss://api.moltlaunch.com/ws';

export class MarketplaceWsListener {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly reconnectMs: number;
  private readonly agentId: string;
  private readonly signature: string;
  private running = false;
  private onEvent: ((event: WsTaskEvent) => void) | null = null;

  constructor(opts: { agentId: string; signature: string; reconnectMs: number }) {
    this.agentId = opts.agentId;
    this.signature = opts.signature;
    this.reconnectMs = opts.reconnectMs;
  }

  setEventHandler(handler: (event: WsTaskEvent) => void): void {
    this.onEvent = handler;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.connect();
  }

  stop(): void {
    this.running = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private connect(): void {
    if (!this.running) return;

    try {
      this.ws = new WebSocket(WS_URL, {
        headers: {
          'X-Agent-Id': this.agentId,
          'X-Signature': this.signature,
        },
      });

      this.ws.on('open', () => {
        console.log('[marketplace-ws] Connected');
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const event = JSON.parse(data.toString()) as WsTaskEvent;
          if (this.onEvent) {
            this.onEvent(event);
          }
        } catch (err) {
          console.error('[marketplace-ws] Parse error:', (err as Error).message);
        }
      });

      this.ws.on('close', (code: number) => {
        console.log(`[marketplace-ws] Disconnected (code=${code})`);
        this.scheduleReconnect();
      });

      this.ws.on('error', (err: Error) => {
        console.error('[marketplace-ws] Error:', err.message);
        // close event will fire after error, triggering reconnect
      });
    } catch (err) {
      console.error('[marketplace-ws] Connect error:', (err as Error).message);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.running) return;
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectMs);
  }
}
