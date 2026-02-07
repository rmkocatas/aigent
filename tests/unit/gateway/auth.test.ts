import { describe, it, expect } from 'vitest';
import { authenticateRequest } from '../../../src/core/gateway/auth.js';
import type { IncomingMessage } from 'node:http';

function mockReq(authHeader?: string): IncomingMessage {
  return {
    headers: authHeader !== undefined ? { authorization: authHeader } : {},
  } as unknown as IncomingMessage;
}

const TOKEN = 'a'.repeat(64);

describe('authenticateRequest', () => {
  it('authenticates valid Bearer token', () => {
    const result = authenticateRequest(mockReq(`Bearer ${TOKEN}`), TOKEN);
    expect(result.authenticated).toBe(true);
  });

  it('rejects missing Authorization header', () => {
    const result = authenticateRequest(mockReq(), TOKEN);
    expect(result.authenticated).toBe(false);
    expect(result.error).toContain('Missing');
  });

  it('rejects non-Bearer scheme', () => {
    const result = authenticateRequest(mockReq(`Basic ${TOKEN}`), TOKEN);
    expect(result.authenticated).toBe(false);
    expect(result.error).toContain('Bearer');
  });

  it('rejects wrong token', () => {
    const wrong = 'b'.repeat(64);
    const result = authenticateRequest(mockReq(`Bearer ${wrong}`), TOKEN);
    expect(result.authenticated).toBe(false);
    expect(result.error).toContain('Invalid');
  });

  it('rejects token with wrong length', () => {
    const result = authenticateRequest(mockReq('Bearer short'), TOKEN);
    expect(result.authenticated).toBe(false);
    expect(result.error).toContain('Invalid');
  });

  it('rejects empty Bearer value', () => {
    const result = authenticateRequest(mockReq('Bearer '), TOKEN);
    expect(result.authenticated).toBe(false);
  });

  it('is case-sensitive on Bearer keyword', () => {
    const result = authenticateRequest(mockReq(`bearer ${TOKEN}`), TOKEN);
    expect(result.authenticated).toBe(false);
  });
});
