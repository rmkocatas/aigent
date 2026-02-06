// ============================================================
// OpenClaw Deploy — Secure Token Generation
// ============================================================

import { randomBytes } from 'node:crypto';
import type { GeneratedSecrets } from '../../types/index.js';

export function generateGatewayToken(): string {
  return randomBytes(32).toString('hex');
}

export function generateEncryptionKey(): string {
  return randomBytes(32).toString('hex');
}

export function generateRandomPassword(length = 24): string {
  const bytes = Math.ceil((length * 3) / 4);
  return randomBytes(bytes)
    .toString('base64url')
    .slice(0, length);
}

export function generateSecrets(): GeneratedSecrets {
  return {
    gatewayToken: generateGatewayToken(),
    masterEncryptionKey: generateEncryptionKey(),
  };
}
