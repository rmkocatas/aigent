// ============================================================
// OpenClaw Deploy — Telegram Persona & Voice Commands
// ============================================================

import type { PersonaManager } from '../../services/persona-manager.js';

export interface PersonaCommandContext {
  chatId: number;
  personaManager: PersonaManager;
  sendMessage: (chatId: number, text: string) => Promise<void>;
}

export async function handlePersonaCommand(
  text: string,
  ctx: PersonaCommandContext,
): Promise<void> {
  const [rawCmd, ...rest] = text.split(' ');
  const cmd = rawCmd.toLowerCase().replace(/@\w+$/, '');
  const arg = rest.join(' ').trim();

  switch (cmd) {
    case '/persona': {
      if (!arg) {
        const chatKey = `telegram:${ctx.chatId}`;
        const current = ctx.personaManager.getActivePersona(chatKey);
        const currentId = ctx.personaManager.getActivePersonaId(chatKey);
        await ctx.sendMessage(
          ctx.chatId,
          `Current persona: ${current.name} (${currentId})\n\n` +
            'Use /persona <id> to switch.\n' +
            'Use /personas to see all available.',
        );
        return;
      }

      if (arg.toLowerCase() === 'reset' || arg.toLowerCase() === 'default') {
        const chatKey = `telegram:${ctx.chatId}`;
        const persona = ctx.personaManager.resetPersona(chatKey);
        await ctx.sendMessage(ctx.chatId, `Persona reset to: ${persona.name}`);
        return;
      }

      const chatKey = `telegram:${ctx.chatId}`;
      const persona = ctx.personaManager.switchPersona(chatKey, arg.toLowerCase());
      if (persona) {
        const voiceInfo = persona.preferredVoice ? ` (voice: ${persona.preferredVoice})` : '';
        await ctx.sendMessage(
          ctx.chatId,
          `Switched to: ${persona.name}${voiceInfo}\n${persona.description}`,
        );
      } else {
        const available = ctx.personaManager
          .listPersonas()
          .map((p) => `  ${p.id} — ${p.name}`)
          .join('\n');
        await ctx.sendMessage(
          ctx.chatId,
          `Persona "${arg}" not found.\n\nAvailable:\n${available}`,
        );
      }
      break;
    }

    case '/personas': {
      const chatKey = `telegram:${ctx.chatId}`;
      const activeId = ctx.personaManager.getActivePersonaId(chatKey);
      const personas = ctx.personaManager.listPersonas();
      const lines = personas.map((p) => {
        const marker = p.id === activeId ? ' ✓' : '';
        const voice = p.preferredVoice ? ` [${p.preferredVoice}]` : '';
        return `  ${p.id}${marker} — ${p.name}${voice}\n    ${p.description}`;
      });
      await ctx.sendMessage(
        ctx.chatId,
        `Available personas:\n\n${lines.join('\n\n')}\n\nSwitch: /persona <id>`,
      );
      break;
    }

    case '/voice': {
      const chatKey = `telegram:${ctx.chatId}`;

      if (arg.toLowerCase() === 'on') {
        ctx.personaManager.setVoiceMode(chatKey, true);
        await ctx.sendMessage(ctx.chatId, 'Voice mode enabled. I\'ll reply with voice when you send voice messages.');
        return;
      }
      if (arg.toLowerCase() === 'off') {
        ctx.personaManager.setVoiceMode(chatKey, false);
        await ctx.sendMessage(ctx.chatId, 'Voice mode disabled. Voice messages will get text replies.');
        return;
      }

      const nowEnabled = ctx.personaManager.toggleVoiceMode(chatKey);
      if (nowEnabled) {
        const persona = ctx.personaManager.getActivePersona(chatKey);
        const voiceInfo = persona.preferredVoice ? ` using "${persona.preferredVoice}" voice` : '';
        await ctx.sendMessage(
          ctx.chatId,
          `Voice mode enabled${voiceInfo}. Send me a voice message!`,
        );
      } else {
        await ctx.sendMessage(ctx.chatId, 'Voice mode disabled.');
      }
      break;
    }

    default:
      await ctx.sendMessage(
        ctx.chatId,
        'Persona commands:\n' +
          '/persona <id>  — Switch persona\n' +
          '/persona       — Show current\n' +
          '/persona reset — Reset to default\n' +
          '/personas      — List all\n' +
          '/voice         — Toggle voice reply mode',
      );
  }
}
