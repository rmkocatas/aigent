// ============================================================
// OpenClaw Deploy — Twitter Tools (agent-twitter-client)
// ============================================================
//
// Direct Twitter/X integration via agent-twitter-client:
//   - twitter_search: Search tweets
//   - twitter_post: Post a tweet
//   - twitter_timeline: Read home/following timeline
//   - twitter_read_tweet: Read a specific tweet by ID/URL
//   - twitter_like: Like a tweet
//   - twitter_retweet: Retweet
//   - twitter_follow: Follow a user
//   - twitter_profile: Get user profile info
//   - twitter_trends: Get trending topics
// ============================================================

import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';
import type { TwitterClient } from '../../services/twitter/twitter-client.js';

// Singleton — set from server.ts
let client: TwitterClient | null = null;

export function setTwitterClient(c: TwitterClient): void {
  client = c;
}

export function getTwitterClient(): TwitterClient | null {
  return client;
}

function ensureClient(): TwitterClient {
  if (!client) throw new Error('Twitter integration is not configured. Add credentials to .env and enable in openclaw.json.');
  return client;
}

/** Extract tweet ID from a URL or return the input if it's already an ID. */
function extractTweetId(input: string): string {
  const trimmed = input.trim();
  // Match x.com/user/status/ID or twitter.com/user/status/ID
  const match = trimmed.match(/(?:x\.com|twitter\.com)\/\w+\/status\/(\d+)/);
  if (match) return match[1];
  // Already a numeric ID
  if (/^\d+$/.test(trimmed)) return trimmed;
  throw new Error(`Invalid tweet ID or URL: "${trimmed}"`);
}

// ─────────────────────────────────────────────────────────────
// twitter_search
// ─────────────────────────────────────────────────────────────

export const twitterSearchDefinition: ToolDefinition = {
  name: 'twitter_search',
  description:
    'Search tweets on Twitter/X directly. Returns tweet content, authors, engagement metrics, and links. ' +
    'More reliable and detailed than x_search (which uses DuckDuckGo as a proxy).',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query (e.g., "AI agents", "#LLM", "@openai")' },
      max_results: { type: 'number', description: 'Max results to return (1-20, default 10)' },
      mode: { type: 'string', enum: ['latest', 'top'], description: 'Sort mode (default: latest)' },
    },
    required: ['query'],
  },
  routing: {
    useWhen: [
      'User asks about Twitter/X posts, discussions, or trends',
      'User wants to search for tweets or social media reactions',
    ],
    avoidWhen: [
      'User wants general web search (use web_search)',
      'Twitter integration is not configured',
    ],
  },
};

export const twitterSearchHandler: ToolHandler = async (input, context) => {
  const tc = ensureClient();
  const query = input.query as string;
  if (!query) throw new Error('Missing search query');

  const limit = Math.min(Math.max((input.max_results as number) || 10, 1), 20);
  const mode = (input.mode as string) === 'top' ? 'top' : 'latest';

  const tweets = await tc.search(query, limit, mode, context.userId);

  if (tweets.length === 0) return `No tweets found for "${query}".`;

  const lines = tweets.map((t, i) =>
    `${i + 1}. @${t.username}: ${t.text.slice(0, 280)}\n` +
    `   ❤️ ${t.likes} | 🔁 ${t.retweets} | 💬 ${t.replies} | 👁 ${t.views}\n` +
    `   ${t.timestamp} — ${t.url}`,
  );

  return `Twitter search: "${query}" (${tweets.length} results, ${mode})\n\n${lines.join('\n\n')}`;
};

// ─────────────────────────────────────────────────────────────
// twitter_post
// ─────────────────────────────────────────────────────────────

export const twitterPostDefinition: ToolDefinition = {
  name: 'twitter_post',
  description:
    'Post a tweet on the bot\'s Twitter/X account. Can also reply to an existing tweet by providing its ID or URL.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Tweet text (max 280 characters)' },
      reply_to: { type: 'string', description: 'Tweet ID or URL to reply to (optional)' },
    },
    required: ['text'],
  },
  routing: {
    useWhen: [
      'User wants to post or tweet something on Twitter/X',
      'User asks the bot to reply to a tweet',
    ],
    avoidWhen: [
      'User just wants to search or read tweets',
    ],
  },
};

export const twitterPostHandler: ToolHandler = async (input, context) => {
  const tc = ensureClient();
  const text = input.text as string;
  if (!text) throw new Error('Missing tweet text');
  if (text.length > 280) throw new Error(`Tweet too long (${text.length}/280 characters)`);

  const replyTo = input.reply_to ? extractTweetId(input.reply_to as string) : undefined;
  const result = await tc.postTweet(text, replyTo, context.userId);

  if (replyTo) {
    return `Reply posted to tweet ${replyTo}.\n${result.message}`;
  }
  return result.message;
};

// ─────────────────────────────────────────────────────────────
// twitter_timeline
// ─────────────────────────────────────────────────────────────

export const twitterTimelineDefinition: ToolDefinition = {
  name: 'twitter_timeline',
  description:
    'Read the bot\'s Twitter/X home timeline (For You or Following). Shows recent tweets from followed accounts and recommendations.',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['home', 'following'], description: 'Timeline type (default: home)' },
      count: { type: 'number', description: 'Number of tweets to fetch (1-20, default 10)' },
    },
  },
  routing: {
    useWhen: [
      'User asks what\'s on the Twitter timeline or feed',
      'User wants to see recent tweets from followed accounts',
    ],
    avoidWhen: [
      'User wants to search for specific tweets (use twitter_search)',
    ],
  },
};

export const twitterTimelineHandler: ToolHandler = async (input, context) => {
  const tc = ensureClient();
  const type = (input.type as string) === 'following' ? 'following' : 'home';
  const count = Math.min(Math.max((input.count as number) || 10, 1), 20);

  const tweets = await tc.getTimeline(type, count, context.userId);

  if (tweets.length === 0) return 'Timeline is empty.';

  const lines = tweets.map((t, i) =>
    `${i + 1}. @${t.username}: ${t.text.slice(0, 280)}\n` +
    `   ❤️ ${t.likes} | 🔁 ${t.retweets} | 💬 ${t.replies}\n` +
    `   ${t.timestamp} — ${t.url}`,
  );

  return `Twitter ${type} timeline (${tweets.length} tweets):\n\n${lines.join('\n\n')}`;
};

// ─────────────────────────────────────────────────────────────
// twitter_read_tweet
// ─────────────────────────────────────────────────────────────

export const twitterReadTweetDefinition: ToolDefinition = {
  name: 'twitter_read_tweet',
  description:
    'Read a specific tweet by its ID or URL. Returns full content, engagement metrics, media, quotes, and thread context.',
  parameters: {
    type: 'object',
    properties: {
      tweet_id: { type: 'string', description: 'Tweet ID or full URL (e.g., "1234567890" or "https://x.com/user/status/1234567890")' },
    },
    required: ['tweet_id'],
  },
  routing: {
    useWhen: [
      'User shares a tweet URL and wants to know what it says',
      'User asks to read or check a specific tweet',
    ],
    avoidWhen: [],
  },
};

export const twitterReadTweetHandler: ToolHandler = async (input, context) => {
  const tc = ensureClient();
  const tweetId = extractTweetId(input.tweet_id as string);

  const tweet = await tc.readTweet(tweetId, context.userId);
  if (!tweet) return `Tweet ${tweetId} not found or has been deleted.`;

  const parts: string[] = [
    `@${tweet.username} (${tweet.displayName})`,
    tweet.text,
    ``,
    `❤️ ${tweet.likes} | 🔁 ${tweet.retweets} | 💬 ${tweet.replies} | 👁 ${tweet.views}`,
    `Posted: ${tweet.timestamp}`,
    tweet.url,
  ];

  if (tweet.isReply && tweet.inReplyToId) {
    parts.push(`\nReplying to tweet: https://x.com/i/status/${tweet.inReplyToId}`);
  }
  if (tweet.photos.length > 0) {
    parts.push(`\nPhotos: ${tweet.photos.join(', ')}`);
  }
  if (tweet.videos.length > 0) {
    parts.push(`\nVideos: ${tweet.videos.join(', ')}`);
  }
  if (tweet.hashtags.length > 0) {
    parts.push(`\nHashtags: ${tweet.hashtags.map(h => `#${h}`).join(' ')}`);
  }
  if (tweet.quotedTweet) {
    parts.push(`\nQuoted @${tweet.quotedTweet.username}: ${tweet.quotedTweet.text.slice(0, 200)}`);
  }
  if (tweet.thread.length > 1) {
    parts.push(`\nThread (${tweet.thread.length} tweets)`);
  }

  return parts.join('\n');
};

// ─────────────────────────────────────────────────────────────
// twitter_like
// ─────────────────────────────────────────────────────────────

export const twitterLikeDefinition: ToolDefinition = {
  name: 'twitter_like',
  description: 'Like a tweet on Twitter/X.',
  parameters: {
    type: 'object',
    properties: {
      tweet_id: { type: 'string', description: 'Tweet ID or URL to like' },
    },
    required: ['tweet_id'],
  },
  routing: {
    useWhen: ['User asks to like a tweet'],
    avoidWhen: [],
  },
};

export const twitterLikeHandler: ToolHandler = async (input, context) => {
  const tc = ensureClient();
  const tweetId = extractTweetId(input.tweet_id as string);
  await tc.likeTweet(tweetId, context.userId);
  return `Liked tweet ${tweetId}.`;
};

// ─────────────────────────────────────────────────────────────
// twitter_retweet
// ─────────────────────────────────────────────────────────────

export const twitterRetweetDefinition: ToolDefinition = {
  name: 'twitter_retweet',
  description: 'Retweet a tweet on Twitter/X.',
  parameters: {
    type: 'object',
    properties: {
      tweet_id: { type: 'string', description: 'Tweet ID or URL to retweet' },
    },
    required: ['tweet_id'],
  },
  routing: {
    useWhen: ['User asks to retweet something'],
    avoidWhen: [],
  },
};

export const twitterRetweetHandler: ToolHandler = async (input, context) => {
  const tc = ensureClient();
  const tweetId = extractTweetId(input.tweet_id as string);
  await tc.retweet(tweetId, context.userId);
  return `Retweeted tweet ${tweetId}.`;
};

// ─────────────────────────────────────────────────────────────
// twitter_follow
// ─────────────────────────────────────────────────────────────

export const twitterFollowDefinition: ToolDefinition = {
  name: 'twitter_follow',
  description: 'Follow a user on Twitter/X.',
  parameters: {
    type: 'object',
    properties: {
      username: { type: 'string', description: 'Twitter username to follow (without @)' },
    },
    required: ['username'],
  },
  routing: {
    useWhen: ['User asks to follow someone on Twitter/X'],
    avoidWhen: [],
  },
};

export const twitterFollowHandler: ToolHandler = async (input, context) => {
  const tc = ensureClient();
  const username = (input.username as string).replace(/^@/, '');
  await tc.followUser(username, context.userId);
  return `Now following @${username}.`;
};

// ─────────────────────────────────────────────────────────────
// twitter_profile
// ─────────────────────────────────────────────────────────────

export const twitterProfileDefinition: ToolDefinition = {
  name: 'twitter_profile',
  description: 'Get a Twitter/X user\'s profile information — bio, follower count, tweet count, verification status, and more.',
  parameters: {
    type: 'object',
    properties: {
      username: { type: 'string', description: 'Twitter username (without @)' },
    },
    required: ['username'],
  },
  routing: {
    useWhen: [
      'User asks about a Twitter/X user\'s profile or account info',
      'User wants to know who someone is on Twitter',
    ],
    avoidWhen: [],
  },
};

export const twitterProfileHandler: ToolHandler = async (input, context) => {
  const tc = ensureClient();
  const username = (input.username as string).replace(/^@/, '');

  const profile = await tc.getProfile(username, context.userId);
  if (!profile) return `User @${username} not found.`;

  return [
    `@${profile.username} — ${profile.displayName}${profile.isVerified ? ' ✓' : ''}`,
    profile.bio || '(no bio)',
    ``,
    `Followers: ${profile.followersCount.toLocaleString()}`,
    `Following: ${profile.followingCount.toLocaleString()}`,
    `Tweets: ${profile.tweetsCount.toLocaleString()}`,
    profile.location ? `Location: ${profile.location}` : null,
    profile.website ? `Website: ${profile.website}` : null,
    profile.joined ? `Joined: ${profile.joined}` : null,
    `\nhttps://x.com/${profile.username}`,
  ].filter(Boolean).join('\n');
};

// ─────────────────────────────────────────────────────────────
// twitter_trends
// ─────────────────────────────────────────────────────────────

export const twitterTrendsDefinition: ToolDefinition = {
  name: 'twitter_trends',
  description: 'Get currently trending topics on Twitter/X.',
  parameters: {
    type: 'object',
    properties: {},
  },
  routing: {
    useWhen: [
      'User asks what\'s trending on Twitter/X',
      'User wants to know popular topics right now',
    ],
    avoidWhen: [],
  },
};

export const twitterTrendsHandler: ToolHandler = async (_input, context) => {
  const tc = ensureClient();
  const trends = await tc.getTrends(context.userId);

  if (trends.length === 0) return 'No trending topics available.';

  const lines = trends.map((t, i) => `${i + 1}. ${t}`);
  return `Trending on Twitter/X:\n\n${lines.join('\n')}`;
};
