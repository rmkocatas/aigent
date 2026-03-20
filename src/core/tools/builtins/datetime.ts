// ============================================================
// OpenClaw Deploy — DateTime Tool
// ============================================================

import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

export const datetimeDefinition: ToolDefinition = {
  name: 'current_datetime',
  description: 'Get the current date and time. Optionally specify a timezone (e.g. "America/New_York", "Europe/London", "Asia/Tokyo").',
  parameters: {
    type: 'object',
    properties: {
      timezone: {
        type: 'string',
        description: 'IANA timezone name (e.g. "America/New_York"). Defaults to the server\'s local timezone.',
      },
    },
  },
  routing: {
    useWhen: ['User asks what time or date it is', 'User needs to know the current time in a specific timezone'],
    avoidWhen: ['User is asking about a historical date or event'],
  },
};

export const datetimeHandler: ToolHandler = async (input) => {
  const tz = (input.timezone as string) || undefined;
  const now = new Date();

  try {
    const formatted = now.toLocaleString('en-US', {
      timeZone: tz,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
    });
    return formatted;
  } catch {
    // Invalid timezone
    return now.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
    });
  }
};
