/** SPR Infrastructure Security Contract.
 * Fail closed: integrations and trust data must never silently weaken controls.
 */
import crypto from 'node:crypto';
import dns from 'node:dns/promises';

export const HARDENING = Object.freeze({
  minNodeMajor: 22,
  maxResponseBytes: 2_000_000,
  requestTimeoutMs: 15_000,
  maxRedirects: 3,
  maxEvidenceBytes: 5_000_000,
  maxJsonDepth: 32,
  requireHttps: true,
  blockPrivateNetworks: true,
  blockCloudMetadata: true,
  credentialsServerOnly: true,
  neverTrustClientTrustState: true,
  evidenceHash: 'sha256',
} as const);

const BLOCKED_HOSTS = new Set([
  'localhost', 'localhost.localdomain', 'metadata.google.internal',
  'instance-data.ec2.internal', '169.254.169.254', '100.100.100.200',
]);

export function isPrivateAddress(address: string): boolean {
  const h = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === '::' || h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80:')) return true;
  const p = h.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return p[0] === 0 || p[0] === 10 || p[0] === 127 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168);
}

export async function assertSafeOutboundUrl(raw: string): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('SECURITY_URL_INVALID'); }
  if (url.protocol !== 'https:') throw new Error('SECURITY_HTTPS_REQUIRED');
  if (url.username || url.password) throw new Error('SECURITY_URL_CREDENTIALS_FORBIDDEN');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_HOSTS.has(host) || isPrivateAddress(host)) throw new Error('SECURITY_PRIVATE_DESTINATION_BLOCKED');
  const records = await dns.lookup(host, { all: true, verbatim: true });
  if (!records.length || records.some(r => isPrivateAddress(r.address))) throw new Error('SECURITY_DNS_REBIND_BLOCKED');
  return url;
}

export function sha256Evidence(value: unknown): string {
  const canonical = JSON.stringify(value, Object.keys((value && typeof value === 'object' && !Array.isArray(value)) ? value as object : {}).sort());
  return `sha256:${crypto.createHash('sha256').update(canonical ?? 'null', 'utf8').digest('hex')}`;
}

export function redactCredentialFields(value: unknown): unknown {
  const secret = /(token|secret|password|private.?key|api.?key|authorization|access.?key|credential)/i;
  if (Array.isArray(value)) return value.map(redactCredentialFields);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, secret.test(k) ? '[REDACTED]' : redactCredentialFields(v)]));
}

export function assertEvidenceSize(value: unknown): void {
  const bytes = Buffer.byteLength(JSON.stringify(value) ?? 'null', 'utf8');
  if (bytes > HARDENING.maxEvidenceBytes) throw new Error('SECURITY_EVIDENCE_TOO_LARGE');
}

export function assertRuntime(): void {
  const major = Number(process.versions.node.split('.')[0]);
  if (!Number.isInteger(major) || major < HARDENING.minNodeMajor) throw new Error('SECURITY_UNSUPPORTED_NODE_RUNTIME');
}
