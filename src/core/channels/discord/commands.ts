// ============================================================
// OpenClaw Deploy — Discord Bot Commands
// ============================================================

import {
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { GatewayRuntimeConfig } from '../../../types/index.js';
import type { SessionStore } from '../../gateway/session-store.js';
import type { ApprovalManager } from '../../services/approval-manager.js';
import type { AutonomousTaskExecutor } from '../../services/autonomous/task-executor.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscordCommandContext {
  conversationId: string;
  channelId: string;
  userId: string;
  config: GatewayRuntimeConfig;
  sessions: SessionStore;
  sendReply: (text: string) => Promise<void>;
  approvalManager?: ApprovalManager;
  autonomousExecutor?: AutonomousTaskExecutor;
}

// ---------------------------------------------------------------------------
// Slash command definitions
// ---------------------------------------------------------------------------

export function getSlashCommands(): SlashCommandBuilder[] {
  return [
    new SlashCommandBuilder()
      .setName('help')
      .setDescription('Show available commands'),
    new SlashCommandBuilder()
      .setName('reset')
      .setDescription('Clear conversation history in this channel/thread'),
    new SlashCommandBuilder()
      .setName('info')
      .setDescription('Show system information'),
    new SlashCommandBuilder()
      .setName('approve')
      .setDescription('Approve a pending action'),
    new SlashCommandBuilder()
      .setName('deny')
      .setDescription('Deny a pending action'),
    new SlashCommandBuilder()
      .setName('pending')
      .setDescription('Show pending approvals'),
    new SlashCommandBuilder()
      .setName('briefing')
      .setDescription('Get a daily briefing'),
  ];
}

/**
 * Register slash commands globally with the Discord API.
 * Global commands propagate in ~1 hour for first registration.
 */
export async function registerSlashCommands(
  token: string,
  appId: string,
): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(token);
  const commands = getSlashCommands().map((cmd) => cmd.toJSON());
  try {
    await rest.put(Routes.applicationCommands(appId), { body: commands });
    console.log(`[discord] Registered ${commands.length} slash commands`);
  } catch (err) {
    console.error('[discord] Failed to register slash commands:', (err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Slash command handler
// ---------------------------------------------------------------------------

export async function handleSlashCommand(
  interaction: ChatInputCommandInteraction,
  ctx: DiscordCommandContext,
): Promise<void> {
  switch (interaction.commandName) {
    case 'help':
      await interaction.reply(getHelpMessage());
      break;
    case 'reset':
      ctx.sessions.reset(ctx.conversationId);
      await interaction.reply('Conversation reset. Starting fresh.');
      break;
    case 'info':
      await interaction.reply(getInfoMessage(ctx));
      break;
    case 'approve': {
      if (!ctx.approvalManager) {
        await interaction.reply({ content: 'Approval system is not available.', ephemeral: true });
        break;
      }
      const handled = ctx.approvalManager.handleResponse(ctx.userId, true);
      await interaction.reply(handled ? 'Approved.' : 'No pending approval to respond to.');
      break;
    }
    case 'deny': {
      if (!ctx.approvalManager) {
        await interaction.reply({ content: 'Approval system is not available.', ephemeral: true });
        break;
      }
      const handled = ctx.approvalManager.handleResponse(ctx.userId, false);
      await interaction.reply(handled ? 'Denied.' : 'No pending approval to respond to.');
      break;
    }
    case 'pending': {
      if (!ctx.approvalManager) {
        await interaction.reply({ content: 'Approval system is not available.', ephemeral: true });
        break;
      }
      const pending = ctx.approvalManager.getPending(ctx.userId);
      if (pending) {
        await interaction.reply(`**Pending approval:**\nAction: ${pending.action}\n${pending.details}`);
      } else {
        await interaction.reply('No pending approvals.');
      }
      break;
    }
    case 'briefing':
      // Briefing is handled as a message through the pipeline
      await interaction.reply('Generating briefing...');
      break;
    default:
      await interaction.reply({ content: `Unknown command: /${interaction.commandName}`, ephemeral: true });
  }
}

// ---------------------------------------------------------------------------
// Text command handler (! prefix)
// ---------------------------------------------------------------------------

export async function handleTextCommand(
  text: string,
  ctx: DiscordCommandContext,
): Promise<boolean> {
  if (!text.startsWith('!')) return false;

  const [rawCmd, ...rest] = text.split(' ');
  const cmd = rawCmd.toLowerCase();
  const arg = rest.join(' ').trim();

  switch (cmd) {
    case '!help':
      await ctx.sendReply(getHelpMessage());
      return true;
    case '!reset':
      ctx.sessions.reset(ctx.conversationId);
      await ctx.sendReply('Conversation reset. Starting fresh.');
      return true;
    case '!info':
      await ctx.sendReply(getInfoMessage(ctx));
      return true;
    case '!approve': {
      if (!ctx.approvalManager) {
        await ctx.sendReply('Approval system is not available.');
        return true;
      }
      const handled = ctx.approvalManager.handleResponse(ctx.userId, true);
      await ctx.sendReply(handled ? 'Approved.' : 'No pending approval to respond to.');
      return true;
    }
    case '!deny': {
      if (!ctx.approvalManager) {
        await ctx.sendReply('Approval system is not available.');
        return true;
      }
      const handled = ctx.approvalManager.handleResponse(ctx.userId, false);
      await ctx.sendReply(handled ? 'Denied.' : 'No pending approval to respond to.');
      return true;
    }
    case '!pending': {
      if (!ctx.approvalManager) {
        await ctx.sendReply('Approval system is not available.');
        return true;
      }
      const pending = ctx.approvalManager.getPending(ctx.userId);
      if (pending) {
        await ctx.sendReply(`**Pending approval:**\nAction: ${pending.action}\n${pending.details}`);
      } else {
        await ctx.sendReply('No pending approvals.');
      }
      return true;
    }

    // Autonomous task commands
    case '!auto': {
      if (!ctx.autonomousExecutor) {
        await ctx.sendReply('Autonomous system is not available.');
        return true;
      }
      if (!arg) {
        await ctx.sendReply('Usage: `!auto <goal>`\nExample: `!auto Research the top 5 TypeScript ORMs and write a comparison`');
        return true;
      }
      try {
        const task = await ctx.autonomousExecutor.executeGoal(arg, ctx.userId, ctx.channelId, 'discord');
        await ctx.sendReply(`Autonomous task started (ID: ${task.id.slice(0, 8)})\nGoal: ${arg}\nPlanning...`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await ctx.sendReply(`Cannot start task: ${msg}`);
      }
      return true;
    }
    case '!auto_status':
    case '!tasks': {
      if (!ctx.autonomousExecutor) {
        await ctx.sendReply('Autonomous system is not available.');
        return true;
      }
      const activeIds = ctx.autonomousExecutor.getActiveTaskIds();
      if (activeIds.length === 0) {
        const killActive = ctx.autonomousExecutor.isKillSwitchActive();
        await ctx.sendReply(
          killActive
            ? 'No active tasks. (Kill switch is active — use `!auto_resume` to re-enable.)'
            : 'No active autonomous tasks.',
        );
        return true;
      }
      const lines = activeIds.map((id) => {
        const task = ctx.autonomousExecutor!.getActiveTask(id);
        if (!task) return `  ${id.slice(0, 8)}: unknown`;
        const completed = task.subtasks.filter((s) => s.status === 'completed').length;
        return `  ${id.slice(0, 8)}: ${task.status} (${completed}/${task.subtasks.length}) — ${task.goal.slice(0, 60)}`;
      });
      await ctx.sendReply(`Active tasks:\n${lines.join('\n')}`);
      return true;
    }
    case '!kill': {
      if (!ctx.autonomousExecutor) {
        await ctx.sendReply('Autonomous system is not available.');
        return true;
      }
      if (arg) {
        const killed = ctx.autonomousExecutor.killTask(arg);
        await ctx.sendReply(killed ? `Task ${arg.slice(0, 8)} cancelled.` : `Task not found: ${arg}`);
      } else {
        const killed = ctx.autonomousExecutor.killSwitch();
        await ctx.sendReply(
          killed.length > 0
            ? `KILL SWITCH activated. ${killed.length} task(s) cancelled.`
            : 'Kill switch activated (no active tasks).',
        );
      }
      return true;
    }
    case '!auto_resume': {
      if (!ctx.autonomousExecutor) {
        await ctx.sendReply('Autonomous system is not available.');
        return true;
      }
      ctx.autonomousExecutor.resetKillSwitch();
      await ctx.sendReply('Autonomous operations re-enabled.');
      return true;
    }

    default:
      return false; // Not a known command — pass through to pipeline
  }
}

// ---------------------------------------------------------------------------
// Help messages
// ---------------------------------------------------------------------------

function getHelpMessage(): string {
  return [
    '**Available Commands**',
    '',
    '**Slash Commands:**',
    '`/help` — Show this help message',
    '`/reset` — Clear conversation history',
    '`/info` — Show system information',
    '`/approve` — Approve a pending action',
    '`/deny` — Deny a pending action',
    '`/pending` — Show pending approvals',
    '`/briefing` — Get a daily briefing',
    '',
    '**Text Commands (! prefix):**',
    '`!help` `!reset` `!info` `!approve` `!deny` `!pending`',
    '',
    '**Autonomous:**',
    '`!auto <goal>` — Start an autonomous task',
    '`!tasks` — Show active tasks',
    '`!kill [taskId]` — Emergency stop (all or one)',
    '`!auto_resume` — Re-enable after kill switch',
    '',
    '**Interaction:**',
    'In text channels: @mention me or reply to my messages',
    'In forum channels: create a post to start a conversation',
    'In DMs: just send a message',
  ].join('\n');
}

function getInfoMessage(ctx: DiscordCommandContext): string {
  const config = ctx.config;
  const lines = [
    '**System Information**',
    `Model routing: ${config.routing?.rules?.length ?? 0} rules`,
    `Tools: ${config.tools.allow?.length ?? 'all'} allowed`,
    `Memory: ${config.memory ? 'enabled' : 'disabled'}`,
    `Skills: ${config.skills ? 'enabled' : 'disabled'}`,
    `Personas: ${config.personas ? 'enabled' : 'disabled'}`,
  ];
  return lines.join('\n');
}
