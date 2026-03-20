// ============================================================
// OpenClaw Deploy — Dictionary Tool (Free Dictionary API)
// ============================================================

import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

let lastRequestTime = 0;
const MIN_INTERVAL_MS = 2000;

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

interface DictEntry {
  word: string;
  phonetic?: string;
  phonetics?: Array<{ text?: string }>;
  meanings: Array<{
    partOfSpeech: string;
    definitions: Array<{
      definition: string;
      example?: string;
    }>;
  }>;
}

export const dictionaryDefinition: ToolDefinition = {
  name: 'dictionary',
  description: 'Look up a word definition, pronunciation, and examples using the Free Dictionary API.',
  parameters: {
    type: 'object',
    properties: {
      word: { type: 'string', description: 'The word to look up.' },
    },
    required: ['word'],
  },
  routing: {
    useWhen: ['User asks for the definition or meaning of a word', 'User wants synonyms, pronunciation, or etymology'],
    avoidWhen: ['User is asking a general knowledge question, not about a specific word'],
  },
};

export const dictionaryHandler: ToolHandler = async (input) => {
  const word = (input.word as string)?.trim().toLowerCase();
  if (!word) throw new Error('Missing word');
  if (word.length > 100) throw new Error('Word too long (max 100 chars)');
  if (!/^[a-z\-' ]+$/.test(word)) throw new Error('Invalid word — use only letters, hyphens, and apostrophes');

  await rateLimit();

  const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });

  if (response.status === 404) {
    return `Word not found: "${word}"`;
  }
  if (!response.ok) {
    throw new Error(`Dictionary API error: ${response.status}`);
  }

  const entries = await response.json() as DictEntry[];
  if (!entries.length) return `No definitions found for "${word}"`;

  const entry = entries[0];
  const lines: string[] = [];

  lines.push(`Word: ${entry.word}`);

  const phonetic = entry.phonetic || entry.phonetics?.find((p) => p.text)?.text;
  if (phonetic) lines.push(`Pronunciation: ${phonetic}`);

  lines.push('');

  for (const meaning of entry.meanings.slice(0, 4)) {
    lines.push(`[${meaning.partOfSpeech}]`);
    for (const def of meaning.definitions.slice(0, 3)) {
      lines.push(`  - ${def.definition}`);
      if (def.example) lines.push(`    Example: "${def.example}"`);
    }
  }

  return lines.join('\n');
};
