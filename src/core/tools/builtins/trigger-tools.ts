// ============================================================
// OpenClaw Deploy — Trigger Management Tools
// ============================================================
//
// Tools for managing event-driven triggers:
//   - trigger_add: Create a new scheduled trigger
//   - trigger_list: List all triggers
//   - trigger_remove: Remove a trigger
//   - trigger_toggle: Enable/disable a trigger
// ============================================================

import { randomUUID } from 'node:crypto';
import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';
import { EventTriggerManager } from '../../services/event-triggers.js';

// Singleton manager — set from server.ts
let triggerManager: EventTriggerManager | null = null;

export function setTriggerManager(manager: EventTriggerManager): void {
  triggerManager = manager;
}

function getManager(): EventTriggerManager {
  if (!triggerManager) throw new Error('Trigger system is not enabled');
  return triggerManager;
}

// ---------------------------------------------------------------------------
// trigger_add
// ---------------------------------------------------------------------------

export const triggerAddDefinition: ToolDefinition = {
  name: 'trigger_add',
  description:
    'Create a scheduled trigger that automatically runs an action on a cron schedule. ' +
    'Example: "0 9 * * 1-5" runs every weekday at 9am.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'A descriptive name for the trigger',
      },
      schedule: {
        type: 'string',
        description: 'Cron expression (5 fields: minute hour day month weekday)',
      },
      action: {
        type: 'string',
        description: 'The message/prompt to execute when triggered (e.g. "Give me a morning briefing")',
      },
      channel: {
        type: 'string',
        description: 'Channel to deliver trigger output to: "telegram" (default), "discord", or "webchat"',
        enum: ['telegram', 'discord', 'webchat'],
      },
      target_channel_id: {
        type: 'string',
        description: 'For Discord triggers: the Discord channel ID to post results to',
      },
      autonomous: {
        type: 'boolean',
        description: 'When true, fires through the autonomous task executor (multi-step with subtask decomposition) instead of the regular pipeline. Use for complex goals that need multiple tool calls.',
      },
    },
    required: ['name', 'schedule', 'action'],
  },
  routing: {
    useWhen: ['User wants to set up an automated scheduled task', 'User asks for something to happen on a schedule'],
    avoidWhen: ['User wants a one-time reminder (use schedule_reminder)'],
  },
};

export const triggerAddHandler: ToolHandler = async (input, context) => {
  const manager = getManager();
  const name = input.name as string;
  const schedule = input.schedule as string;
  const action = input.action as string;
  const channel = (input.channel as string) ?? 'telegram';
  const targetChannelId = input.target_channel_id as string | undefined;
  const autonomous = (input.autonomous as boolean) ?? false;

  if (!name) throw new Error('Missing trigger name');
  if (!schedule) throw new Error('Missing cron schedule');
  if (!action) throw new Error('Missing action');

  // Validate cron
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('Cron expression must have 5 fields');

  // Determine target ID based on channel
  let targetId: string | number = context.conversationId;
  if (channel === 'discord' && targetChannelId) {
    targetId = targetChannelId;
  }

  const trigger = await manager.addTrigger({
    id: randomUUID().slice(0, 8),
    name,
    enabled: true,
    schedule,
    action,
    channel: channel as 'telegram' | 'webchat' | 'discord',
    targetId,
    autonomous,
  });

  return `Trigger "${name}" created (ID: ${trigger.id}).\n` +
    `Schedule: ${schedule}\n` +
    `Channel: ${channel}\n` +
    `Mode: ${autonomous ? 'autonomous (multi-step)' : 'regular pipeline'}\n` +
    `Action: ${action}\n` +
    `Next fire: ${trigger.nextFireAt}`;
};

// ---------------------------------------------------------------------------
// trigger_list
// ---------------------------------------------------------------------------

export const triggerListDefinition: ToolDefinition = {
  name: 'trigger_list',
  description: 'List all configured triggers.',
  parameters: { type: 'object', properties: {} },
  routing: {
    useWhen: ['User asks to see their triggers or automations'],
    avoidWhen: ['User wants to list reminders (use list_reminders)'],
  },
};

export const triggerListHandler: ToolHandler = async () => {
  const manager = getManager();
  const triggers = await manager.loadTriggers();

  if (triggers.length === 0) return 'No triggers configured. Use trigger_add to create one.';

  const lines = triggers.map((t) => {
    const status = t.enabled ? 'active' : 'disabled';
    const nextFire = t.enabled ? new Date(t.nextFireAt).toLocaleString() : 'n/a';
    return `[${t.id}] "${t.name}" (${status})\n` +
      `  Schedule: ${t.schedule}\n` +
      `  Action: ${t.action}\n` +
      `  Next: ${nextFire} | Fired: ${t.fireCount}x`;
  });

  return `Triggers (${triggers.length}):\n\n${lines.join('\n\n')}`;
};

// ---------------------------------------------------------------------------
// trigger_remove
// ---------------------------------------------------------------------------

export const triggerRemoveDefinition: ToolDefinition = {
  name: 'trigger_remove',
  description: 'Remove a trigger by its ID.',
  parameters: {
    type: 'object',
    properties: {
      trigger_id: { type: 'string', description: 'The trigger ID to remove' },
    },
    required: ['trigger_id'],
  },
  routing: {
    useWhen: ['User wants to delete a trigger'],
    avoidWhen: [],
  },
};

export const triggerRemoveHandler: ToolHandler = async (input) => {
  const manager = getManager();
  const id = input.trigger_id as string;
  if (!id) throw new Error('Missing trigger_id');

  const removed = await manager.removeTrigger(id);
  if (!removed) throw new Error(`Trigger ${id} not found`);

  return `Trigger ${id} removed.`;
};

// ---------------------------------------------------------------------------
// trigger_toggle
// ---------------------------------------------------------------------------

export const triggerToggleDefinition: ToolDefinition = {
  name: 'trigger_toggle',
  description: 'Enable or disable a trigger.',
  parameters: {
    type: 'object',
    properties: {
      trigger_id: { type: 'string', description: 'The trigger ID' },
      enabled: { type: 'boolean', description: 'true to enable, false to disable' },
    },
    required: ['trigger_id', 'enabled'],
  },
  routing: {
    useWhen: ['User wants to pause or resume a trigger'],
    avoidWhen: [],
  },
};

export const triggerToggleHandler: ToolHandler = async (input) => {
  const manager = getManager();
  const id = input.trigger_id as string;
  const enabled = input.enabled as boolean;

  if (!id) throw new Error('Missing trigger_id');

  const toggled = await manager.toggleTrigger(id, enabled);
  if (!toggled) throw new Error(`Trigger ${id} not found`);

  return `Trigger ${id} ${enabled ? 'enabled' : 'disabled'}.`;
};
