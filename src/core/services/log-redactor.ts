// ============================================================
// OpenClaw Deploy — Log Redaction Utility
// ============================================================
//
// Replaces known secret patterns in strings before they reach
// console output or log files.  Applied at key logging points
// so that API keys, tokens, and passwords are never exposed in
// plain text in terminal or log-aggregation systems.
// ============================================================

const REDACTION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // Anthropic API keys: sk-ant-api03-...
  { pattern: /sk-ant-api\w{2}-[\w-]{20,}/g, label: 'ANTHROPIC_KEY' },
  // OpenAI API keys: sk-proj-... or sk-...
  { pattern: /sk-(?:proj-)?[A-Za-z0-9]{20,}/g, label: 'API_KEY' },
  // GitHub tokens: ghp_, gho_, ghu_, ghs_, ghr_
  { pattern: /gh[pousr]_[A-Za-z0-9]{36,}/g, label: 'GITHUB_TOKEN' },
  // Telegram bot tokens: 1234567890:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
  { pattern: /\d{8,10}:[A-Za-z0-9_-]{35}/g, label: 'BOT_TOKEN' },
  // Groq API keys
  { pattern: /gsk_[A-Za-z0-9]{20,}/g, label: 'GROQ_KEY' },
  // HuggingFace tokens
  { pattern: /hf_[A-Za-z0-9]{20,}/g, label: 'HF_TOKEN' },
  // Generic Bearer tokens in logged HTTP headers
  { pattern: /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/gi, label: 'BEARER' },
  // Key/token/secret/password assignments in logged config or error text
  { pattern: /(?:key|token|secret|password|apikey|api_key)["']?\s*[:=]\s*["']?[A-Za-z0-9+/=_-]{20,}/gi, label: 'SECRET' },
];

/**
 * Replace known secret patterns in `text` with `[REDACTED:LABEL]`.
 * Safe to call on any string — returns unchanged if no matches.
 */
export function redactSensitive(text: string): string {
  let result = text;
  for (const { pattern, label } of REDACTION_PATTERNS) {
    // Reset lastIndex since patterns use /g flag
    pattern.lastIndex = 0;
    result = result.replace(pattern, `[REDACTED:${label}]`);
  }
  return result;
}
