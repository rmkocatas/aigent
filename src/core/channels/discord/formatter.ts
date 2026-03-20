// ============================================================
// OpenClaw Deploy — Discord Message Formatter
// ============================================================

import { EmbedBuilder } from 'discord.js';

const DISCORD_MAX_LENGTH = 2000;
const EMBED_MAX_DESCRIPTION = 4096;

/**
 * Discord natively supports most standard markdown.
 * Minimal transformation needed — just pass through.
 */
export function formatResponse(llmResponse: string): string {
  return llmResponse;
}

/**
 * Strip all markdown formatting for plain-text fallback.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, '').replace(/```/g, ''))
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '');
}

/**
 * Split a message into chunks that fit within Discord's 2000-char limit.
 * Prefers splitting on paragraph boundaries, then lines, then words.
 * Preserves code blocks that span split points.
 */
export function splitMessage(text: string, maxLength = DISCORD_MAX_LENGTH): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    const candidate = remaining.slice(0, maxLength);
    let splitIdx = -1;

    // 1. Try paragraph boundary (double newline)
    const paraIdx = candidate.lastIndexOf('\n\n');
    if (paraIdx > maxLength * 0.3) {
      splitIdx = paraIdx;
    }

    // 2. Try line boundary
    if (splitIdx === -1) {
      const lineIdx = candidate.lastIndexOf('\n');
      if (lineIdx > maxLength * 0.2) {
        splitIdx = lineIdx;
      }
    }

    // 3. Try word boundary
    if (splitIdx === -1) {
      const spaceIdx = candidate.lastIndexOf(' ');
      if (spaceIdx > maxLength * 0.2) {
        splitIdx = spaceIdx;
      }
    }

    // 4. Hard split
    if (splitIdx === -1) {
      splitIdx = maxLength;
    }

    let chunk = remaining.slice(0, splitIdx);
    remaining = remaining.slice(splitIdx).replace(/^\n+/, '');

    // Handle code block continuity
    const openTicks = (chunk.match(/```/g) || []).length;
    if (openTicks % 2 !== 0) {
      chunk += '\n```';
      remaining = '```\n' + remaining;
    }

    chunks.push(chunk);
  }

  return chunks;
}

/**
 * Build a Discord embed for rich responses.
 */
export function buildEmbed(
  title: string,
  description: string,
  color = 0x5865F2, // Discord blurple
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setDescription(description.slice(0, EMBED_MAX_DESCRIPTION))
    .setColor(color)
    .setTimestamp();
  if (title) embed.setTitle(title.slice(0, 256));
  return embed;
}
