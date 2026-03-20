import type { IncomingMessage, ServerResponse } from 'node:http';
import { authenticateRequest } from './auth.js';
import { handleHealth, handleWebchat, handleConfig, handleChat } from './handlers.js';
import { handleAdminRoute, type AdminHandlerDeps } from './admin-handlers.js';
import type { WhatsAppBot } from '../channels/whatsapp/bot.js';
import { verifyWhatsAppWebhook, handleWhatsAppWebhook } from '../channels/whatsapp/webhook-handler.js';

export interface RouterDeps extends AdminHandlerDeps {
  whatsappBot?: WhatsAppBot | null;
}

export function createRequestHandler(deps: RouterDeps) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;
    const method = req.method?.toUpperCase() ?? 'GET';

    // CORS — restrict to same-origin only (localhost)
    const origin = req.headers.origin ?? '';
    const allowedOrigins = [
      `http://127.0.0.1:${deps.config.port}`,
      `http://localhost:${deps.config.port}`,
    ];
    if (allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    // No Access-Control-Allow-Origin header if origin doesn't match = browser blocks it
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Public routes — liveness/readiness health checks
    if (method === 'GET' && (path === '/health' || path === '/healthz' || path === '/ready' || path === '/readyz')) {
      handleHealth(req, res);
      return;
    }

    if (method === 'GET' && path === '/') {
      handleWebchat(req, res);
      return;
    }

    // WhatsApp webhook routes (public — Meta verifies via token)
    if (path === '/webhook/whatsapp') {
      if (method === 'GET' && deps.config.whatsappVerifyToken) {
        verifyWhatsAppWebhook(req, res, deps.config.whatsappVerifyToken);
        return;
      }
      if (method === 'POST' && deps.whatsappBot) {
        handleWhatsAppWebhook(req, res, deps.whatsappBot).catch(() => {});
        return;
      }
    }

    // Protected routes
    const authResult = authenticateRequest(req, deps.config.token);
    if (!authResult.authenticated) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: authResult.error }));
      return;
    }

    if (method === 'GET' && path === '/api/config') {
      handleConfig(req, res, deps);
      return;
    }

    if (method === 'POST' && path === '/api/chat') {
      handleChat(req, res, deps);
      return;
    }

    // Admin routes
    if (path.startsWith('/api/admin/')) {
      handleAdminRoute(method, path, req, res, deps).catch((err) => {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      });
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  };
}
