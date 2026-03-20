// ============================================================
// OpenClaw Deploy — Activity Search Tool
// ============================================================

import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';
import type { DocumentMemoryEngine } from '../../services/document-memory/document-memory.js';

let documentMemoryRef: DocumentMemoryEngine | null = null;

export function setDocumentMemory(engine: DocumentMemoryEngine): void {
  documentMemoryRef = engine;
}

export const activitySearchDefinition: ToolDefinition = {
  name: 'activity_search',
  description:
    'Search your activity log to see what you did in past conversations. ' +
    'Returns timestamped entries showing messages received, tools used, and responses given.',
  parameters: {
    type: 'object',
    properties: {
      date_range: {
        type: 'string',
        description:
          'Time range: "today", "yesterday", "week", "month", or a specific date "YYYY-MM-DD"',
      },
      tool_name: {
        type: 'string',
        description:
          'Filter by tool name (e.g., "web_search", "project_write_file")',
      },
      keyword: {
        type: 'string',
        description: 'Filter by keyword in messages or responses',
      },
      limit: {
        type: 'string',
        description: 'Maximum entries to return (default 20, max 50)',
      },
    },
    required: [],
  },
  routing: {
    useWhen: [
      'user asks "what did we do yesterday" or "what happened last session"',
      'user asks about past tool usage or conversation history',
      'you need to recall what actions you took in a prior conversation',
    ],
    avoidWhen: [
      'user is asking about the current conversation (use context instead)',
      'user is asking about stored facts (use memory_recall instead)',
    ],
  },
  category: 'memory',
};

export const activitySearchHandler: ToolHandler = async (input, context) => {
  if (!documentMemoryRef) {
    return 'Activity logging is not enabled.';
  }

  const dateRange = (input.date_range as string) || 'today';
  const toolName = (input.tool_name as string) || undefined;
  const keyword = (input.keyword as string) || undefined;
  const limit = Math.min(
    parseInt(String(input.limit ?? '20'), 10) || 20,
    50,
  );

  const results = await documentMemoryRef.searchActivity(context.userId, {
    dateRange,
    toolName,
    keyword,
    limit,
  });

  if (results.length === 0) {
    return (
      `No activity found for ${dateRange}` +
      (toolName ? ` with tool ${toolName}` : '') +
      (keyword ? ` matching "${keyword}"` : '') +
      '.'
    );
  }

  const lines = results.map((r) => {
    const time = r.timestamp.split('T')[1]?.slice(0, 5) ?? '';
    const tools =
      r.toolsUsed.length > 0 ? ` | tools: ${r.toolsUsed.join(', ')}` : '';
    const errors =
      r.toolErrors.length > 0
        ? ` | errors: ${r.toolErrors.join(', ')}`
        : '';
    return (
      `[${r.timestamp.split('T')[0]} ${time}] ${r.channel}` +
      ` | "${r.userMessage.slice(0, 80)}"` +
      ` → "${r.responseSnippet.slice(0, 80)}"` +
      `${tools}${errors}`
    );
  });

  return `${results.length} activity entries (${dateRange}):\n${lines.join('\n')}`;
};
