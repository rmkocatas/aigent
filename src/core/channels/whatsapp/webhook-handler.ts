// ============================================================
// OpenClaw Deploy — WhatsApp Webhook Handler
// ============================================================
//
// Handles incoming webhook verification (GET) and message
// delivery (POST) from the WhatsApp Cloud API.
// ============================================================

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WhatsAppMessage } from '../../../types/index.js';
import type { WhatsAppBot } from './bot.js';

// ---------------------------------------------------------------------------
// Webhook verification (GET /webhook/whatsapp)
// ---------------------------------------------------------------------------

export function verifyWhatsAppWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  verifyToken: string,
): void {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === verifyToken && challenge) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(challenge);
  } else {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Verification failed' }));
  }
}

// ---------------------------------------------------------------------------
// Message delivery (POST /webhook/whatsapp)
// ---------------------------------------------------------------------------

export async function handleWhatsAppWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  bot: WhatsAppBot,
): Promise<void> {
  // Always respond 200 quickly to avoid retries
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok' }));

  try {
    const body = await readBody(req);
    const payload = JSON.parse(body) as WhatsAppWebhookPayload;

    const messages = extractMessages(payload);

    for (const message of messages) {
      // Mark as read
      bot.markAsRead(message.id).catch(() => {});

      // Handle asynchronously (don't block webhook response)
      bot.handleIncomingMessage(message).catch(() => {});
    }
  } catch {
    // Silently ignore malformed webhook payloads
  }
}

// ---------------------------------------------------------------------------
// Payload parsing
// ---------------------------------------------------------------------------

interface WhatsAppWebhookPayload {
  object?: string;
  entry?: Array<{
    id: string;
    changes?: Array<{
      value?: {
        messaging_product?: string;
        metadata?: { phone_number_id: string };
        messages?: WhatsAppMessage[];
        statuses?: unknown[];
      };
      field?: string;
    }>;
  }>;
}

function extractMessages(payload: WhatsAppWebhookPayload): WhatsAppMessage[] {
  const messages: WhatsAppMessage[] = [];

  if (payload.object !== 'whatsapp_business_account') return messages;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue;
      const msgs = change.value?.messages ?? [];
      messages.push(...msgs);
    }
  }

  return messages;
}

// ---------------------------------------------------------------------------
// Body reader
// ---------------------------------------------------------------------------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}
