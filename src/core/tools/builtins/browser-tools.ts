// ============================================================
// OpenClaw Deploy — Browser Control Tools
// ============================================================
//
// Provides the LLM with interactive web browsing capabilities
// via the Playwright MCP bridge. Supports navigation, reading
// page content, clicking, form filling, and screenshots.
// ============================================================

import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';
import type { BrowserBridge } from '../../services/browser/browser-bridge.js';

// Module-level reference set by server.ts at startup
let bridge: BrowserBridge | null = null;

export function setBrowserBridge(b: BrowserBridge): void {
  bridge = b;
}

export function getBrowserBridge(): BrowserBridge | null {
  return bridge;
}

async function ensureBridge(): Promise<BrowserBridge> {
  if (!bridge) {
    throw new Error('Browser not configured. No browse_* tools in allow list.');
  }
  // Auto-reconnect if bridge disconnected
  if (!bridge.isConnected()) {
    console.log('[browser-tools] Bridge not connected, attempting start...');
    await bridge.start();
  }
  return bridge;
}

// ── browse_navigate ─────────────────────────────────────────

export const browseNavigateDefinition: ToolDefinition = {
  name: 'browse_navigate',
  description:
    'Navigate the browser to a URL and return a text snapshot of the page content. ' +
    'Use this to visit web pages interactively. The snapshot shows page elements with ' +
    'unique IDs (ref="...") that you can use with browse_click and browse_type.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to navigate to (e.g., "https://example.com").',
      },
    },
    required: ['url'],
  },
  routing: {
    useWhen: [
      'User asks to open or visit a specific webpage interactively',
      'User wants to browse a site, fill forms, or interact with a page',
      'User needs to log into a service or navigate through a multi-step web process',
    ],
    avoidWhen: [
      'User just wants to read page content (use fetch_url — faster and cheaper)',
      'User wants to search the web (use web_search)',
    ],
  },
};

// Block non-network protocols (file:, data:, javascript:) — CVE-2026 browser nav bypass
const BLOCKED_PROTOCOLS = new Set(['file:', 'data:', 'javascript:', 'vbscript:', 'blob:']);

function validateBrowseUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (BLOCKED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(
      `Protocol "${parsed.protocol}" is blocked for security. ` +
      'Only http:// and https:// URLs are allowed for browser navigation. ' +
      'about:blank is permitted.',
    );
  }
}

export const browseNavigateHandler: ToolHandler = async (input) => {
  const b = await ensureBridge();
  const url = String(input.url ?? '');
  if (!url) throw new Error('Missing URL');

  // Allow about:blank but block dangerous protocols
  if (url !== 'about:blank') {
    validateBrowseUrl(url);
  }

  // Navigate
  await b.call('browser_navigate', { url });

  // Return page snapshot
  const snapshot = await b.call('browser_snapshot');
  return truncate(snapshot, 15_000);
};

// ── browse_click ────────────────────────────────────────────

export const browseClickDefinition: ToolDefinition = {
  name: 'browse_click',
  description:
    'Click an element on the current page. Use the ref="..." value from a previous ' +
    'browse_navigate or browse_snapshot result to identify the element.',
  parameters: {
    type: 'object',
    properties: {
      element: {
        type: 'string',
        description: 'Description of the element to click (e.g., "Submit button", "Login link").',
      },
      ref: {
        type: 'string',
        description: 'The ref ID from the page snapshot (e.g., "e42").',
      },
    },
    required: ['element', 'ref'],
  },
};

export const browseClickHandler: ToolHandler = async (input) => {
  const b = await ensureBridge();
  const ref = String(input.ref ?? '');
  if (!ref) throw new Error('Missing ref');

  await b.call('browser_click', { element: String(input.element ?? ''), ref });

  // Wait briefly for navigation/JS to settle, then return new snapshot
  await sleep(500);
  const snapshot = await b.call('browser_snapshot');
  return truncate(snapshot, 15_000);
};

// ── browse_type ─────────────────────────────────────────────

export const browseTypeDefinition: ToolDefinition = {
  name: 'browse_type',
  description:
    'Type text into a form field on the current page. First use browse_navigate or ' +
    'browse_snapshot to find the field, then use its ref ID.',
  parameters: {
    type: 'object',
    properties: {
      element: {
        type: 'string',
        description: 'Description of the field (e.g., "Search input", "Email field").',
      },
      ref: {
        type: 'string',
        description: 'The ref ID of the input field from the page snapshot.',
      },
      text: {
        type: 'string',
        description: 'The text to type into the field.',
      },
      submit: {
        type: 'boolean',
        description: 'Whether to press Enter after typing (default: false).',
      },
    },
    required: ['element', 'ref', 'text'],
  },
};

export const browseTypeHandler: ToolHandler = async (input) => {
  const b = await ensureBridge();
  const ref = String(input.ref ?? '');
  const text = String(input.text ?? '');
  if (!ref || !text) throw new Error('Missing ref or text');

  await b.call('browser_type', {
    element: String(input.element ?? ''),
    ref,
    text,
    submit: input.submit === true,
  });

  await sleep(500);
  const snapshot = await b.call('browser_snapshot');
  return truncate(snapshot, 15_000);
};

// ── browse_snapshot ─────────────────────────────────────────

export const browseSnapshotDefinition: ToolDefinition = {
  name: 'browse_snapshot',
  description:
    'Get a text snapshot of the current browser page. Shows all visible elements ' +
    'with ref IDs for interaction. Use this to see what changed after clicking or typing.',
  parameters: {
    type: 'object',
    properties: {},
  },
};

export const browseSnapshotHandler: ToolHandler = async () => {
  const b = await ensureBridge();
  const snapshot = await b.call('browser_snapshot');
  return truncate(snapshot, 15_000);
};

// ── browse_screenshot ───────────────────────────────────────

export const browseScreenshotDefinition: ToolDefinition = {
  name: 'browse_screenshot',
  description:
    'Take a screenshot of the current browser page. Returns the image for visual analysis. ' +
    'Use browse_snapshot for text content instead — it is faster and uses fewer tokens.',
  parameters: {
    type: 'object',
    properties: {},
  },
};

export const browseScreenshotHandler: ToolHandler = async () => {
  const b = await ensureBridge();
  return await b.call('browser_take_screenshot');
};

// ── browse_back ─────────────────────────────────────────────

export const browseBackDefinition: ToolDefinition = {
  name: 'browse_back',
  description: 'Go back to the previous page in browser history.',
  parameters: {
    type: 'object',
    properties: {},
  },
};

export const browseBackHandler: ToolHandler = async () => {
  const b = await ensureBridge();
  await b.call('browser_navigate_back');
  await sleep(500);
  const snapshot = await b.call('browser_snapshot');
  return truncate(snapshot, 15_000);
};

// ── browse_select_option ────────────────────────────────────

export const browseSelectDefinition: ToolDefinition = {
  name: 'browse_select_option',
  description:
    'Select an option from a dropdown/select element on the page.',
  parameters: {
    type: 'object',
    properties: {
      element: {
        type: 'string',
        description: 'Description of the select element.',
      },
      ref: {
        type: 'string',
        description: 'The ref ID of the select element.',
      },
      values: {
        type: 'array',
        items: { type: 'string' },
        description: 'The option value(s) to select.',
      },
    },
    required: ['element', 'ref', 'values'],
  },
};

export const browseSelectHandler: ToolHandler = async (input) => {
  const b = await ensureBridge();
  await b.call('browser_select_option', {
    element: String(input.element ?? ''),
    ref: String(input.ref ?? ''),
    values: input.values ?? [],
  });
  await sleep(300);
  const snapshot = await b.call('browser_snapshot');
  return truncate(snapshot, 15_000);
};

// ── Helpers ─────────────────────────────────────────────────

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '\n\n[... truncated at 15KB]';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
