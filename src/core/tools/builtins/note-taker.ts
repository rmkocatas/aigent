// ============================================================
// OpenClaw Deploy — Note Taker Tool (Persistent Notes)
// ============================================================

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

const MAX_NOTES = 200;
const MAX_CONTENT = 5_000;
const MAX_TAGS = 10;

interface Note {
  id: string;
  content: string;
  tags: string[];
  createdAt: string;
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

function getNotesPath(memoryDir: string, userId: string): string {
  return join(dirname(memoryDir), 'notes', `${sanitizeId(userId)}.json`);
}

async function loadNotes(memoryDir: string, userId: string): Promise<Note[]> {
  try {
    const content = await readFile(getNotesPath(memoryDir, userId), 'utf-8');
    return JSON.parse(content) as Note[];
  } catch {
    return [];
  }
}

async function saveNotes(memoryDir: string, userId: string, notes: Note[]): Promise<void> {
  const filePath = getNotesPath(memoryDir, userId);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(notes, null, 2), 'utf-8');
}

// ---- note_add ----

export const noteAddDefinition: ToolDefinition = {
  name: 'note_add',
  description: 'Add a new note to persistent storage. Notes are stored per user.',
  parameters: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'The note content (max 5000 chars).' },
      tags: { type: 'string', description: 'Comma-separated tags (e.g. "work,important").' },
    },
    required: ['content'],
  },
  routing: {
    useWhen: ['User asks to save, create, or add a note'],
    avoidWhen: ['User wants to search notes (use note_search instead)', 'User wants to use persistent memory (use memory_write instead)'],
  },
};

export const noteAddHandler: ToolHandler = async (input, context) => {
  const content = input.content as string;
  const tagsStr = (input.tags as string) ?? '';

  if (!content || typeof content !== 'string') throw new Error('Missing content');
  if (content.length > MAX_CONTENT) throw new Error(`Content too long (max ${MAX_CONTENT} chars)`);

  const tags = tagsStr
    ? tagsStr.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, MAX_TAGS)
    : [];

  const notes = await loadNotes(context.memoryDir, context.userId);
  if (notes.length >= MAX_NOTES) {
    throw new Error(`Note limit reached (max ${MAX_NOTES} notes)`);
  }

  const note: Note = {
    id: randomUUID().slice(0, 8),
    content,
    tags,
    createdAt: new Date().toISOString(),
  };

  notes.push(note);
  await saveNotes(context.memoryDir, context.userId, notes);
  return `Note saved (ID: ${note.id}).${tags.length ? ` Tags: ${tags.join(', ')}` : ''}`;
};

// ---- note_list ----

export const noteListDefinition: ToolDefinition = {
  name: 'note_list',
  description: 'List all saved notes, optionally filtered by tag.',
  parameters: {
    type: 'object',
    properties: {
      tag: { type: 'string', description: 'Filter by tag name.' },
    },
  },
  routing: {
    useWhen: ['User asks to see, list, or browse their notes'],
    avoidWhen: ['User wants to search for a specific note (use note_search instead)'],
  },
};

export const noteListHandler: ToolHandler = async (input, context) => {
  const tag = (input.tag as string)?.toLowerCase().trim();
  const notes = await loadNotes(context.memoryDir, context.userId);

  const filtered = tag ? notes.filter((n) => n.tags.includes(tag)) : notes;

  if (filtered.length === 0) {
    return tag ? `No notes with tag "${tag}".` : 'No notes saved.';
  }

  const lines = filtered.map((n) => {
    const tagStr = n.tags.length ? ` [${n.tags.join(', ')}]` : '';
    const preview = n.content.length > 80 ? n.content.slice(0, 77) + '...' : n.content;
    return `[${n.id}]${tagStr} ${preview}`;
  });

  return `${filtered.length} note(s):\n${lines.join('\n')}`;
};

// ---- note_search ----

export const noteSearchDefinition: ToolDefinition = {
  name: 'note_search',
  description: 'Search notes by keyword (substring match in content).',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query.' },
    },
    required: ['query'],
  },
  routing: {
    useWhen: ['User wants to find a specific note by keyword or tag'],
    avoidWhen: ['User wants to see all notes (use note_list instead)'],
  },
};

export const noteSearchHandler: ToolHandler = async (input, context) => {
  const query = (input.query as string)?.toLowerCase().trim();
  if (!query) throw new Error('Missing query');

  const notes = await loadNotes(context.memoryDir, context.userId);
  const matches = notes.filter((n) => n.content.toLowerCase().includes(query));

  if (matches.length === 0) return `No notes matching "${query}".`;

  const lines = matches.map((n) => {
    const preview = n.content.length > 80 ? n.content.slice(0, 77) + '...' : n.content;
    return `[${n.id}] ${preview}`;
  });

  return `${matches.length} result(s):\n${lines.join('\n')}`;
};

// ---- note_delete ----

export const noteDeleteDefinition: ToolDefinition = {
  name: 'note_delete',
  description: 'Delete a note by its ID.',
  parameters: {
    type: 'object',
    properties: {
      note_id: { type: 'string', description: 'The note ID to delete.' },
    },
    required: ['note_id'],
  },
  routing: {
    useWhen: ['User wants to delete or remove a specific note'],
    avoidWhen: ['User just wants to view notes, not delete them'],
  },
};

export const noteDeleteHandler: ToolHandler = async (input, context) => {
  const noteId = input.note_id as string;
  if (!noteId) throw new Error('Missing note_id');

  const notes = await loadNotes(context.memoryDir, context.userId);
  const index = notes.findIndex((n) => n.id === noteId);

  if (index === -1) throw new Error(`Note not found: ${noteId}`);

  notes.splice(index, 1);
  await saveNotes(context.memoryDir, context.userId, notes);
  return `Note ${noteId} deleted.`;
};
