// ============================================================
// OpenClaw Deploy — Timezone Converter Tool
// ============================================================

import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

export const timezoneConverterDefinition: ToolDefinition = {
  name: 'timezone_converter',
  description: 'Convert a time from one timezone to another. Uses IANA timezone names (e.g. "America/New_York", "Europe/London", "Asia/Tokyo").',
  parameters: {
    type: 'object',
    properties: {
      time: { type: 'string', description: 'The time to convert (ISO 8601 like "2024-06-15T14:30:00" or "HH:MM" like "14:30").' },
      from_timezone: { type: 'string', description: 'Source IANA timezone (e.g. "America/New_York").' },
      to_timezone: { type: 'string', description: 'Target IANA timezone (e.g. "Asia/Tokyo").' },
    },
    required: ['time', 'from_timezone', 'to_timezone'],
  },
  routing: {
    useWhen: ['User asks to convert a time between timezones', 'User wants to know what time it is in another timezone'],
    avoidWhen: ['User just wants the current time (use current_datetime instead)'],
  },
};

function formatInTimezone(date: Date, tz: string): string {
  return date.toLocaleString('en-US', {
    timeZone: tz,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  });
}

export const timezoneConverterHandler: ToolHandler = async (input) => {
  const timeStr = input.time as string;
  const fromTz = input.from_timezone as string;
  const toTz = input.to_timezone as string;

  if (!timeStr) throw new Error('Missing time');
  if (!fromTz) throw new Error('Missing from_timezone');
  if (!toTz) throw new Error('Missing to_timezone');

  // Validate timezones
  try {
    Intl.DateTimeFormat('en-US', { timeZone: fromTz });
  } catch {
    throw new Error(`Invalid source timezone: ${fromTz}`);
  }
  try {
    Intl.DateTimeFormat('en-US', { timeZone: toTz });
  } catch {
    throw new Error(`Invalid target timezone: ${toTz}`);
  }

  let date: Date;

  // Try HH:MM format first — assume today's date
  const hmMatch = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (hmMatch) {
    const now = new Date();
    // Create a date string in the source timezone context
    const isoStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${hmMatch[1].padStart(2, '0')}:${hmMatch[2]}:00`;
    // Parse as if in the source timezone — approximate using offset
    const tempDate = new Date(isoStr);
    const fromOffset = getTimezoneOffsetMs(tempDate, fromTz);
    const utcOffset = tempDate.getTimezoneOffset() * 60_000;
    date = new Date(tempDate.getTime() + utcOffset - fromOffset);
  } else {
    // Try ISO 8601 parse
    const parsed = new Date(timeStr);
    if (isNaN(parsed.getTime())) {
      throw new Error('Invalid time format. Use ISO 8601 (e.g. "2024-06-15T14:30:00") or "HH:MM".');
    }
    // If no timezone info in the string, treat as source timezone
    if (!timeStr.includes('Z') && !timeStr.includes('+') && !/\d{2}:\d{2}:\d{2}[+-]/.test(timeStr)) {
      const fromOffset = getTimezoneOffsetMs(parsed, fromTz);
      const utcOffset = parsed.getTimezoneOffset() * 60_000;
      date = new Date(parsed.getTime() + utcOffset - fromOffset);
    } else {
      date = parsed;
    }
  }

  const fromFormatted = formatInTimezone(date, fromTz);
  const toFormatted = formatInTimezone(date, toTz);

  return `${fromFormatted}\n→ ${toFormatted}`;
};

function getTimezoneOffsetMs(date: Date, tz: string): number {
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
  const tzStr = date.toLocaleString('en-US', { timeZone: tz });
  return new Date(tzStr).getTime() - new Date(utcStr).getTime();
}
