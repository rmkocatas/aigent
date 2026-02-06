import { describe, it, expect } from 'vitest';
import {
  generateGatewayToken,
  generateEncryptionKey,
  generateRandomPassword,
  generateSecrets,
} from '../../../src/core/security/token-generator.js';

const HEX_PATTERN = /^[0-9a-f]+$/;

describe('generateGatewayToken', () => {
  it('returns a 64-character hex string', () => {
    const token = generateGatewayToken();
    expect(token).toHaveLength(64);
    expect(token).toMatch(HEX_PATTERN);
  });

  it('produces unique values across 100 calls', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 100; i++) {
      tokens.add(generateGatewayToken());
    }
    expect(tokens.size).toBe(100);
  });
});

describe('generateEncryptionKey', () => {
  it('returns a 64-character hex string', () => {
    const key = generateEncryptionKey();
    expect(key).toHaveLength(64);
    expect(key).toMatch(HEX_PATTERN);
  });
});

describe('generateRandomPassword', () => {
  it('returns a URL-safe string of the default length (24)', () => {
    const pw = generateRandomPassword();
    expect(pw).toHaveLength(24);
    // base64url chars: A-Z, a-z, 0-9, -, _
    expect(pw).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('returns a string of the specified length', () => {
    const pw = generateRandomPassword(16);
    expect(pw).toHaveLength(16);
    expect(pw).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('generateSecrets', () => {
  it('returns object with gatewayToken and masterEncryptionKey', () => {
    const secrets = generateSecrets();
    expect(secrets).toHaveProperty('gatewayToken');
    expect(secrets).toHaveProperty('masterEncryptionKey');
    expect(secrets.gatewayToken).toHaveLength(64);
    expect(secrets.gatewayToken).toMatch(HEX_PATTERN);
    expect(secrets.masterEncryptionKey).toHaveLength(64);
    expect(secrets.masterEncryptionKey).toMatch(HEX_PATTERN);
  });

  it('generates different tokens each time', () => {
    const a = generateSecrets();
    const b = generateSecrets();
    expect(a.gatewayToken).not.toBe(b.gatewayToken);
    expect(a.masterEncryptionKey).not.toBe(b.masterEncryptionKey);
  });
});
