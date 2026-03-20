// ============================================================
// OpenClaw Deploy — Cross-Channel Sync (ChannelLinker)
// ============================================================
//
// Maps channel-specific conversation IDs to a canonical ID so
// that Telegram and Discord (or any two channels) share the
// same session, memory, strategies, and persona state.
//
// Also maintains a cached snapshot of Discord server channels
// for injection into the system prompt (all channels).
// ============================================================

import type { CrossChannelConfig, ChannelLink } from '../../types/index.js';

// ---------------------------------------------------------------------------
// ChannelLinker — conversation ID aliasing
// ---------------------------------------------------------------------------

export class ChannelLinker {
  /** alias → canonicalId */
  private readonly aliasMap = new Map<string, string>();
  /** canonicalId → ChannelLink */
  private readonly linkMap = new Map<string, ChannelLink>();

  constructor(config: CrossChannelConfig | null) {
    if (!config?.links) return;
    for (const link of config.links) {
      this.linkMap.set(link.canonicalId, link);
      for (const alias of link.aliases) {
        this.aliasMap.set(alias, link.canonicalId);
      }
    }
  }

  /** Resolve an alias to its canonical ID, or return unchanged if unlinked. */
  resolveId(conversationId: string): string {
    return this.aliasMap.get(conversationId) ?? conversationId;
  }

  /** Get the link definition for a canonical ID (or its alias). */
  getLink(conversationId: string): ChannelLink | undefined {
    const canonical = this.resolveId(conversationId);
    return this.linkMap.get(canonical);
  }

  /** Check if any link has a Discord guild configured. */
  hasDiscordGuild(): boolean {
    for (const link of this.linkMap.values()) {
      if (link.discordGuildId) return true;
    }
    return false;
  }

  /** Get all Discord guild IDs from configured links. */
  getDiscordGuildIds(): string[] {
    const ids = new Set<string>();
    for (const link of this.linkMap.values()) {
      if (link.discordGuildId) ids.add(link.discordGuildId);
    }
    return [...ids];
  }

  /** Get all configured links. */
  getLinks(): ChannelLink[] {
    return [...this.linkMap.values()];
  }
}

// ---------------------------------------------------------------------------
// DiscordChannelCache — caches listChannels() for system prompt injection
// ---------------------------------------------------------------------------

export interface DiscordChannelInfo {
  id: string;
  name: string;
  type: string;
  topic?: string;
  parentName?: string;
  guildId: string;
  guildName: string;
}

export type ListChannelsFn = (guildId?: string) => Promise<DiscordChannelInfo[]>;

const CACHE_TTL_MS = 5 * 60_000; // 5 minutes

export class DiscordChannelCache {
  private cache: DiscordChannelInfo[] | null = null;
  private cacheTimestamp = 0;
  private readonly listChannels: ListChannelsFn;
  private readonly guildId: string | undefined;
  private refreshPromise: Promise<DiscordChannelInfo[]> | null = null;

  constructor(listChannels: ListChannelsFn, guildId?: string) {
    this.listChannels = listChannels;
    this.guildId = guildId;
  }

  /** Get channels (cached), refreshing if stale. */
  async getChannels(): Promise<DiscordChannelInfo[]> {
    const now = Date.now();
    if (this.cache && now - this.cacheTimestamp < CACHE_TTL_MS) {
      return this.cache;
    }
    // Deduplicate concurrent refresh calls
    if (!this.refreshPromise) {
      this.refreshPromise = this.refresh();
    }
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  /** Force a refresh of the channel list. */
  async refresh(): Promise<DiscordChannelInfo[]> {
    try {
      const channels = await this.listChannels(this.guildId);
      this.cache = channels;
      this.cacheTimestamp = Date.now();
      return channels;
    } catch (err) {
      console.error('[channel-cache] Failed to refresh Discord channels:', (err as Error).message);
      return this.cache ?? [];
    }
  }

  /** Format channel list as compact text for system prompt injection. */
  formatForSystemPrompt(channels?: DiscordChannelInfo[]): string {
    const list = channels ?? this.cache;
    if (!list || list.length === 0) return '';

    const guildName = list[0]?.guildName ?? 'Discord Server';
    const lines: string[] = [`[Discord Server Channels — ${guildName}]`];
    lines.push('Use discord_send_message with the channel ID to post to a specific channel.');
    lines.push('');

    // Group by category
    const categories = new Map<string, DiscordChannelInfo[]>();
    const uncategorized: DiscordChannelInfo[] = [];
    for (const ch of list) {
      if (ch.type === 'category') continue; // Skip category entries themselves
      if (ch.parentName) {
        if (!categories.has(ch.parentName)) categories.set(ch.parentName, []);
        categories.get(ch.parentName)!.push(ch);
      } else {
        uncategorized.push(ch);
      }
    }

    const formatChannel = (ch: DiscordChannelInfo): string => {
      const typeIcon = ch.type === 'forum' ? 'forum' : ch.type === 'voice' ? 'voice' : 'text';
      const topicSuffix = ch.topic ? ` — ${ch.topic}` : '';
      return `  #${ch.name} (${typeIcon}, id:${ch.id})${topicSuffix}`;
    };

    for (const ch of uncategorized) {
      lines.push(formatChannel(ch));
    }

    for (const [catName, channels] of categories) {
      lines.push(`[${catName}]`);
      for (const ch of channels) {
        lines.push(formatChannel(ch));
      }
    }

    return lines.join('\n');
  }
}
