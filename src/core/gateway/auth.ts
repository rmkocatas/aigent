import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export interface AuthResult {
  authenticated: boolean;
  error?: string;
}

export function authenticateRequest(
  req: IncomingMessage,
  expectedToken: string,
): AuthResult {
  const header = req.headers.authorization;

  if (!header) {
    return { authenticated: false, error: 'Missing Authorization header' };
  }

  if (!header.startsWith('Bearer ')) {
    return { authenticated: false, error: 'Invalid Authorization format, expected Bearer token' };
  }

  const token = header.slice(7);

  if (!token) {
    return { authenticated: false, error: 'Empty token' };
  }

  const tokenBuf = Buffer.from(token, 'utf-8');
  const expectedBuf = Buffer.from(expectedToken, 'utf-8');

  if (tokenBuf.length !== expectedBuf.length) {
    return { authenticated: false, error: 'Invalid token' };
  }

  if (!timingSafeEqual(tokenBuf, expectedBuf)) {
    return { authenticated: false, error: 'Invalid token' };
  }

  return { authenticated: true };
}
