// ============================================================
// OpenClaw Deploy — Twitter/X Client Service (GraphQL)
// ============================================================
//
// Direct GraphQL client for X's internal API. No third-party
// library needed — uses the same endpoints as x.com's web app.
//   - Cookie-based auth (auth_token, ct0, twid)
//   - Per-category rate limiting
//   - Read-only: search, profiles, timelines, tweets, trends
// ============================================================

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TwitterClientConfig {
  username: string;
  password: string;
  email?: string;
  twoFactorSecret?: string;
  cookiesPath: string;
  proxyUrl?: string;
}

export interface TweetSummary {
  id: string;
  text: string;
  username: string;
  displayName: string;
  timestamp: string;
  likes: number;
  retweets: number;
  replies: number;
  views: number;
  url: string;
  profileImageUrl: string;
}

export interface TweetDetail extends TweetSummary {
  isRetweet: boolean;
  isReply: boolean;
  inReplyToId?: string;
  photos: string[];
  videos: string[];
  hashtags: string[];
  quotedTweet?: TweetSummary;
  thread: TweetSummary[];
}

export interface ProfileSummary {
  username: string;
  displayName: string;
  bio: string;
  followersCount: number;
  followingCount: number;
  tweetsCount: number;
  isVerified: boolean;
  joined: string;
  location: string;
  website: string;
  profileImageUrl: string;
}

interface CookieSet {
  auth_token: string;
  ct0: string;
  twid: string;
}

// ---------------------------------------------------------------------------
// Rate limiter (same pattern as ddg-search.ts)
// ---------------------------------------------------------------------------

interface RateLimiter {
  waitIfNeeded(userId: string): Promise<void>;
}

function createRateLimiter(intervalMs: number): RateLimiter {
  const lastByUser = new Map<string, number>();
  return {
    async waitIfNeeded(userId: string): Promise<void> {
      const last = lastByUser.get(userId) ?? 0;
      const elapsed = Date.now() - last;
      if (elapsed < intervalMs) {
        await new Promise((r) => setTimeout(r, intervalMs - elapsed));
      }
      lastByUser.set(userId, Date.now());
    },
  };
}

// ---------------------------------------------------------------------------
// GraphQL endpoint definitions
// ---------------------------------------------------------------------------

const BEARER =
  'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs' +
  '%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

// Query IDs — X rotates these periodically. Auto-refreshed from x.com's JS bundle.
const GQL: Record<string, string> = {
  SearchTimeline: 'ML-n2SfAxx5S_9QMqNejbg',
  HomeTimeline: 'nn16KxqX3E1OdE7WlHB5LA',
  HomeLatestTimeline: 'Odyc0iCUHiGTk7LkJLGvyQ',
  TweetDetail: 'YCNdW_ZytXfV9YR3cJK9kw',
  TweetResultByRestId: '4PdbzTmQ5PTjz9RiureISQ',
  UserByScreenName: 'AWbeRIdkLtqTRN7yL_H8yw',
  UserTweets: 'N2tFDY-MlrLxXJ9F_ZxJGA',
};

// Endpoints that require POST (X returns 404 for GET on these)
const POST_ENDPOINTS = new Set(['SearchTimeline']);

const BASE_FEATURES = {
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  rweb_video_timestamps_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_enhance_cards_enabled: false,
};

const USER_FEATURES = {
  hidden_profile_subscriptions_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  subscriptions_verification_info_is_identity_verified_enabled: true,
  subscriptions_verification_info_verified_since_enabled: true,
  highlights_tweets_tab_ui_enabled: true,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
};

// ---------------------------------------------------------------------------
// TwitterClient
// ---------------------------------------------------------------------------

export class TwitterClient {
  private connected = false;
  private cookies: CookieSet | null = null;
  private readonly config: TwitterClientConfig;

  // Per-category rate limiters
  private readonly searchLimiter = createRateLimiter(3000);
  private readonly readLimiter = createRateLimiter(2000);
  private readonly writeLimiter = createRateLimiter(5000);
  private refreshAttempted = false;

  constructor(config: TwitterClientConfig) {
    this.config = config;
  }

  // ── Lifecycle ─────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.connected) return;

    // Try restoring cookies first
    const restored = await this.restoreCookies();
    if (restored && this.cookies) {
      // Validate cookies with a lightweight API call
      try {
        const profile = await this.fetchGql(
          GQL.UserByScreenName,
          'UserByScreenName',
          { screen_name: this.config.username, withSafetyModeUserFields: true },
          USER_FEATURES,
        );
        if (profile?.data?.user?.result) {
          this.connected = true;
          console.log('[twitter-client] Connected (restored cookies)');
          return;
        }
      } catch {
        // Cookies invalid, fall through
      }
    }

    throw new Error(
      'No valid cookies found. Log into x.com in a browser and copy ' +
      'auth_token, ct0, and twid cookie values to ' + this.config.cookiesPath,
    );
  }

  async stop(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    console.log('[twitter-client] Disconnected');
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ── API Methods ───────────────────────────────────────────

  async search(
    query: string,
    limit: number,
    mode: 'latest' | 'top',
    userId: string,
  ): Promise<TweetSummary[]> {
    await this.ensureConnected();
    await this.searchLimiter.waitIfNeeded(userId);

    const product = mode === 'top' ? 'Top' : 'Latest';
    const resp = await this.fetchGql(
      GQL.SearchTimeline,
      'SearchTimeline',
      {
        rawQuery: query,
        count: Math.min(limit, 50),
        querySource: 'typed_query',
        product,
      },
      { ...BASE_FEATURES, responsive_web_media_download_video_enabled: false },
      'https://x.com/i/api/graphql',
    );

    return this.extractTweetsFromTimeline(resp, limit);
  }

  async postTweet(
    _text: string,
    _replyToId?: string,
    _userId?: string,
  ): Promise<{ success: boolean; message: string }> {
    return { success: false, message: 'Write operations are disabled. This client is read-only.' };
  }

  async getTimeline(
    type: 'home' | 'following',
    count: number,
    userId: string,
  ): Promise<TweetSummary[]> {
    await this.ensureConnected();
    await this.readLimiter.waitIfNeeded(userId);

    const qid = type === 'following' ? GQL.HomeLatestTimeline : GQL.HomeTimeline;
    const name = type === 'following' ? 'HomeLatestTimeline' : 'HomeTimeline';

    const resp = await this.fetchGql(qid, name, {
      count: Math.min(count, 50),
      includePromotedContent: false,
      latestControlAvailable: true,
      requestContext: 'launch',
      withCommunity: true,
      seenTweetIds: [],
    }, BASE_FEATURES);

    return this.extractTweetsFromTimeline(resp, count);
  }

  async readTweet(tweetId: string, userId: string): Promise<TweetDetail | null> {
    await this.ensureConnected();
    await this.readLimiter.waitIfNeeded(userId);

    const resp = await this.fetchGql(
      GQL.TweetDetail,
      'TweetDetail',
      {
        focalTweetId: tweetId,
        with_rux_injections: false,
        includePromotedContent: false,
        withCommunity: true,
        withQuickPromoteEligibilityTweetFields: true,
        withBirdwatchNotes: true,
        withVoice: true,
        withV2Timeline: true,
      },
      { ...BASE_FEATURES, responsive_web_media_download_video_enabled: true },
    );

    return this.extractTweetDetail(resp, tweetId);
  }

  async likeTweet(_tweetId: string, _userId: string): Promise<void> {
    throw new Error('Write operations are disabled. This client is read-only.');
  }

  async retweet(_tweetId: string, _userId: string): Promise<void> {
    throw new Error('Write operations are disabled. This client is read-only.');
  }

  async followUser(_username: string, _userId: string): Promise<void> {
    throw new Error('Write operations are disabled. This client is read-only.');
  }

  async getProfile(username: string, userId: string): Promise<ProfileSummary | null> {
    await this.ensureConnected();
    await this.readLimiter.waitIfNeeded(userId);

    const resp = await this.fetchGql(
      GQL.UserByScreenName,
      'UserByScreenName',
      { screen_name: username, withSafetyModeUserFields: true },
      USER_FEATURES,
    );

    const user = resp?.data?.user?.result;
    if (!user?.legacy) return null;

    const l = user.legacy;
    return {
      username: l.screen_name ?? username,
      displayName: l.name ?? '',
      bio: l.description ?? '',
      followersCount: l.followers_count ?? 0,
      followingCount: l.friends_count ?? 0,
      tweetsCount: l.statuses_count ?? 0,
      isVerified: user.is_blue_verified ?? l.verified ?? false,
      joined: l.created_at
        ? new Date(l.created_at).toISOString().split('T')[0]
        : '',
      location: l.location ?? '',
      website: l.entities?.url?.urls?.[0]?.expanded_url ?? '',
      profileImageUrl: l.profile_image_url_https?.replace('_normal', '_400x400') ?? '',
    };
  }

  async getTrends(userId: string): Promise<string[]> {
    await this.ensureConnected();
    await this.readLimiter.waitIfNeeded(userId);

    // Trends use a REST endpoint, not GraphQL
    const params = new URLSearchParams({
      count: '20',
      candidate_source: 'trends',
      include_page_configuration: 'false',
      entity_tokens: 'false',
    });

    const resp = await fetch(
      `https://x.com/i/api/2/guide.json?${params}`,
      { headers: this.buildHeaders() },
    );

    if (!resp.ok) {
      // Fallback: try the explore timeline
      return this.getTrendsFallback(userId);
    }

    const data = await resp.json() as any;
    const trends: string[] = [];

    // Extract trend names from the guide response
    const instructions = data?.timeline?.instructions ?? [];
    for (const instr of instructions) {
      const entries = instr?.addEntries?.entries ?? instr?.entries ?? [];
      for (const entry of entries) {
        const items = entry?.content?.timelineModule?.items ??
          [entry?.content?.item];
        for (const item of items) {
          const trend = item?.itemContent?.trend_metadata ??
            item?.content?.trend_metadata ??
            item?.itemContent?.trend ??
            item?.content?.trend;
          const name = trend?.name ?? item?.itemContent?.name ?? item?.content?.name;
          if (name && !trends.includes(name)) {
            trends.push(name);
          }
        }
      }
    }

    return trends;
  }

  // ── Internal: GraphQL fetch ──────────────────────────────

  private async fetchGql(
    queryId: string,
    operationName: string,
    variables: Record<string, any>,
    features: Record<string, boolean>,
    baseUrl = 'https://x.com/i/api/graphql',
  ): Promise<any> {
    const usePost = POST_ENDPOINTS.has(operationName);
    const endpoint = `${baseUrl}/${queryId}/${operationName}`;

    let resp: Response;

    if (usePost) {
      // POST with JSON body
      resp = await fetch(endpoint, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({ variables, features, fieldToggles: {} }),
      });
    } else {
      // GET with query params
      const url =
        `${endpoint}?` +
        `variables=${encodeURIComponent(JSON.stringify(variables))}` +
        `&features=${encodeURIComponent(JSON.stringify(features))}`;
      resp = await fetch(url, { headers: this.buildHeaders() });
    }

    if (resp.status === 401 || resp.status === 403) {
      this.connected = false;
      throw new Error(`Twitter API auth error (${resp.status}). Cookies may have expired.`);
    }

    // If 404, try refreshing query IDs and retry once
    if (resp.status === 404 && !this.refreshAttempted) {
      this.refreshAttempted = true;
      const wasPost = usePost;
      await this.refreshQueryIds();
      const newId = GQL[operationName] ?? queryId;
      const nowPost = POST_ENDPOINTS.has(operationName);
      // Retry if query ID changed OR method changed (GET→POST)
      if (newId !== queryId || nowPost !== wasPost) {
        console.log(`[twitter-client] Refreshed ${operationName}: ${queryId} → ${newId}${nowPost !== wasPost ? ' (switched to POST)' : ''}`);
        return this.fetchGql(newId, operationName, variables, features, baseUrl);
      }
      this.refreshAttempted = false;
    }

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Twitter API error ${resp.status}: ${body.slice(0, 200)}`);
    }

    this.refreshAttempted = false;
    return resp.json();
  }

  /** Auto-refresh query IDs by scraping x.com's JS bundle */
  private async refreshQueryIds(): Promise<boolean> {
    try {
      console.log('[twitter-client] Refreshing GraphQL query IDs from x.com...');

      // Step 1: Fetch x.com homepage to find main.js URL
      const homepageResp = await fetch('https://x.com', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(10_000),
      });
      const html = await homepageResp.text();
      const mainJsMatch = html.match(/https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/main\.[a-f0-9]+\.js/);
      if (!mainJsMatch) return false;

      // Step 2: Fetch main.js and extract query IDs
      const jsResp = await fetch(mainJsMatch[0], {
        signal: AbortSignal.timeout(15_000),
      });
      const js = await jsResp.text();

      let updated = false;
      for (const opName of Object.keys(GQL)) {
        const pattern = new RegExp(`queryId:"([^"]+)",operationName:"${opName}"`);
        const match = js.match(pattern);
        if (match && match[1] !== GQL[opName]) {
          GQL[opName] = match[1];
          updated = true;
        }
      }

      // Step 3: Check if any endpoints now require POST (operationType check)
      for (const opName of Object.keys(GQL)) {
        // Check if GET gives 404 — if so, mark as POST endpoint
        const testUrl = `https://x.com/i/api/graphql/${GQL[opName]}/${opName}?variables=%7B%7D&features=%7B%7D`;
        try {
          const testResp = await fetch(testUrl, {
            method: 'GET',
            headers: this.buildHeaders(),
            signal: AbortSignal.timeout(5_000),
          });
          if (testResp.status === 404) {
            POST_ENDPOINTS.add(opName);
          }
        } catch {
          // Best effort
        }
      }

      if (updated) {
        console.log('[twitter-client] Query IDs updated:', JSON.stringify(GQL));
      } else {
        console.log('[twitter-client] Query IDs already current');
      }
      return updated;
    } catch (err) {
      console.error('[twitter-client] Failed to refresh query IDs:', (err as Error).message);
      return false;
    }
  }

  private buildHeaders(): Record<string, string> {
    if (!this.cookies) throw new Error('No cookies available');
    return {
      Authorization: BEARER,
      Cookie: `auth_token=${this.cookies.auth_token}; ct0=${this.cookies.ct0}; twid=${this.cookies.twid}`,
      'x-csrf-token': this.cookies.ct0,
      'x-twitter-auth-type': 'OAuth2Session',
      'x-twitter-active-user': 'yes',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Content-Type': 'application/json',
    };
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected) {
      throw new Error('Twitter client not connected. Check cookies in ' + this.config.cookiesPath);
    }
  }

  // ── Cookie persistence ────────────────────────────────────

  private async saveCookies(): Promise<void> {
    if (!this.cookies) return;
    try {
      await mkdir(dirname(this.config.cookiesPath), { recursive: true });
      await writeFile(
        this.config.cookiesPath,
        JSON.stringify(this.cookies, null, 2),
        'utf-8',
      );
    } catch (err) {
      console.error('[twitter-client] Failed to save cookies:', (err as Error).message);
    }
  }

  private async restoreCookies(): Promise<boolean> {
    try {
      const raw = await readFile(this.config.cookiesPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed.auth_token && parsed.ct0 && parsed.twid) {
        this.cookies = parsed as CookieSet;
        return true;
      }
    } catch {
      // No cookies file or invalid — not an error
    }
    return false;
  }

  // ── Response parsers ──────────────────────────────────────

  private extractTweetsFromTimeline(resp: any, limit: number): TweetSummary[] {
    const tweets: TweetSummary[] = [];
    const instructions =
      resp?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions ??
      resp?.data?.home?.home_timeline_urt?.instructions ??
      [];

    for (const instr of instructions) {
      const entries = instr?.entries ?? [];
      for (const entry of entries) {
        const result =
          entry?.content?.itemContent?.tweet_results?.result ??
          entry?.content?.items?.[0]?.item?.itemContent?.tweet_results?.result;
        if (!result) continue;

        const tweet = this.parseTweetResult(result);
        if (tweet) {
          tweets.push(tweet);
          if (tweets.length >= limit) return tweets;
        }
      }
    }
    return tweets;
  }

  private extractTweetDetail(resp: any, focalId: string): TweetDetail | null {
    const instructions =
      resp?.data?.threaded_conversation_with_injections_v2?.instructions ?? [];

    let focalTweet: TweetDetail | null = null;
    const thread: TweetSummary[] = [];

    for (const instr of instructions) {
      const entries = instr?.entries ?? [];
      for (const entry of entries) {
        // Single tweet entry
        const singleResult =
          entry?.content?.itemContent?.tweet_results?.result;
        if (singleResult) {
          const parsed = this.parseTweetResult(singleResult);
          if (parsed && parsed.id === focalId) {
            focalTweet = this.toTweetDetail(singleResult, parsed);
          } else if (parsed) {
            thread.push(parsed);
          }
          continue;
        }

        // Conversation module (thread items)
        const items = entry?.content?.items ?? [];
        for (const item of items) {
          const itemResult = item?.item?.itemContent?.tweet_results?.result;
          if (!itemResult) continue;
          const parsed = this.parseTweetResult(itemResult);
          if (parsed && parsed.id === focalId) {
            focalTweet = this.toTweetDetail(itemResult, parsed);
          } else if (parsed) {
            thread.push(parsed);
          }
        }
      }
    }

    if (focalTweet) {
      focalTweet.thread = thread;
    }
    return focalTweet;
  }

  private parseTweetResult(result: any): TweetSummary | null {
    // Handle tombstone / unavailable tweets
    if (result?.__typename === 'TweetTombstone') return null;

    // Unwrap TweetWithVisibilityResults
    const tweet = result?.tweet ?? result;
    const legacy = tweet?.legacy;
    if (!legacy) return null;

    const user = tweet?.core?.user_results?.result?.legacy;
    const views = tweet?.views?.count;

    return {
      id: legacy.id_str ?? tweet.rest_id ?? '',
      text: legacy.full_text ?? '',
      username: user?.screen_name ?? '',
      displayName: user?.name ?? '',
      timestamp: legacy.created_at
        ? new Date(legacy.created_at).toISOString()
        : '',
      likes: legacy.favorite_count ?? 0,
      retweets: legacy.retweet_count ?? 0,
      replies: legacy.reply_count ?? 0,
      views: views ? Number(views) : 0,
      url: user?.screen_name && legacy.id_str
        ? `https://x.com/${user.screen_name}/status/${legacy.id_str}`
        : '',
      profileImageUrl: user?.profile_image_url_https ?? '',
    };
  }

  private toTweetDetail(result: any, summary: TweetSummary): TweetDetail {
    const tweet = result?.tweet ?? result;
    const legacy = tweet?.legacy;

    const photos: string[] = [];
    const videos: string[] = [];
    const media = legacy?.entities?.media ?? legacy?.extended_entities?.media ?? [];
    for (const m of media) {
      if (m.type === 'photo') {
        photos.push(m.media_url_https ?? m.media_url ?? '');
      } else if (m.type === 'video' || m.type === 'animated_gif') {
        const best = m.video_info?.variants
          ?.filter((v: any) => v.content_type === 'video/mp4')
          ?.sort((a: any, b: any) => (b.bitrate ?? 0) - (a.bitrate ?? 0))?.[0];
        videos.push(best?.url ?? m.media_url_https ?? '');
      }
    }

    const hashtags = (legacy?.entities?.hashtags ?? []).map(
      (h: any) => h.text ?? '',
    );

    let quotedTweet: TweetSummary | undefined;
    const quotedResult = tweet?.quoted_status_result?.result;
    if (quotedResult) {
      quotedTweet = this.parseTweetResult(quotedResult) ?? undefined;
    }

    return {
      ...summary,
      isRetweet: !!legacy?.retweeted_status_result,
      isReply: !!legacy?.in_reply_to_status_id_str,
      inReplyToId: legacy?.in_reply_to_status_id_str ?? undefined,
      photos,
      videos,
      hashtags,
      quotedTweet,
      thread: [],
    };
  }

  private async getTrendsFallback(_userId: string): Promise<string[]> {
    // Fallback: search for trending topics via explore
    try {
      const resp = await this.fetchGql(
        GQL.SearchTimeline,
        'SearchTimeline',
        {
          rawQuery: 'trending',
          count: 20,
          querySource: 'typed_query',
          product: 'Top',
        },
        BASE_FEATURES,
        'https://x.com/i/api/graphql',
      );
      // Just return empty — trends are best-effort
      return [];
    } catch {
      return [];
    }
  }
}
