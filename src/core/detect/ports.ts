// ============================================================
// OpenClaw Deploy — Port Detection
// ============================================================

import { createServer } from 'node:net';

const MAX_ATTEMPTS = 100;

export function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();

    server.once('error', () => {
      resolve(false);
    });

    server.once('listening', () => {
      server.close(() => {
        resolve(true);
      });
    });

    server.listen(port, '127.0.0.1');
  });
}

export async function findFreePort(startPort = 18789): Promise<number> {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const port = startPort + i;
    const available = await isPortAvailable(port);
    if (available) {
      return port;
    }
  }

  throw new Error(
    `No free port found in range ${startPort}–${startPort + MAX_ATTEMPTS - 1}`,
  );
}
