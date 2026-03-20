// ============================================================
// OpenClaw Deploy — Persona Manager
// ============================================================
//
// Manages switchable persona profiles. Each user/chat can have
// a different active persona. Persona definitions come from
// config (openclaw.json). Active persona per-user is persisted
// to disk.
// ============================================================

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { PersonaDefinition, PersonasConfig } from '../../types/index.js';

interface PersistedState {
  activePersonas: Record<string, string>;
  voiceModeEnabled: Record<string, boolean>;
}

export class PersonaManager {
  private definitions = new Map<string, PersonaDefinition>();
  private activePersonas = new Map<string, string>();
  private voiceMode = new Map<string, boolean>();
  private defaultPersonaId: string;
  private readonly persistPath: string;
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: PersonasConfig, baseDir: string) {
    this.defaultPersonaId = config.defaultPersonaId;
    this.persistPath = join(baseDir, 'personas', 'state.json');

    for (const def of config.definitions) {
      this.definitions.set(def.id, def);
    }

    if (!this.definitions.has(this.defaultPersonaId)) {
      console.warn(
        `[persona] Default persona "${this.defaultPersonaId}" not found. ` +
        `Using first defined persona.`,
      );
      const first = config.definitions[0];
      if (first) {
        this.defaultPersonaId = first.id;
      }
    }
  }

  /** Load persisted state from disk */
  async load(): Promise<void> {
    try {
      const raw = await readFile(this.persistPath, 'utf-8');
      const state = JSON.parse(raw) as PersistedState;
      if (state.activePersonas) {
        for (const [chatId, personaId] of Object.entries(state.activePersonas)) {
          if (this.definitions.has(personaId)) {
            this.activePersonas.set(chatId, personaId);
          }
        }
      }
      if (state.voiceModeEnabled) {
        for (const [chatId, enabled] of Object.entries(state.voiceModeEnabled)) {
          this.voiceMode.set(chatId, enabled);
        }
      }
      console.log(`[persona] Loaded ${this.activePersonas.size} active persona(s), ${this.voiceMode.size} voice mode setting(s)`);
    } catch {
      // No persisted state — fresh start
    }
  }

  /** Get the active persona for a chat/user. Returns default if none set. */
  getActivePersona(chatId: string): PersonaDefinition {
    const personaId = this.activePersonas.get(chatId) ?? this.defaultPersonaId;
    return this.definitions.get(personaId) ?? this.definitions.get(this.defaultPersonaId)!;
  }

  /** Get the active persona ID for display. */
  getActivePersonaId(chatId: string): string {
    return this.activePersonas.get(chatId) ?? this.defaultPersonaId;
  }

  /** Switch the active persona. Returns the new persona, or null if not found. */
  switchPersona(chatId: string, personaId: string): PersonaDefinition | null {
    const persona = this.definitions.get(personaId);
    if (!persona) return null;

    this.activePersonas.set(chatId, personaId);
    this.scheduleSave();
    return persona;
  }

  /** Reset to default persona. */
  resetPersona(chatId: string): PersonaDefinition {
    this.activePersonas.delete(chatId);
    this.scheduleSave();
    return this.definitions.get(this.defaultPersonaId)!;
  }

  /** List all available personas. */
  listPersonas(): PersonaDefinition[] {
    return [...this.definitions.values()];
  }

  /** Check if voice mode (auto-voice-reply) is enabled for a chat. */
  isVoiceModeEnabled(chatId: string): boolean {
    return this.voiceMode.get(chatId) ?? false;
  }

  /** Set voice mode for a chat. */
  setVoiceMode(chatId: string, enabled: boolean): void {
    if (enabled) {
      this.voiceMode.set(chatId, true);
    } else {
      this.voiceMode.delete(chatId);
    }
    this.scheduleSave();
  }

  /** Toggle voice mode. Returns new state. */
  toggleVoiceMode(chatId: string): boolean {
    const current = this.isVoiceModeEnabled(chatId);
    this.setVoiceMode(chatId, !current);
    return !current;
  }

  /** Flush pending state to disk. */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.dirty) {
      await this.saveToDisk();
    }
  }

  // ---- Private ----

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveToDisk().catch((err) => {
        console.error('[persona] Save failed:', (err as Error).message);
      });
    }, 2000);
  }

  private async saveToDisk(): Promise<void> {
    const state: PersistedState = {
      activePersonas: Object.fromEntries(this.activePersonas),
      voiceModeEnabled: Object.fromEntries(this.voiceMode),
    };
    await mkdir(dirname(this.persistPath), { recursive: true });
    await writeFile(this.persistPath, JSON.stringify(state, null, 2), 'utf-8');
    this.dirty = false;
  }
}
