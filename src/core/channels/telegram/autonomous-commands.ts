// ============================================================
// OpenClaw Deploy — Telegram Autonomous Task Commands
// ============================================================

import type { AutonomousTaskExecutor } from '../../services/autonomous/task-executor.js';

export interface AutonomousCommandContext {
  chatId: number;
  userId: string;
  executor: AutonomousTaskExecutor;
  sendMessage: (chatId: number, text: string) => Promise<void>;
}

export async function handleAutonomousCommand(
  text: string,
  ctx: AutonomousCommandContext,
): Promise<void> {
  const [rawCmd, ...rest] = text.split(' ');
  const cmd = rawCmd.toLowerCase().replace(/@\w+$/, '');
  const arg = rest.join(' ').trim();

  switch (cmd) {
    case '/auto': {
      if (!arg) {
        await ctx.sendMessage(
          ctx.chatId,
          'Usage: /auto <goal>\n' +
            'Example: /auto Research the top 5 TypeScript ORMs and write a comparison',
        );
        return;
      }
      try {
        const task = await ctx.executor.executeGoal(arg, ctx.userId, ctx.chatId, 'telegram');
        await ctx.sendMessage(
          ctx.chatId,
          `Autonomous task started (ID: ${task.id.slice(0, 8)})\nGoal: ${arg}\nPlanning...`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await ctx.sendMessage(ctx.chatId, `Cannot start task: ${msg}`);
      }
      break;
    }

    case '/auto_status':
    case '/tasks': {
      const activeIds = ctx.executor.getActiveTaskIds();
      if (activeIds.length === 0) {
        const killActive = ctx.executor.isKillSwitchActive();
        await ctx.sendMessage(
          ctx.chatId,
          killActive
            ? 'No active tasks. (Kill switch is active — use /auto_resume to re-enable.)'
            : 'No active autonomous tasks.',
        );
        return;
      }
      const lines = activeIds.map((id) => {
        const task = ctx.executor.getActiveTask(id);
        if (!task) return `  ${id.slice(0, 8)}: unknown`;
        const completed = task.subtasks.filter((s) => s.status === 'completed').length;
        return `  ${id.slice(0, 8)}: ${task.status} (${completed}/${task.subtasks.length}) — ${task.goal.slice(0, 60)}`;
      });
      await ctx.sendMessage(ctx.chatId, `Active tasks:\n${lines.join('\n')}`);
      break;
    }

    case '/kill': {
      if (arg) {
        const killed = ctx.executor.killTask(arg);
        await ctx.sendMessage(
          ctx.chatId,
          killed ? `Task ${arg.slice(0, 8)} cancelled.` : `Task not found: ${arg}`,
        );
      } else {
        const killed = ctx.executor.killSwitch();
        await ctx.sendMessage(
          ctx.chatId,
          killed.length > 0
            ? `KILL SWITCH activated. ${killed.length} task(s) cancelled.`
            : 'Kill switch activated (no active tasks).',
        );
      }
      break;
    }

    case '/auto_resume': {
      ctx.executor.resetKillSwitch();
      await ctx.sendMessage(ctx.chatId, 'Autonomous operations re-enabled.');
      break;
    }

    default:
      await ctx.sendMessage(
        ctx.chatId,
        'Unknown autonomous command. Available:\n' +
          '/auto <goal>   — Start autonomous task\n' +
          '/auto_status   — Show active tasks\n' +
          '/tasks         — Show active tasks\n' +
          '/kill [taskId] — Emergency stop (all or one)\n' +
          '/auto_resume   — Re-enable after kill switch',
      );
  }
}
