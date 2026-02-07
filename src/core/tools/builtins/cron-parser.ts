// ============================================================
// OpenClaw Deploy — Cron Parser Tool
// ============================================================

import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

const SHORTCUTS: Record<string, string> = {
  '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *', '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *', '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function describeField(field: string, name: string, min: number, max: number, names?: string[]): string {
  if (field === '*') return `every ${name}`;

  // */N step
  const stepMatch = field.match(/^\*\/(\d+)$/);
  if (stepMatch) return `every ${stepMatch[1]} ${name}(s)`;

  // N-M range
  const rangeMatch = field.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const from = Number(rangeMatch[1]);
    const to = Number(rangeMatch[2]);
    if (from < min || to > max) return `${name} ${field} (out of range)`;
    const fromName = names ? names[from] : String(from);
    const toName = names ? names[to] : String(to);
    return `${name} ${fromName} through ${toName}`;
  }

  // N-M/S range with step
  const rangeStepMatch = field.match(/^(\d+)-(\d+)\/(\d+)$/);
  if (rangeStepMatch) {
    const from = Number(rangeStepMatch[1]);
    const to = Number(rangeStepMatch[2]);
    const step = rangeStepMatch[3];
    const fromName = names ? names[from] : String(from);
    const toName = names ? names[to] : String(to);
    return `every ${step} ${name}(s) from ${fromName} through ${toName}`;
  }

  // Comma-separated list
  if (field.includes(',')) {
    const parts = field.split(',').map((p) => {
      const n = Number(p.trim());
      return names && !isNaN(n) ? names[n] : p.trim();
    });
    return `${name} ${parts.join(', ')}`;
  }

  // Single value
  const n = Number(field);
  if (!isNaN(n)) {
    const display = names ? names[n] : String(n);
    return `at ${name} ${display}`;
  }

  return `${name} ${field}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export const cronParserDefinition: ToolDefinition = {
  name: 'cron_parser',
  description: 'Parse a cron expression into a human-readable description. Supports standard 5-field format and shortcuts like @daily, @hourly.',
  parameters: {
    type: 'object',
    properties: {
      expression: { type: 'string', description: 'The cron expression (e.g. "*/5 * * * *" or "@daily").' },
    },
    required: ['expression'],
  },
};

export const cronParserHandler: ToolHandler = async (input) => {
  let expr = (input.expression as string)?.trim();
  if (!expr) throw new Error('Missing expression');

  // Handle shortcuts
  if (expr.startsWith('@')) {
    const expanded = SHORTCUTS[expr.toLowerCase()];
    if (!expanded) throw new Error(`Unknown shortcut: ${expr}`);
    expr = expanded;
  }

  const fields = expr.split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Expected 5 fields (minute hour day month weekday), got ${fields.length}`);
  }

  const [minute, hour, dom, month, dow] = fields;
  const parts: string[] = [];

  // Build time description
  if (minute !== '*' && hour !== '*' && !minute.includes('/') && !hour.includes('/')) {
    const m = Number(minute);
    const h = Number(hour);
    if (!isNaN(m) && !isNaN(h)) {
      parts.push(`At ${pad(h)}:${pad(m)}`);
    } else {
      parts.push(describeField(minute, 'minute', 0, 59));
      parts.push(describeField(hour, 'hour', 0, 23));
    }
  } else {
    if (minute !== '*') parts.push(describeField(minute, 'minute', 0, 59));
    if (hour !== '*') parts.push(describeField(hour, 'hour', 0, 23));
    if (minute === '*' && hour === '*') parts.push('every minute');
  }

  if (dom !== '*') parts.push(describeField(dom, 'day-of-month', 1, 31));
  if (month !== '*') parts.push(describeField(month, 'month', 1, 12, MONTHS));
  if (dow !== '*') parts.push(describeField(dow, 'day-of-week', 0, 7, DAYS));

  return `"${input.expression}" → ${parts.join(', ')}`;
};
