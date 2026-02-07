import type { IncomingMessage, ServerResponse } from 'node:http';
import { authenticateRequest } from './auth.js';
import { handleHealth, handleWebchat, handleConfig, handleChat } from './handlers.js';
import type { HandlerDeps } from './handlers.js';
import type { WhatsAppBot } from '../channels/whatsapp/bot.js';
import { verifyWhatsAppWebhook, handleWhatsAppWebhook } from '../channels/whatsapp/webhook-handler.js';

export interface RouterDeps extends HandlerDeps {
  whatsappBot?: WhatsAppBot | null;
}

export function createRequestHandler(deps: RouterDeps) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;
    const method = req.method?.toUpperCase() ?? 'GET';

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Public routes
    if (method === 'GET' && path === '/health') {
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

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  };
}
