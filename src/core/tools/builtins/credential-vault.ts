// ============================================================
// OpenClaw Deploy — Credential Vault Tools
// ============================================================
//
// Encrypted at-rest storage for site credentials that the bot
// creates when registering on websites on behalf of the user.

import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

// ---------------------------------------------------------------------------
// Config injection
// ---------------------------------------------------------------------------

let vaultDir: string | null = null;
let encryptionKey: string | null = null;

export function setVaultConfig(dir: string, masterKey: string): void {
  vaultDir = dir;
  encryptionKey = masterKey;
}

function ensureVault(): { dir: string; key: Buffer } {
  if (!vaultDir || !encryptionKey) {
    throw new Error('Credential vault not configured. Set OPENCLAW_MASTER_ENCRYPTION_KEY in .env');
  }
  // Derive a 32-byte key from the master key
  const key = scryptSync(encryptionKey, 'openclaw-vault-salt', 32);
  return { dir: vaultDir, key };
}

// ---------------------------------------------------------------------------
// Encryption helpers
// ---------------------------------------------------------------------------

interface VaultEntry {
  site: string;
  url: string;
  username: string;
  password: string;
  email: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

interface VaultData {
  version: 1;
  entries: VaultEntry[];
}

function encrypt(text: string, key: Buffer): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // iv:tag:ciphertext (all base64)
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decrypt(packed: string, key: Buffer): string {
  const [ivB64, tagB64, dataB64] = packed.split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data) + decipher.final('utf8');
}

const VAULT_FILE = 'credentials.vault';

async function loadVault(dir: string, key: Buffer): Promise<VaultData> {
  try {
    const raw = await readFile(join(dir, VAULT_FILE), 'utf-8');
    const decrypted = decrypt(raw.trim(), key);
    return JSON.parse(decrypted) as VaultData;
  } catch {
    return { version: 1, entries: [] };
  }
}

async function saveVault(dir: string, key: Buffer, data: VaultData): Promise<void> {
  await mkdir(dir, { recursive: true });
  const json = JSON.stringify(data);
  const encrypted = encrypt(json, key);
  await writeFile(join(dir, VAULT_FILE), encrypted, 'utf-8');
}

// ---------------------------------------------------------------------------
// Tool: credential_store
// ---------------------------------------------------------------------------

export const credentialStoreDefinition: ToolDefinition = {
  name: 'credential_store',
  description: 'Store login credentials for a website after registering. The credentials are encrypted at rest. Use this after successfully creating an account on a website.',
  parameters: {
    type: 'object',
    properties: {
      site: {
        type: 'string',
        description: 'Site name (e.g., "GitHub", "HuggingFace")',
      },
      url: {
        type: 'string',
        description: 'Login page URL',
      },
      username: {
        type: 'string',
        description: 'Username or display name used',
      },
      email: {
        type: 'string',
        description: 'Email used for registration',
      },
      password: {
        type: 'string',
        description: 'Password used for registration',
      },
      notes: {
        type: 'string',
        description: 'Any additional notes (e.g., "used Google OAuth", "2FA enabled")',
      },
    },
    required: ['site', 'url', 'email', 'password'],
  },
  routing: {
    useWhen: ['Just registered on a website, need to save the credentials'],
    avoidWhen: ['User is managing their own password manager'],
  },
};

export const credentialStoreHandler: ToolHandler = async (input) => {
  const { dir, key } = ensureVault();

  const site = String(input.site);
  const url = String(input.url);
  const email = String(input.email);
  const password = String(input.password);
  const username = String(input.username || '');
  const notes = String(input.notes || '');

  if (!site || !url || !email || !password) {
    throw new Error('site, url, email, and password are required');
  }

  const vault = await loadVault(dir, key);

  // Update existing entry for same site, or add new
  const existing = vault.entries.findIndex(
    (e) => e.site.toLowerCase() === site.toLowerCase(),
  );

  const entry: VaultEntry = {
    site,
    url,
    username,
    email,
    password,
    notes,
    createdAt: existing >= 0 ? vault.entries[existing].createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (existing >= 0) {
    vault.entries[existing] = entry;
  } else {
    vault.entries.push(entry);
  }

  await saveVault(dir, key, vault);

  return `Credentials for ${site} stored securely (encrypted). Total entries: ${vault.entries.length}`;
};

// ---------------------------------------------------------------------------
// Tool: credential_list
// ---------------------------------------------------------------------------

export const credentialListDefinition: ToolDefinition = {
  name: 'credential_list',
  description: 'List all stored website credentials. Shows site names, URLs, and usernames (passwords are masked). Use when the user asks what accounts the bot has registered.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  routing: {
    useWhen: ['User asks what accounts exist or what sites they are registered on'],
  },
};

export const credentialListHandler: ToolHandler = async () => {
  const { dir, key } = ensureVault();
  const vault = await loadVault(dir, key);

  if (vault.entries.length === 0) {
    return 'No stored credentials. I haven\'t registered on any sites yet.';
  }

  const lines = vault.entries.map((e) => {
    const maskedPass = e.password.slice(0, 2) + '***' + e.password.slice(-2);
    return `• ${e.site} — ${e.url}\n  Email: ${e.email} | User: ${e.username || '(none)'} | Pass: ${maskedPass}\n  Notes: ${e.notes || '(none)'} | Created: ${e.createdAt.slice(0, 10)}`;
  });

  return `Stored credentials (${vault.entries.length}):\n\n${lines.join('\n\n')}`;
};

// ---------------------------------------------------------------------------
// Tool: credential_get
// ---------------------------------------------------------------------------

export const credentialGetDefinition: ToolDefinition = {
  name: 'credential_get',
  description: 'Get full credentials for a specific site (including unmasked password). Use when the user needs to log in to a specific site or when the bot needs to re-authenticate.',
  parameters: {
    type: 'object',
    properties: {
      site: {
        type: 'string',
        description: 'Site name to look up (case-insensitive)',
      },
    },
    required: ['site'],
  },
  routing: {
    useWhen: ['User needs login credentials for a specific site'],
  },
};

export const credentialGetHandler: ToolHandler = async (input) => {
  const { dir, key } = ensureVault();
  const site = String(input.site).toLowerCase();

  const vault = await loadVault(dir, key);
  const entry = vault.entries.find((e) => e.site.toLowerCase().includes(site));

  if (!entry) {
    return `No credentials found for "${input.site}". Use credential_list to see all stored sites.`;
  }

  return [
    `Credentials for ${entry.site}:`,
    `  URL: ${entry.url}`,
    `  Email: ${entry.email}`,
    `  Username: ${entry.username || '(none)'}`,
    `  Password: ${entry.password}`,
    `  Notes: ${entry.notes || '(none)'}`,
    `  Created: ${entry.createdAt}`,
    `  Updated: ${entry.updatedAt}`,
  ].join('\n');
};
