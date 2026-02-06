import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:net';
import { isPortAvailable, findFreePort } from '../../../src/core/detect/ports.js';

// Helper: occupy a port and return the server so it can be closed later
function occupyPort(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

describe('isPortAvailable', () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await closeServer(server);
      server = null;
    }
  });

  it('returns true for an unused port', async () => {
    // Use a high ephemeral port unlikely to be in use
    const available = await isPortAvailable(49321);
    expect(available).toBe(true);
  });

  it('returns false for an occupied port', async () => {
    server = await occupyPort(49322);
    const available = await isPortAvailable(49322);
    expect(available).toBe(false);
  });
});

describe('findFreePort', () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await closeServer(server);
      server = null;
    }
  });

  it('returns a number >= startPort', async () => {
    const port = await findFreePort(49400);
    expect(port).toBeGreaterThanOrEqual(49400);
  });

  it('skips occupied ports', async () => {
    const startPort = 49410;
    server = await occupyPort(startPort);
    const port = await findFreePort(startPort);
    expect(port).toBeGreaterThan(startPort);
  });
});
