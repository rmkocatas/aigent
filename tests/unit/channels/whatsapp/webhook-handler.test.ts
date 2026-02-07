import { describe, it, expect, vi } from 'vitest';
import { verifyWhatsAppWebhook } from '../../../../src/core/channels/whatsapp/webhook-handler.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

function mockRes(): ServerResponse {
  const res = {
    writeHead: vi.fn(),
    end: vi.fn(),
  };
  return res as unknown as ServerResponse;
}

function mockReq(url: string): IncomingMessage {
  return {
    url,
    headers: { host: 'localhost' },
  } as unknown as IncomingMessage;
}

describe('verifyWhatsAppWebhook', () => {
  it('returns challenge when verification succeeds', () => {
    const req = mockReq(
      '/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=my-token&hub.challenge=test-challenge-123',
    );
    const res = mockRes();

    verifyWhatsAppWebhook(req, res, 'my-token');

    expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'text/plain' });
    expect(res.end).toHaveBeenCalledWith('test-challenge-123');
  });

  it('returns 403 when token does not match', () => {
    const req = mockReq(
      '/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=test',
    );
    const res = mockRes();

    verifyWhatsAppWebhook(req, res, 'correct-token');

    expect(res.writeHead).toHaveBeenCalledWith(403, { 'Content-Type': 'application/json' });
  });

  it('returns 403 when mode is not subscribe', () => {
    const req = mockReq(
      '/webhook/whatsapp?hub.mode=unsubscribe&hub.verify_token=my-token&hub.challenge=test',
    );
    const res = mockRes();

    verifyWhatsAppWebhook(req, res, 'my-token');

    expect(res.writeHead).toHaveBeenCalledWith(403, { 'Content-Type': 'application/json' });
  });

  it('returns 403 when challenge is missing', () => {
    const req = mockReq(
      '/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=my-token',
    );
    const res = mockRes();

    verifyWhatsAppWebhook(req, res, 'my-token');

    expect(res.writeHead).toHaveBeenCalledWith(403, { 'Content-Type': 'application/json' });
  });
});
