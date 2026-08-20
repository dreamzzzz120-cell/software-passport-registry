import { createHash, timingSafeEqual } from 'node:crypto';
import { mcpInvalidArguments, mcpToolNotFound, mcpUnauthorized, MCP_SERVER_INFO, MCP_TOOLS, validateToolArguments, validateToolName } from './server.ts';

const MAX_BODY_BYTES = 128 * 1024;
const MAX_SESSION_ID = 128;
const MAX_ID_LENGTH = 128;
const MAX_ORIGIN_LENGTH = 512;
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 60;
const sessions = new Map<string, { createdAt: number; lastSeen: number }>();
const counters = new Map<string, { started: number; count: number }>();

const forbiddenHeaders = /^(cookie|set-cookie|authorization|proxy-authorization|x-api-key)$/i;

function jsonRpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id: typeof id === 'string' || typeof id === 'number' ? id : null, error: { code, message } };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function constantTimeToken(expected: string, actual: string): boolean {
  const a = Buffer.from(expected); const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authToken(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  if (!authorization || !/^Bearer [A-Za-z0-9._~-]{16,4096}$/.test(authorization)) return null;
  return authorization.slice(7);
}

function requestKey(request: Request, token: string): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  return createHash('sha256').update(`${token}:${forwarded}`).digest('hex');
}

function rateLimited(key: string): boolean {
  const now = Date.now();
  const current = counters.get(key);
  if (!current || now - current.started >= WINDOW_MS) {
    counters.set(key, { started: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > MAX_REQUESTS_PER_WINDOW;
}

function sessionId(request: Request): string | null {
  const value = request.headers.get('mcp-session-id');
  if (!value) return null;
  if (!/^[A-Za-z0-9._~-]{1,128}$/.test(value)) return null;
  return value;
}

function validateOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  if (origin.length > MAX_ORIGIN_LENGTH) return false;
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && url.hostname !== 'localhost' && !/^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  } catch { return false; }
}

async function readJson(request: Request): Promise<unknown | null> {
  const contentLength = request.headers.get('content-length');
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) return null;
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) return null;
  try { return JSON.parse(new TextDecoder().decode(body)); } catch { return null; }
}

function cleanup() {
  const cutoff = Date.now() - 10 * WINDOW_MS;
  for (const [key, value] of counters) if (value.started < cutoff) counters.delete(key);
  for (const [key, value] of sessions) if (value.lastSeen < cutoff) sessions.delete(key);
}

export function createMcpTransport(options: { expectedBearer: string; executeTool: (tool: string, args: Record<string, string>, request: Request) => Promise<unknown> }) {
  if (!/^[A-Za-z0-9._~-]{32,4096}$/.test(options.expectedBearer)) throw new Error('MCP bearer credential is missing or too weak');

  return async function handle(request: Request): Promise<Response> {
    cleanup();
    const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    if (request.method !== 'POST') return new Response(JSON.stringify(jsonRpcError(null, -32600, 'POST is required')), { status: 405, headers });
    if (!validateOrigin(request)) return new Response(JSON.stringify(jsonRpcError(null, -32600, 'Invalid origin')), { status: 403, headers });
    for (const key of request.headers.keys()) if (forbiddenHeaders.test(key) && key.toLowerCase() !== 'authorization') return new Response(JSON.stringify(jsonRpcError(null, -32600, 'Forbidden header')), { status: 400, headers });
    const token = authToken(request);
    if (!token || !constantTimeToken(options.expectedBearer, token)) return new Response(JSON.stringify(jsonRpcError(null, -32001, mcpUnauthorized().error.message)), { status: 401, headers });
    if (rateLimited(requestKey(request, token))) return new Response(JSON.stringify(jsonRpcError(null, -32029, 'Rate limit exceeded')), { status: 429, headers });
    const body = await readJson(request);
    if (!isPlainRecord(body) || body.jsonrpc !== '2.0' || !('id' in body) || typeof body.method !== 'string' || body.method.length > MAX_ID_LENGTH) return new Response(JSON.stringify(jsonRpcError(null, -32600, 'Invalid JSON-RPC request')), { status: 400, headers });
    const id = body.id;
    if (body.method === 'initialize') {
      const sid = sessionId(request) ?? crypto.randomUUID();
      sessions.set(sid, { createdAt: Date.now(), lastSeen: Date.now() });
      headers.set('mcp-session-id', sid);
      return new Response(JSON.stringify({ jsonrpc: '2.0', id, result: { protocolVersion: MCP_SERVER_INFO.protocolVersion, serverInfo: { name: MCP_SERVER_INFO.name, version: MCP_SERVER_INFO.version }, capabilities: { tools: {} } } }), { status: 200, headers });
    }
    if (body.method === 'notifications/initialized') return new Response(JSON.stringify({ jsonrpc: '2.0', id, result: {} }), { status: 200, headers });
    if (body.method === 'tools/list') return new Response(JSON.stringify({ jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } }), { status: 200, headers });
    if (body.method !== 'tools/call') return new Response(JSON.stringify(jsonRpcError(id, -32601, 'Method not found')), { status: 404, headers });
    const sid = sessionId(request);
    if (!sid || !sessions.has(sid)) return new Response(JSON.stringify(jsonRpcError(id, -32002, 'Valid MCP session required')), { status: 400, headers });
    sessions.get(sid)!.lastSeen = Date.now();
    if (!isPlainRecord(body.params) || typeof body.params.name !== 'string' || !validateToolName(body.params.name)) return new Response(JSON.stringify(jsonRpcError(id, -32602, mcpToolNotFound(String(body.params && (body.params as Record<string, unknown>).name)).error.message)), { status: 400, headers });
    const validation = validateToolArguments(body.params.name, body.params.arguments);
    if (!validation.ok) return new Response(JSON.stringify(jsonRpcError(id, -32602, mcpInvalidArguments().error.message)), { status: 400, headers });
    const result = await options.executeTool(body.params.name, validation.args, request);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false } }), { status: 200, headers });
  };
}
