// ============================================================
// OpenClaw Deploy — Agent Profile Registry
// ============================================================
//
// Stores named agent profiles that the autonomous planner can
// assign to subtasks. Each profile defines a focused system
// prompt, tool subset, and optional routing overrides.
// ============================================================

import type { AgentProfile } from './types.js';
import {
  DEFAULT_HAIKU_MODEL,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_OPUS_MODEL,
} from '../../gateway/provider-router.js';

// ── Built-in Profiles ────────────────────────────────────────

const RESEARCHER_PROFILE: AgentProfile = {
  id: 'researcher',
  name: 'Research Specialist',
  description: 'Web research, information gathering, and summarization',
  systemPromptSuffix:
    'You are a research specialist. Your focus is finding accurate, current information from the web. ' +
    'Always cite your sources. Prioritize authoritative and recent results. ' +
    'Summarize findings concisely with key takeaways.',
  allowedTools: [
    'web_search',
    'fetch_url',
    'knowledge_search',
    'web_clip',
    'summarize_url',
    'read_later_add',
    'memory_recall',
    'memory_remember',
    'current_datetime',
    'calculator',
    'note_add',
  ],
  routingOverride: {
    simple: DEFAULT_HAIKU_MODEL,
    default: DEFAULT_HAIKU_MODEL,
    tool_simple: DEFAULT_HAIKU_MODEL,
    web_content: DEFAULT_OPUS_MODEL,
    coding: DEFAULT_ANTHROPIC_MODEL,
    complex: DEFAULT_ANTHROPIC_MODEL,
  },
};

const CODER_PROFILE: AgentProfile = {
  id: 'coder',
  name: 'Coding Specialist',
  description: 'Code reading, writing, debugging, and project management',
  systemPromptSuffix:
    'You are a coding specialist. Write clean, well-structured code. ' +
    'Always read existing code before making changes. Follow the project\'s conventions. ' +
    'Test your changes when possible.',
  allowedTools: [
    'project_read_file',
    'project_write_file',
    'run_code',
    'git_diff_review',
    'dep_audit',
    'generate_tests',
    'read_file',
    'write_file',
    'current_datetime',
    'calculator',
    'json_formatter',
    'regex_tester',
    'memory_recall',
    'memory_remember',
  ],
  routingOverride: {
    simple: DEFAULT_HAIKU_MODEL,
    default: DEFAULT_HAIKU_MODEL,
    tool_simple: DEFAULT_HAIKU_MODEL,
    coding: DEFAULT_ANTHROPIC_MODEL,
    complex: DEFAULT_ANTHROPIC_MODEL,
    web_content: DEFAULT_ANTHROPIC_MODEL,
  },
};

const ANALYST_PROFILE: AgentProfile = {
  id: 'analyst',
  name: 'Data Analyst',
  description: 'Data analysis, calculations, and structured insights',
  systemPromptSuffix:
    'You are a data analyst. Focus on quantitative analysis, patterns, and insights. ' +
    'Present findings with clear structure: key metrics, trends, and recommendations. ' +
    'Use precise numbers and calculations.',
  allowedTools: [
    'calculator',
    'csv_analyzer',
    'web_search',
    'fetch_url',
    'json_formatter',
    'unit_converter',
    'timezone_converter',
    'current_datetime',
    'memory_recall',
    'memory_remember',
    'note_add',
    'project_read_file',
  ],
  routingOverride: {
    simple: DEFAULT_HAIKU_MODEL,
    default: DEFAULT_HAIKU_MODEL,
    tool_simple: DEFAULT_HAIKU_MODEL,
    coding: DEFAULT_ANTHROPIC_MODEL,
    complex: DEFAULT_ANTHROPIC_MODEL,
    web_content: DEFAULT_ANTHROPIC_MODEL,
  },
};

const GENERALIST_PROFILE: AgentProfile = {
  id: 'generalist',
  name: 'Generalist',
  description: 'Default agent with access to all tools',
  systemPromptSuffix: '',
  allowedTools: [], // empty = all tools (no filtering)
};

// ── Registry ─────────────────────────────────────────────────

export class AgentRegistry {
  private profiles = new Map<string, AgentProfile>();

  constructor() {
    this.register(RESEARCHER_PROFILE);
    this.register(CODER_PROFILE);
    this.register(ANALYST_PROFILE);
    this.register(GENERALIST_PROFILE);
  }

  register(profile: AgentProfile): void {
    this.profiles.set(profile.id, profile);
  }

  get(id: string): AgentProfile | undefined {
    return this.profiles.get(id);
  }

  list(): AgentProfile[] {
    return [...this.profiles.values()];
  }
}
