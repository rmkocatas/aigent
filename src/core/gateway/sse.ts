import type { ServerResponse } from 'node:http';
import type { SSEEvent } from '../../types/index.js';

export function initSSE(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
}

export function writeSSE(res: ServerResponse, event: SSEEvent): void {
  let frame = '';
  if (event.id) frame += `id: ${event.id}\n`;
  if (event.event) frame += `event: ${event.event}\n`;
  for (const line of event.data.split('\n')) {
    frame += `data: ${line}\n`;
  }
  frame += '\n';
  res.write(frame);
}

export function endSSE(res: ServerResponse): void {
  writeSSE(res, { event: 'done', data: '[DONE]' });
  res.end();
}

export function errorSSE(res: ServerResponse, error: string): void {
  writeSSE(res, { event: 'error', data: JSON.stringify({ error }) });
  res.end();
}
