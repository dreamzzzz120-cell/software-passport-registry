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

export const MCP_TOOLS = [
  { name: 'verify_software', description: 'Verify a Software Passport and return its current evidence-backed trust status.', inputSchema: { type: 'object', properties: { passport: { type: 'string', minLength: 1, maxLength: 512 } }, required: ['passport'], additionalProperties: false } },
  { name: 'get_passport', description: 'Retrieve the machine-readable public Software Passport.', inputSchema: { type: 'object', properties: { passport: { type: 'string', minLength: 1, maxLength: 512 } }, required: ['passport'], additionalProperties: false } },
  { name: 'get_trust_evidence', description: 'Retrieve evidence supporting a Software Passport trust determination.', inputSchema: { type: 'object', properties: { passport: { type: 'string', minLength: 1, maxLength: 512 } }, required: ['passport'], additionalProperties: false } },
  { name: 'get_security_status', description: 'Return security evidence and current security status for a Software Passport.', inputSchema: { type: 'object', properties: { passport: { type: 'string', minLength: 1, maxLength: 512 } }, required: ['passport'], additionalProperties: false } },
  { name: 'get_compliance_status', description: 'Return only compliance claims supported by observed evidence.', inputSchema: { type: 'object', properties: { passport: { type: 'string', minLength: 1, maxLength: 512 } }, required: ['passport'], additionalProperties: false } },
  { name: 'check_freshness', description: 'Return evidence freshness and whether the available evidence is stale.', inputSchema: { type: 'object', properties: { passport: { type: 'string', minLength: 1, maxLength: 512 } }, required: ['passport'], additionalProperties: false } },
  { name: 'verify_claim', description: 'Check a software trust claim against observed SPR evidence. Returns VERIFIED, CONTRADICTED, or UNVERIFIED.', inputSchema: { type: 'object', properties: { passport: { type: 'string', minLength: 1, maxLength: 512 }, claim: { type: 'string', minLength: 1, maxLength: 2000 } }, required: ['passport', 'claim'], additionalProperties: false } },
] as const;

export function redactForAgent(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactForAgent);
  if (!value || typeof value !== 'object') return value;
  const secretKeys = /token|secret|password|api[_-]?key|private[_-]?key|credential|authorization|cookie/i;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !secretKeys.test(key)).map(([key, item]) => [key, redactForAgent(item)]));
}

export function hashAgentClaim(claim: string): string {
  return `sha256:${createHash('sha256').update(claim, 'utf8').digest('hex')}`;
}

export function constantTimeEquals(a: string, b: string): boolean {
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

export function mcpUnauthorized() {
  return { error: { code: 'UNAUTHORIZED', message: 'A valid SPR agent credential is required.' } };
}

export function mcpToolNotFound(name: string) {
  return { error: { code: 'TOOL_NOT_FOUND', message: `Unknown read-only SPR tool: ${name}` } };
}
