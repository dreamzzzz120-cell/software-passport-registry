import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http, { type Server } from 'node:http';
import net from 'node:net';
import { app, rejectConnectTunnels } from '../../server.ts';

// The Fetch spec forbids sending TRACE client-side (undici throws before a
// request is even made), so it must be sent with a raw http.request to
// actually exercise the server's own rejection of it.
function rawRequest(url: string, method: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const { hostname, port, pathname } = new URL(url);
    const req = http.request({ hostname, port, path: pathname, method }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode || 0 }));
    });
    req.on('error', reject);
    req.end();
  });
}

// CONNECT is even more special-cased than TRACE: Node's http client/server
// pair route it through a 'connect' socket event rather than a normal
// request/response, so it has to be sent over a raw TCP socket and its
// status line parsed by hand.
function rawConnect(url: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const { hostname, port } = new URL(url);
    const socket = net.connect(Number(port), hostname, () => {
      socket.write(`CONNECT ${hostname}:${port} HTTP/1.1\r\nHost: ${hostname}:${port}\r\n\r\n`);
    });
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const match = buffer.match(/^HTTP\/1\.[01] (\d{3})/);
      if (match) { socket.destroy(); resolve({ status: Number(match[1]) }); }
    });
    socket.on('error', reject);
    socket.on('close', () => reject(new Error('Connection closed before a status line was received')));
  });
}

const enabled = process.env.NODE_ENV === 'test';
const suite = enabled ? describe : describe.skip;
let server: Server | undefined;
let baseUrl = '';

beforeAll(async () => {
  process.env.SPR_SKIP_AUTOSTART = 'true';
  server = rejectConnectTunnels(app.listen(0, '127.0.0.1'));
  await new Promise<void>((resolve, reject) => {
    server!.once('listening', () => resolve());
    server!.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unable to determine test server address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

suite('HTTP hardening', () => {
  it('disables Express fingerprinting', async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.headers.get('x-powered-by')).toBeNull();
  });

  it('rejects TRACE', async () => {
    const response = await rawRequest(`${baseUrl}/health`, 'TRACE');
    expect(response.status).toBe(405);
  });

  it('rejects CONNECT', async () => {
    const response = await rawConnect(baseUrl);
    expect(response.status).toBe(405);
  });

  it('uses no-store caching for API responses', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('returns deterministic JSON for missing API routes', async () => {
    const response = await fetch(`${baseUrl}/api/security-test-not-found`);
    expect(response.status).toBe(404);
    const body = await response.json() as { error?: string; code?: string };
    expect(typeof body.error).toBe('string');
    expect(body.code).toBe('NOT_FOUND');
  });
});
