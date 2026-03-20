// ============================================================
// OpenClaw Deploy — Send File Tool (cross-channel document delivery)
// ============================================================

import { readFile, stat } from 'node:fs/promises';
import { resolve, normalize, basename, extname } from 'node:path';
import type { ToolDefinition } from '../../../types/index.js';
import type { ToolHandler } from '../registry.js';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB (Telegram limit; Discord allows 25MB)

// Blocked patterns — same as project-file-ops read blocklist
const BLOCKED_DOTFILE_PATTERNS = [
  '.git', '.env', '.ssh', '.gnupg', '.npmrc',
  '.docker', '.kube', '.aws', '.config',
];

const BLOCKED_FILENAMES = [
  'id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa',
  'known_hosts', 'authorized_keys', 'credentials',
  'credentials.json', 'token.json', '.netrc',
  '.bash_history', '.zsh_history', '.python_history',
  '.node_repl_history',
];

const MIME_TYPES: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ts': 'text/plain',
  '.js': 'text/plain',
  '.py': 'text/plain',
  '.rs': 'text/plain',
  '.go': 'text/plain',
  '.java': 'text/plain',
  '.cpp': 'text/plain',
  '.c': 'text/plain',
  '.h': 'text/plain',
  '.css': 'text/css',
  '.scss': 'text/plain',
  '.yaml': 'text/plain',
  '.yml': 'text/plain',
  '.toml': 'text/plain',
  '.sql': 'text/plain',
  '.sh': 'text/plain',
  '.bat': 'text/plain',
  '.log': 'text/plain',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const sendFileDefinition: ToolDefinition = {
  name: 'send_file',
  description:
    'Send a file from an allowed project directory to the user as a document attachment. ' +
    'Works on all channels (Telegram, Discord, WebChat). The file will be delivered as a downloadable document in the chat.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute file path within an allowed project directory',
      },
      caption: {
        type: 'string',
        description: 'Optional caption/description to send with the file',
      },
    },
    required: ['path'],
  },
  routing: {
    useWhen: [
      'User asks to send, share, or deliver a file',
      'User wants to download a file from a project directory',
      'User asks to export or get a file',
    ],
    avoidWhen: [
      'User just wants to read/view file contents (use project_read_file instead)',
      'User wants to create a new file (use project_write_file instead)',
    ],
  },
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const sendFileHandler: ToolHandler = async (input, context) => {
  const filePath = input.path as string;
  const caption = (input.caption as string) ?? undefined;

  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Missing file path');
  }

  if (filePath.includes('..')) {
    throw new Error('Path traversal (..) is not allowed.');
  }

  const normalized = normalize(filePath);
  const absolute = resolve(normalized);
  const allowedDirs = context.allowedProjectDirs ?? [];

  if (allowedDirs.length === 0) {
    throw new Error('No project directories are configured.');
  }

  // Check allowed dirs
  const isAllowed = allowedDirs.some((dir) => {
    const resolvedDir = resolve(normalize(dir));
    return absolute === resolvedDir ||
      absolute.startsWith(resolvedDir + '/') ||
      absolute.startsWith(resolvedDir + '\\');
  });

  if (!isAllowed) {
    throw new Error(`Path "${filePath}" is not within any allowed project directory.`);
  }

  // Check blocked dotfiles
  const segments = normalized.split(/[\\/]/);
  for (const segment of segments) {
    if (!segment) continue;
    for (const pattern of BLOCKED_DOTFILE_PATTERNS) {
      if (segment === pattern || segment.startsWith(pattern + '/') || segment.startsWith(pattern + '\\')) {
        throw new Error(`Sending files from "${pattern}" is not allowed for security reasons.`);
      }
    }
  }

  // Check blocked filenames
  const filename = segments[segments.length - 1]?.toLowerCase();
  if (filename && BLOCKED_FILENAMES.includes(filename)) {
    throw new Error(`Sending file "${filename}" is not allowed for security reasons.`);
  }

  // Check file exists and size
  const fileStat = await stat(absolute).catch(() => null);
  if (!fileStat || !fileStat.isFile()) {
    throw new Error(`File not found: ${filePath}`);
  }
  if (fileStat.size > MAX_FILE_SIZE) {
    throw new Error(`File size (${(fileStat.size / 1024 / 1024).toFixed(1)}MB) exceeds the 20MB upload limit.`);
  }
  if (fileStat.size === 0) {
    throw new Error('File is empty.');
  }

  // Read file
  const data = await readFile(absolute);
  const ext = extname(absolute).toLowerCase();
  const mimeType = MIME_TYPES[ext] ?? 'application/octet-stream';
  const name = basename(absolute);

  // Push to collected files for the channel to deliver
  if (!context.collectedFiles) {
    throw new Error('File delivery is not supported in this channel.');
  }

  context.collectedFiles.push({
    filename: name,
    mimeType,
    data,
    caption,
  });

  return `File "${name}" (${(fileStat.size / 1024).toFixed(1)}KB) queued for delivery.`;
};
