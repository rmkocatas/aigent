// ============================================================
// OpenClaw Deploy — Email Tools (IMAP + Browser fallback)
// ============================================================
//
// Two backends:
//   1. IMAP/SMTP — for providers with standard access (Gmail, Outlook)
//   2. Browser — for providers without IMAP (ProtonMail, etc.)
//      Uses the existing Playwright browser bridge.

import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';
import { getBrowserBridge } from './browser-tools.js';

// ---------------------------------------------------------------------------
// Config injection (singleton pattern)
// ---------------------------------------------------------------------------

interface EmailConfig {
  user: string;
  pass: string;
  fromName: string;
  /** 'imap' for standard IMAP/SMTP, 'browser' for webmail via Playwright */
  mode: 'imap' | 'browser';
  // IMAP-specific
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
  imapSecure?: boolean;
  smtpSecure?: boolean;
  // Browser-specific
  webmailUrl?: string;
}

let emailConfig: EmailConfig | null = null;

export function setEmailConfig(config: EmailConfig): void {
  emailConfig = config;
}

function ensureConfig(): EmailConfig {
  if (!emailConfig) throw new Error('Email not configured. Set EMAIL_USER and EMAIL_PASS in .env');
  return emailConfig;
}

// ---------------------------------------------------------------------------
// Browser helpers (for ProtonMail, etc.)
// ---------------------------------------------------------------------------

async function ensureBrowser() {
  const bridge = getBrowserBridge();
  if (!bridge) throw new Error('Browser bridge not available — needed for webmail access');
  if (!bridge.isConnected()) await bridge.start();
  return bridge;
}

function truncateSnapshot(text: string, max = 12_000): string {
  if (typeof text !== 'string') return String(text ?? '');
  return text.length > max ? text.slice(0, max) + '\n[...truncated]' : text;
}

/** Navigate to ProtonMail and ensure we're logged in. */
async function ensureLoggedIn(bridge: any, cfg: EmailConfig): Promise<void> {
  const webmail = cfg.webmailUrl || 'https://mail.proton.me';

  // Navigate to inbox
  await bridge.call('browser_navigate', { url: `${webmail}/inbox` });
  // Brief wait for page load
  await new Promise((r) => setTimeout(r, 3000));

  let snap = await bridge.call('browser_snapshot');
  const snapText = typeof snap === 'string' ? snap : JSON.stringify(snap);

  // Check if we're on the login page
  if (snapText.includes('Sign in') || snapText.includes('Email or username') || snapText.includes('username')) {
    // Type username
    await bridge.call('browser_click', { element: 'Email or username input', ref: undefined });
    // Try to find and click the username field
    await bridge.call('browser_type', { text: cfg.user, submit: false });
    await new Promise((r) => setTimeout(r, 500));

    // Look for password field or submit
    await bridge.call('browser_click', { element: 'Sign in button or next', ref: undefined });
    await new Promise((r) => setTimeout(r, 2000));

    // Check if we need to enter password separately
    snap = await bridge.call('browser_snapshot');
    const snap2 = typeof snap === 'string' ? snap : JSON.stringify(snap);
    if (snap2.includes('Password') || snap2.includes('password')) {
      await bridge.call('browser_type', { text: cfg.pass, submit: true });
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
}

// ---------------------------------------------------------------------------
// IMAP helpers (dynamic import to avoid failure when not needed)
// ---------------------------------------------------------------------------

async function withImap<T>(fn: (client: any) => Promise<T>): Promise<T> {
  const cfg = ensureConfig();
  const { ImapFlow } = await import('imapflow');
  const secure = cfg.imapSecure ?? (cfg.imapPort === 993);
  const client = new ImapFlow({
    host: cfg.imapHost!,
    port: cfg.imapPort!,
    secure,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
    ...(cfg.imapHost === '127.0.0.1' || cfg.imapHost === 'localhost'
      ? { tls: { rejectUnauthorized: false } }
      : {}),
  });
  try {
    await client.connect();
    return await fn(client);
  } finally {
    await client.logout().catch(() => {});
  }
}

async function createSmtp() {
  const cfg = ensureConfig();
  const { createTransport } = await import('nodemailer');
  const secure = cfg.smtpSecure ?? (cfg.smtpPort === 465);
  return createTransport({
    host: cfg.smtpHost!,
    port: cfg.smtpPort!,
    secure,
    auth: { user: cfg.user, pass: cfg.pass },
    ...(cfg.smtpHost === '127.0.0.1' || cfg.smtpHost === 'localhost'
      ? { tls: { rejectUnauthorized: false } }
      : {}),
  });
}

// ---------------------------------------------------------------------------
// Tool: email_check_inbox
// ---------------------------------------------------------------------------

export const emailCheckInboxDefinition: ToolDefinition = {
  name: 'email_check_inbox',
  description: 'Check the bot email inbox. Returns recent emails with subject, sender, date. Use this to find verification emails after registering on a website.',
  parameters: {
    type: 'object',
    properties: {
      folder: {
        type: 'string',
        description: 'Mailbox folder to check (default: INBOX)',
      },
      limit: {
        type: 'number',
        description: 'Number of recent emails to fetch (default: 10, max: 25)',
      },
      since_minutes: {
        type: 'number',
        description: 'Only show emails from the last N minutes (default: 60)',
      },
    },
    required: [],
  },
  routing: {
    useWhen: [
      'Need to check for verification emails',
      'Looking for confirmation codes or links in email',
      'Checking inbox for new messages',
    ],
    avoidWhen: ['User asks about their own email, not the bot email'],
  },
};

export const emailCheckInboxHandler: ToolHandler = async (input) => {
  const cfg = ensureConfig();

  if (cfg.mode === 'browser') {
    return await checkInboxBrowser(cfg);
  }
  return await checkInboxImap(input);
};

async function checkInboxBrowser(cfg: EmailConfig): Promise<string> {
  const bridge = await ensureBrowser();
  await ensureLoggedIn(bridge, cfg);

  // Take a snapshot of the inbox
  const snap = await bridge.call('browser_snapshot');
  return `ProtonMail inbox snapshot for ${cfg.user}:\n\n${truncateSnapshot(typeof snap === 'string' ? snap : JSON.stringify(snap))}`;
}

async function checkInboxImap(input: Record<string, unknown>): Promise<string> {
  const folder = String(input.folder || 'INBOX');
  const limit = Math.min(Number(input.limit) || 10, 25);
  const sinceMinutes = Number(input.since_minutes) || 60;
  const sinceDate = new Date(Date.now() - sinceMinutes * 60 * 1000);

  return await withImap(async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const messages: string[] = [];
      let count = 0;

      for await (const msg of client.fetch(
        { since: sinceDate },
        { envelope: true, uid: true },
        { uid: true },
      )) {
        if (count >= limit) break;
        const env = msg.envelope;
        messages.push(
          `[UID:${msg.uid}] From: ${env.from?.[0]?.name || ''} <${env.from?.[0]?.address || ''}> | Subject: ${env.subject || '(no subject)'} | Date: ${env.date?.toISOString() || 'unknown'}`,
        );
        count++;
      }

      if (messages.length === 0) {
        return `No emails found in ${folder} from the last ${sinceMinutes} minutes.`;
      }
      return `Found ${messages.length} email(s) in ${folder}:\n\n${messages.join('\n')}`;
    } finally {
      lock.release();
    }
  });
}

// ---------------------------------------------------------------------------
// Tool: email_read_message
// ---------------------------------------------------------------------------

export const emailReadMessageDefinition: ToolDefinition = {
  name: 'email_read_message',
  description: 'Read an email. In browser mode, clicks on an email in the inbox by position or subject keyword. In IMAP mode, reads by UID. Use after email_check_inbox to read verification codes or confirmation links.',
  parameters: {
    type: 'object',
    properties: {
      uid: {
        type: 'number',
        description: 'The email UID (IMAP mode only)',
      },
      subject_contains: {
        type: 'string',
        description: 'Click the email whose subject contains this text (browser mode). Also works in IMAP as a fallback search.',
      },
      position: {
        type: 'number',
        description: 'Click the Nth email in the inbox, 1-based (browser mode, default: 1 = most recent)',
      },
      folder: {
        type: 'string',
        description: 'Mailbox folder (default: INBOX)',
      },
    },
    required: [],
  },
  routing: {
    useWhen: [
      'Need to read the body of a verification email',
      'Extract a code or link from an email',
    ],
  },
};

export const emailReadMessageHandler: ToolHandler = async (input) => {
  const cfg = ensureConfig();

  if (cfg.mode === 'browser') {
    return await readMessageBrowser(cfg, input);
  }
  return await readMessageImap(input);
};

async function readMessageBrowser(cfg: EmailConfig, input: Record<string, unknown>): Promise<string> {
  const bridge = await ensureBrowser();
  await ensureLoggedIn(bridge, cfg);

  const keyword = input.subject_contains ? String(input.subject_contains) : null;

  // Click on an email — either by keyword or by position
  if (keyword) {
    await bridge.call('browser_click', { element: `email with subject containing "${keyword}"` });
  } else {
    // Click first/most recent email in the list
    await bridge.call('browser_click', { element: 'first email in inbox list' });
  }

  await new Promise((r) => setTimeout(r, 2000));

  // Snapshot the opened email
  const snap = await bridge.call('browser_snapshot');
  const content = typeof snap === 'string' ? snap : JSON.stringify(snap);

  return `Email content:\n\n${truncateSnapshot(content)}`;
}

async function readMessageImap(input: Record<string, unknown>): Promise<string> {
  const uid = Number(input.uid);
  if (!uid || uid <= 0) throw new Error('Invalid email UID. Use email_check_inbox first to find the UID.');
  const folder = String(input.folder || 'INBOX');

  return await withImap(async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const msg = await client.fetchOne(
        String(uid),
        { envelope: true, source: true },
        { uid: true },
      );

      if (!msg) return `No email found with UID ${uid}`;

      const env = msg.envelope;
      const source = msg.source?.toString('utf-8') || '';

      let body = extractTextBody(source);
      if (body.length > 8000) {
        body = body.slice(0, 8000) + '\n\n[... truncated]';
      }

      return [
        `From: ${env.from?.[0]?.name || ''} <${env.from?.[0]?.address || ''}>`,
        `To: ${env.to?.[0]?.address || ''}`,
        `Subject: ${env.subject || '(no subject)'}`,
        `Date: ${env.date?.toISOString() || 'unknown'}`,
        ``,
        `--- Body ---`,
        body,
      ].join('\n');
    } finally {
      lock.release();
    }
  });
}

// ---------------------------------------------------------------------------
// Tool: email_send
// ---------------------------------------------------------------------------

export const emailSendDefinition: ToolDefinition = {
  name: 'email_send',
  description: 'Send an email from the bot email address. In browser mode, composes and sends via webmail UI. Use for replying to verification emails or any email communication needed.',
  parameters: {
    type: 'object',
    properties: {
      to: {
        type: 'string',
        description: 'Recipient email address',
      },
      subject: {
        type: 'string',
        description: 'Email subject line',
      },
      body: {
        type: 'string',
        description: 'Email body text (plain text)',
      },
    },
    required: ['to', 'subject', 'body'],
  },
  routing: {
    useWhen: ['Need to send an email or reply to one'],
    avoidWhen: ['User wants to send from their own email'],
  },
};

export const emailSendHandler: ToolHandler = async (input) => {
  const cfg = ensureConfig();
  const to = String(input.to);
  const subject = String(input.subject);
  const body = String(input.body);

  if (!to || !to.includes('@')) throw new Error('Invalid recipient email');
  if (!subject) throw new Error('Subject is required');
  if (!body) throw new Error('Body is required');
  if (body.length > 10_000) throw new Error('Email body too long (max 10,000 chars)');

  if (cfg.mode === 'browser') {
    return await sendEmailBrowser(cfg, to, subject, body);
  }
  return await sendEmailSmtp(cfg, to, subject, body);
};

async function sendEmailBrowser(cfg: EmailConfig, to: string, subject: string, body: string): Promise<string> {
  const bridge = await ensureBrowser();
  const webmail = cfg.webmailUrl || 'https://mail.proton.me';

  await ensureLoggedIn(bridge, cfg);

  // Click compose / new message
  await bridge.call('browser_click', { element: 'New message or Compose button' });
  await new Promise((r) => setTimeout(r, 2000));

  // Fill To field
  await bridge.call('browser_click', { element: 'To field or recipient input' });
  await bridge.call('browser_type', { text: to, submit: false });
  await new Promise((r) => setTimeout(r, 500));

  // Fill Subject
  await bridge.call('browser_click', { element: 'Subject field' });
  await bridge.call('browser_type', { text: subject, submit: false });

  // Fill Body
  await bridge.call('browser_click', { element: 'Message body or compose area' });
  await bridge.call('browser_type', { text: body, submit: false });

  // Send
  await bridge.call('browser_click', { element: 'Send button' });
  await new Promise((r) => setTimeout(r, 2000));

  return `Email sent via ${webmail} to ${to} with subject "${subject}"`;
}

async function sendEmailSmtp(cfg: EmailConfig, to: string, subject: string, body: string): Promise<string> {
  const transport = await createSmtp();
  try {
    const info = await transport.sendMail({
      from: `"${cfg.fromName}" <${cfg.user}>`,
      to,
      subject,
      text: body,
    });
    return `Email sent successfully to ${to}. Message ID: ${info.messageId}`;
  } finally {
    transport.close();
  }
}

// ---------------------------------------------------------------------------
// Tool: email_get_address
// ---------------------------------------------------------------------------

export const emailGetAddressDefinition: ToolDefinition = {
  name: 'email_get_address',
  description: 'Get the bot\'s email address. Use this when registering on websites to know which email to enter in forms.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  routing: {
    useWhen: ['Need to know the bot email address for registration'],
  },
};

export const emailGetAddressHandler: ToolHandler = async () => {
  const cfg = ensureConfig();
  return `Bot email address: ${cfg.user}`;
};

// ---------------------------------------------------------------------------
// Text extraction helpers (IMAP mode)
// ---------------------------------------------------------------------------

function extractTextBody(source: string): string {
  const plainMatch = source.match(
    /Content-Type:\s*text\/plain[^\r\n]*\r?\n(?:Content-[^\r\n]*\r?\n)*\r?\n([\s\S]*?)(?:\r?\n--|\r?\n\.\r?\n|$)/i,
  );
  if (plainMatch) return decodeQuotedPrintable(plainMatch[1].trim());

  const htmlMatch = source.match(
    /Content-Type:\s*text\/html[^\r\n]*\r?\n(?:Content-[^\r\n]*\r?\n)*\r?\n([\s\S]*?)(?:\r?\n--|\r?\n\.\r?\n|$)/i,
  );
  if (htmlMatch) return stripHtml(decodeQuotedPrintable(htmlMatch[1].trim()));

  const headerEnd = source.indexOf('\r\n\r\n');
  if (headerEnd > 0) return stripHtml(source.slice(headerEnd + 4).trim());

  return source.slice(0, 4000);
}

function decodeQuotedPrintable(text: string): string {
  return text
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
