// ============================================================
// OpenClaw Deploy — Tool Safety Classifier
// ============================================================

import type { SafetyTier } from './types.js';

/**
 * Static safety classification for every known built-in tool.
 * Unknown tools default to 'dangerous' (fail closed).
 */
const TOOL_SAFETY_MAP: Record<string, SafetyTier> = {
  // SAFE: Read-only, no side effects, pure computation
  current_datetime: 'safe',
  calculator: 'safe',
  unit_converter: 'safe',
  color_converter: 'safe',
  timezone_converter: 'safe',
  cron_parser: 'safe',
  json_formatter: 'safe',
  regex_tester: 'safe',
  base64_codec: 'safe',
  hash_tool: 'safe',
  uuid_generator: 'safe',
  password_generator: 'safe',
  random_quote: 'safe',
  csv_analyzer: 'safe',
  dictionary: 'safe',
  read_file: 'safe',
  project_read_file: 'safe',
  memory_read: 'safe',
  note_list: 'safe',
  note_search: 'safe',
  list_reminders: 'safe',
  pomodoro_status: 'safe',

  // MODERATE: Writes to bot-internal storage, minimal external risk
  memory_write: 'moderate',
  note_add: 'moderate',
  note_delete: 'moderate',
  schedule_reminder: 'moderate',
  cancel_reminder: 'moderate',
  pomodoro_start: 'moderate',
  pomodoro_stop: 'moderate',

  // SENSITIVE: File system writes, code execution, external network access
  write_file: 'sensitive',
  project_write_file: 'sensitive',
  run_code: 'sensitive',
  web_search: 'sensitive',
  fetch_url: 'sensitive',
  qr_generator: 'sensitive',
  generate_image: 'sensitive',
  ip_lookup: 'sensitive',
  weather: 'sensitive',
  news_headlines: 'sensitive',
  pdf_reader: 'sensitive',

  // SENSITIVE: Twitter read tools — external network, authenticated API
  twitter_search: 'sensitive',
  twitter_timeline: 'sensitive',
  twitter_read_tweet: 'sensitive',
  twitter_profile: 'sensitive',
  twitter_trends: 'sensitive',

  // DANGEROUS: System-modifying operations — always blocked in autonomous mode
  install_package: 'dangerous',

  // DANGEROUS: Twitter write tools — irreversible public actions on real account
  twitter_post: 'dangerous',
  twitter_like: 'dangerous',
  twitter_retweet: 'dangerous',
  twitter_follow: 'dangerous',
};

const VALID_TIERS = new Set<string>(['safe', 'moderate', 'sensitive', 'dangerous']);

/**
 * Classify a tool's safety tier. User overrides take precedence,
 * then the static map, then defaults to 'dangerous' for unknown tools.
 */
export function classifyToolSafety(
  toolName: string,
  overrides?: Record<string, string>,
): SafetyTier {
  const override = overrides?.[toolName];
  if (override && VALID_TIERS.has(override)) return override as SafetyTier;
  if (TOOL_SAFETY_MAP[toolName]) return TOOL_SAFETY_MAP[toolName];
  return 'dangerous';
}

/**
 * Determine if a tool at the given safety tier requires human approval
 * before autonomous execution.
 */
export function shouldRequireApproval(
  tier: SafetyTier,
  autoApproveModerate: boolean,
): boolean {
  switch (tier) {
    case 'safe':
      return false;
    case 'moderate':
      return !autoApproveModerate;
    case 'sensitive':
      return true;
    case 'dangerous':
      return true;
  }
}
