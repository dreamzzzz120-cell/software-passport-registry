import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * SPR Trust MCP protocol adapter.
 * Read-only by design: agents can verify and retrieve evidence, never mutate
 * Passports, findings, credentials, billing, or tenant configuration.
 */
export const MCP_SERVER_INFO = {
  name: 'spr-trust',
  version: '1.0.0',
  protocolVersion: '2025-06-18',
} as const;

const MAX_TOOL_NAME = 64;
const MAX_PASSPORT = 512;
const MAX_CLAIM = 2000;
const MAX_RESULT_BYTES = 1_000_000;

export const MCP_TOOLS = [
  { name: 'verify_software', description: 'Verify a Software Passport and return its current evidence-backed trust status.', inputSchema: { type: 'object', properties: { passport: { type: 'string', minLength: 1, maxLength: MAX_PASSPORT } }, required: ['passport'], additionalProperties: false } },
  { name: 'get_passport', description: 'Retrieve the machine-readable public Software Passport.', inputSchema: { type: 'object', properties: { passport: { type: 'string', minLength: 1, maxLength: MAX_PASSPORT } }, required: ['passport'], additionalProperties: false } },
  { name: 'get_trust_evidence', description: 'Retrieve evidence supporting a Software Passport trust determination.', inputSchema: { type: 'object', properties: { passport: { type: 'string', minLength: 1, maxLength: MAX_PASSPORT } }, required: ['passport'], additionalProperties: false } },
  { name: 'get_security_status', description: 'Return security evidence and current security status for a Software Passport.', inputSchema: { type: 'object', properties: { passport: { type: 'string', minLength: 1, maxLength: MAX_PASSPORT } }, required: ['passport'], additionalProperties: false } },
  { name: 'get_compliance_status', description: 'Return only compliance claims supported by observed evidence.', inputSchema: { type: 'object', properties: { passport: { type: 'string', minLength: 1, maxLength: MAX_PASSPORT } }, required: ['passport'], additionalProperties: false } },
  { name: 'check_freshness', description: 'Return evidence freshness and whether the available evidence is stale.', inputSchema: { type: 'object', properties: { passport: { type: 'string', minLength: 1, maxLength: MAX_PASSPORT } }, required: ['passport'], additionalProperties: false } },
  { name: 'verify_claim', description: 'Check a software trust claim against observed SPR evidence. Returns VERIFIED, CONTRADICTED, or UNVERIFIED.', inputSchema: { type: 'object', properties: { passport: { type: 'string', minLength: 1, maxLength: MAX_PASSPORT }, claim: { type: 'string', minLength: 1, maxLength: MAX_CLAIM } }, required: ['passport', 'claim'], additionalProperties: false } },
] as const;

const TOOL_NAMES = new Set<string>(MCP_TOOLS.map(tool => tool.name));

export function validateToolName(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0 && name.length <= MAX_TOOL_NAME && TOOL_NAMES.has(name);
}

export function validateToolArguments(toolName: string, args: unknown): { ok: true; args: Record<string, string> } | { ok: false; error: ReturnType<typeof mcpInvalidArguments> } {
  if (!validateToolName(toolName) || !args || typeof args !== 'object' || Array.isArray(args)) return { ok: false, error: mcpInvalidArguments() };
  const input = args as Record<string, unknown>;
  const keys = Object.keys(input);
  const allowed = toolName === 'verify_claim' ? ['passport', 'claim'] : ['passport'];
  if (keys.some(key => !allowed.includes(key)) || keys.some(key => key === '__proto__' || key === 'constructor' || key === 'prototype')) return { ok: false, error: mcpInvalidArguments() };
  if (typeof input.passport !== 'string' || input.passport.length < 1 || input.passport.length > MAX_PASSPORT) return { ok: false, error: mcpInvalidArguments() };
  if (toolName === 'verify_claim' && (typeof input.claim !== 'string' || input.claim.length < 1 || input.claim.length > MAX_CLAIM)) return { ok: false, error: mcpInvalidArguments() };
  return { ok: true, args: Object.fromEntries(allowed.map(key => [key, input[key] as string])) };
}

export function redactForAgent(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactForAgent);
  if (!value || typeof value !== 'object') return value;
  const secretKeys = /token|secret|password|api[_-]?key|private[_-]?key|credential|authorization|cookie|session|set-cookie/i;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !secretKeys.test(key)).map(([key, item]) => [key, redactForAgent(item)]));
}

export function enforceResultLimit(value: unknown): unknown {
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') <= MAX_RESULT_BYTES) return value;
  return { error: { code: 'RESULT_TOO_LARGE', message: 'The evidence response exceeds the agent result limit.' } };
}

export function hashAgentClaim(claim: string): string {
  return `sha256:${createHash('sha256').update(claim.normalize('NFKC'), 'utf8').digest('hex')}`;
}

export function constantTimeEquals(a: string, b: string): boolean {
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

export function mcpUnauthorized() {
  return { error: { code: 'UNAUTHORIZED', message: 'A valid SPR agent credential is required.' } };
}

export function mcpInvalidArguments() {
  return { error: { code: 'INVALID_ARGUMENTS', message: 'Tool arguments are invalid or contain unsupported fields.' } };
}

export function mcpToolNotFound(name: string) {
  return { error: { code: 'TOOL_NOT_FOUND', message: `Unknown read-only SPR tool: ${String(name).slice(0, MAX_TOOL_NAME)}` } };
}
