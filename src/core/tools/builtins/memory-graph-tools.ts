// ============================================================
// OpenClaw Deploy — Memory Graph & Timeline Tools
// ============================================================

import type { ToolContext } from '../registry.js';
import { getKnowledgeGraph, getFactHistory } from '../../services/memory-db/index.js';
import type { RelationType } from '../../services/memory-db/types.js';

// ── memory_graph ──────────────────────────────────────────

export const memoryGraphDefinition = {
  name: 'memory_graph',
  description: 'Query the knowledge graph to find relationships between stored facts about the user. Shows how memories are connected (e.g., "user works_at X", "user prefers Y"). Use this to understand connections between things you know about the user.',
  input_schema: {
    type: 'object' as const,
    properties: {
      fact_id: {
        type: 'string',
        description: 'Optional: Start from a specific fact ID to find its connections. Omit to see all relationships.',
      },
      relation_type: {
        type: 'string',
        enum: ['works_at', 'located_in', 'prefers', 'uses', 'created', 'related_to', 'part_of', 'knows'],
        description: 'Optional: Filter by relationship type.',
      },
      depth: {
        type: 'number',
        enum: [1, 2],
        description: 'How many hops to traverse (1 = direct connections, 2 = connections of connections). Default: 1.',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of relationships to return. Default: 20.',
      },
    },
    required: [],
  },
};

export async function memoryGraphHandler(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<string> {
  const graph = getKnowledgeGraph();
  if (!graph) {
    return 'Knowledge graph is not available. SQLite memory database may not be enabled.';
  }

  const userId = context.userId;
  const edges = graph.query({
    userId,
    factId: args.fact_id as string | undefined,
    relationType: args.relation_type as RelationType | undefined,
    depth: (args.depth as 1 | 2) || 1,
    limit: (args.limit as number) || 20,
  });

  if (edges.length === 0) {
    return args.fact_id
      ? `No relationships found for fact ${args.fact_id}.`
      : 'No relationships found in the knowledge graph for this user.';
  }

  const totalCount = graph.getRelationshipCount(userId);

  const lines = [`Knowledge Graph (${edges.length} of ${totalCount} total relationships):\n`];
  for (const edge of edges) {
    lines.push(
      `  [${edge.sourceFact.id}] "${edge.sourceFact.fact}" ` +
      `--${edge.relationType}--> ` +
      `[${edge.targetFact.id}] "${edge.targetFact.fact}" ` +
      `(confidence: ${edge.confidence.toFixed(2)})`,
    );
  }

  return lines.join('\n');
}

// ── memory_timeline ───────────────────────────────────────

export const memoryTimelineDefinition = {
  name: 'memory_timeline',
  description: 'View the history of changes to stored facts about the user. Shows when facts were created, updated, merged, pruned, or forgotten. Use this to understand how memories have evolved over time.',
  input_schema: {
    type: 'object' as const,
    properties: {
      fact_id: {
        type: 'string',
        description: 'Optional: View history for a specific fact ID.',
      },
      change_type: {
        type: 'string',
        enum: ['create', 'update', 'merge', 'prune', 'decay', 'forget'],
        description: 'Optional: Filter by type of change.',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of changes to return. Default: 20.',
      },
    },
    required: [],
  },
};

export async function memoryTimelineHandler(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<string> {
  const history = getFactHistory();
  if (!history) {
    return 'Fact history is not available. SQLite memory database may not be enabled.';
  }

  const userId = context.userId;
  const factId = args.fact_id as string | undefined;
  const changeType = args.change_type as string | undefined;
  const limit = (args.limit as number) || 20;

  let changes;
  if (factId) {
    changes = history.getFactHistory(factId);
  } else if (changeType) {
    changes = history.getChangesByType(userId, changeType as any, limit);
  } else {
    changes = history.getUserTimeline(userId, limit);
  }

  if (changes.length === 0) {
    return factId
      ? `No history found for fact ${factId}.`
      : 'No fact changes found for this user.';
  }

  // Get aggregate counts
  const counts = history.getChangeCount(userId);
  const countSummary = Object.entries(counts)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');

  const lines = [`Fact Timeline (${changes.length} changes shown | Total: ${countSummary}):\n`];
  for (const ch of changes) {
    const parts = [`  [${ch.changedAt}] ${ch.changeType.toUpperCase()} — fact ${ch.factId}`];
    if (ch.oldFact && ch.newFact) {
      parts.push(`    "${ch.oldFact}" → "${ch.newFact}"`);
    } else if (ch.newFact) {
      parts.push(`    "${ch.newFact}"`);
    } else if (ch.oldFact) {
      parts.push(`    "${ch.oldFact}" (removed)`);
    }
    if (ch.oldStrength != null && ch.newStrength != null) {
      parts.push(`    strength: ${ch.oldStrength.toFixed(2)} → ${ch.newStrength.toFixed(2)}`);
    }
    if (ch.mergedFromIds?.length) {
      parts.push(`    merged from: ${ch.mergedFromIds.join(', ')}`);
    }
    if (ch.context) {
      parts.push(`    context: ${ch.context}`);
    }
    lines.push(parts.join('\n'));
  }

  return lines.join('\n');
}
