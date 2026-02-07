// ============================================================
// OpenClaw Deploy — Credentials Manager
// ============================================================

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  CredentialEntry,
  CredentialListResult,
  CredentialVerifyResult,
  CredentialRotateResult,
  GeneratedSecrets,
  LlmProvider,
} from '../../types/index.js';
import { generateGatewayToken, generateEncryptionKey } from '../security/token-generator.js';
import { validateApiKey } from '../config/validator.js';

const ENV_FILENAME = '.env';

const PROVIDER_ENDPOINTS: Record<string, { url: string; authHeader: string }> = {
  anthropic: {
    url: 'https://api.anthropic.com/v1/models',
    authHeader: 'x-api-key',
  },
  openai: {
    url: 'https://api.openai.com/v1/models',
    authHeader: 'Authorization',
  },
  gemini: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models',
    authHeader: '',
  },
  openrouter: {
    url: 'https://openrouter.ai/api/v1/models',
    authHeader: 'Authorization',
  },
};

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

export function parseEnvFile(content: string): CredentialEntry[] {
  const entries: CredentialEntry[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();

    if (key) {
      entries.push({ key, value, source: 'env-file' });
    }
  }

  return entries;
}

export function serializeEnvFile(
  originalContent: string,
  updates: Record<string, string>,
): string {
  const lines = originalContent.split('\n');
  const updatedKeys = new Set<string>();
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Preserve comments and blank lines
    if (!trimmed || trimmed.startsWith('#')) {
      result.push(line);
      continue;
    }

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      result.push(line);
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();

    if (key in updates) {
      result.push(`${key}=${updates[key]}`);
      updatedKeys.add(key);
    } else {
      result.push(line);
    }
  }

  // Append any new keys that weren't in the original file
  for (const [key, value] of Object.entries(updates)) {
    if (!updatedKeys.has(key)) {
      result.push(`${key}=${value}`);
    }
  }

  return result.join('\n');
}

export function maskCredentialValue(value: string): string {
  if (!value || value.length <= 8) {
    return '****';
  }
  return value.slice(0, 4) + '****' + value.slice(-4);
}

// ---------------------------------------------------------------------------
// Async operations
// ---------------------------------------------------------------------------

export async function listCredentials(installDir: string): Promise<CredentialListResult> {
  const envFilePath = join(installDir, ENV_FILENAME);
  const content = await readFile(envFilePath, 'utf-8');
  const credentials = parseEnvFile(content);
  return { credentials, envFilePath };
}

export async function setCredential(
  installDir: string,
  key: string,
  value: string,
): Promise<void> {
  const envFilePath = join(installDir, ENV_FILENAME);
  const content = await readFile(envFilePath, 'utf-8');
  const updated = serializeEnvFile(content, { [key]: value });
  await writeFile(envFilePath, updated, 'utf-8');
}

export async function rotateSecrets(installDir: string): Promise<CredentialRotateResult> {
  const newToken = generateGatewayToken();
  const newKey = generateEncryptionKey();

  const envFilePath = join(installDir, ENV_FILENAME);
  const content = await readFile(envFilePath, 'utf-8');
  const updated = serializeEnvFile(content, {
    OPENCLAW_GATEWAY_TOKEN: newToken,
    OPENCLAW_MASTER_ENCRYPTION_KEY: newKey,
  });
  await writeFile(envFilePath, updated, 'utf-8');

  return {
    rotatedKeys: ['OPENCLAW_GATEWAY_TOKEN', 'OPENCLAW_MASTER_ENCRYPTION_KEY'],
    newSecrets: {
      gatewayToken: newToken,
      masterEncryptionKey: newKey,
    },
  };
}

export async function loadSecrets(installDir: string): Promise<GeneratedSecrets> {
  const envFilePath = join(installDir, ENV_FILENAME);
  const content = await readFile(envFilePath, 'utf-8');
  const entries = parseEnvFile(content);

  const tokenEntry = entries.find((e) => e.key === 'OPENCLAW_GATEWAY_TOKEN');
  const keyEntry = entries.find((e) => e.key === 'OPENCLAW_MASTER_ENCRYPTION_KEY');

  return {
    gatewayToken: tokenEntry?.value ?? '',
    masterEncryptionKey: keyEntry?.value ?? '',
  };
}

export async function verifyCredentials(installDir: string): Promise<CredentialVerifyResult[]> {
  const { credentials } = await listCredentials(installDir);
  const results: CredentialVerifyResult[] = [];

  for (const entry of credentials) {
    // Only verify API key entries
    if (!entry.key.endsWith('_API_KEY')) continue;

    const formatCheck = validateApiKey(entry.value);

    if (!formatCheck.valid) {
      results.push({
        key: entry.key,
        provider: null,
        valid: false,
        error: 'Invalid key format',
      });
      continue;
    }

    const provider = formatCheck.provider as LlmProvider;

    // Attempt live verification
    const liveResult = await verifyApiKeyLive(entry.value, provider);
    results.push({
      key: entry.key,
      provider,
      valid: liveResult.valid,
      error: liveResult.error,
    });
  }

  return results;
}

async function verifyApiKeyLive(
  key: string,
  provider: LlmProvider,
): Promise<{ valid: boolean; error?: string }> {
  const endpoint = PROVIDER_ENDPOINTS[provider];
  if (!endpoint) {
    return { valid: true }; // No live check available, trust format
  }

  try {
    const headers: Record<string, string> = {};

    if (provider === 'gemini') {
      // Gemini uses query parameter
      const url = `${endpoint.url}?key=${key}`;
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(10000),
      });
      return response.ok
        ? { valid: true }
        : { valid: false, error: `HTTP ${response.status}` };
    }

    if (endpoint.authHeader === 'Authorization') {
      headers['Authorization'] = `Bearer ${key}`;
    } else {
      headers[endpoint.authHeader] = key;
    }

    const response = await fetch(endpoint.url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10000),
    });

    return response.ok
      ? { valid: true }
      : { valid: false, error: `HTTP ${response.status}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { valid: false, error: `Network error: ${message}` };
  }
}
