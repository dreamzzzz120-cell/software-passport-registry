/**
 * Experience Agent production hardening -- behavioural tests against the real
 * /api/agent/v1 router with authentication and the database replaced by
 * controlled fakes, so every claim below is about what the router actually
 * returns for a given request, not about how its source reads.
 *
 * The fake database records every statement the router issues. That is what
 * lets these tests prove, rather than assert by inspection, that every query
 * carries the authenticated tenant and that no command ever writes.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { PgDialect } from 'drizzle-orm/pg-core';

type Row = Record<string, unknown>;
const TENANTS = {
  'tenant-a-token': { id: 11, uid: 'uid-a', email: 'a@example.test', tenantId: 'tenant-a', role: 'Owner', clientId: null, emailVerified: true },
  'tenant-b-token': { id: 22, uid: 'uid-b', email: 'b@example.test', tenantId: 'tenant-b', role: 'Owner', clientId: null, emailVerified: true },
} as const;

const passports: Row[] = [
  { id: 'pass-a', tenant_id: 'tenant-a', name: 'alpha app', client_id: 'client-a' },
  { id: 'pass-b', tenant_id: 'tenant-b', name: 'beta app', client_id: 'client-b' },
];
const findings: Row[] = [
  { id: 'f-a-1', tenant_id: 'tenant-a', passport_id: 'pass-a', control_id: 'VULN', title: 'CVE-2026-1 open', severity: 'critical', status: 'open', description: 'd', remediation: 'r', evidence_ids: '["e-a-1"]', updated_at: '2026-09-01T00:00:00.000Z', resolved_at: null },
  { id: 'f-a-2', tenant_id: 'tenant-a', passport_id: 'pass-a', control_id: 'LIC', title: 'licence', severity: 'low', status: 'resolved', description: 'd', remediation: 'r', evidence_ids: '[]', updated_at: '2026-09-02T00:00:00.000Z', resolved_at: '2026-09-02T00:00:00.000Z' },
  { id: 'f-b-1', tenant_id: 'tenant-b', passport_id: 'pass-b', control_id: 'VULN', title: 'b finding', severity: 'high', status: 'open', description: 'd', remediation: 'r', evidence_ids: '[]', updated_at: '2026-09-01T00:00:00.000Z', resolved_at: null },
];
const evidence: Row[] = [
  { id: 'e-a-1', tenant_id: 'tenant-a', passport_id: 'pass-a', provider: 'osv', control_id: 'VULN', subject: 'lodash@1', source_url: 'https://osv.dev/vulnerability/GHSA-x', observed_at: '2026-09-01T00:00:00.000Z', verification_method: 'api', status: 'FAIL', severity: 'critical', evidence_hash: 'sha256:abc123', limitation: 'OSV coverage only' },
  { id: 'e-b-1', tenant_id: 'tenant-b', passport_id: 'pass-b', provider: 'osv', control_id: 'VULN', subject: 'x', source_url: 'https://osv.dev/b', observed_at: '2026-09-01T00:00:00.000Z', verification_method: 'api', status: 'FAIL', severity: 'high', evidence_hash: 'sha256:bbb', limitation: null },
];
const observations: Row[] = [
  { id: 'obs-a-1', tenant_id: 'tenant-a', passport_id: 'pass-a', observation_version: 1, generated_at: '2026-09-01T01:00:00.000Z', previous_observation_id: null, evidence_ids: '["e-a-1"]', finding_ids: '["f-a-1"]', canonical_payload_hash: 'sha256:obs', completeness_basis_points: 7500, open_finding_count: 1, unknown_dimension_count: 2 },
];

export interface RecordedQuery { sql: string; params: unknown[] }
const recorded: RecordedQuery[] = [];
let failNextQuery = false;
const dialect = new PgDialect();

function tenantOf(rows: Row[], tenantId: unknown) { return rows.filter((r) => r.tenant_id === tenantId); }

function fakeDb() {
  return {
    async execute(query: unknown) {
      const { sql, params } = dialect.sqlToQuery(query as any);
      recorded.push({ sql, params });
      if (failNextQuery) { failNextQuery = false; throw new Error('simulated database outage'); }
      const tenantId = params[0];
      const rows = (r: Row[]) => ({ rows: r });
      if (/FROM passports WHERE tenant_id=\$1 AND \(LOWER\(name\)=\$2 OR LOWER\(id\)=\$3\)/.test(sql)) return rows(tenantOf(passports, tenantId).filter((p) => String(p.name).toLowerCase() === params[1] || String(p.id).toLowerCase() === params[1]).slice(0, 1));
      if (/FROM passports WHERE tenant_id=\$1 AND id=\$2/.test(sql)) return rows(tenantOf(passports, tenantId).filter((p) => p.id === params[1]).slice(0, 1));
      if (/FROM trust_findings WHERE tenant_id=\$1 AND passport_id=\$2/.test(sql)) return rows(tenantOf(findings, tenantId).filter((f) => f.passport_id === params[1]));
      if (/FROM evidence_ledger WHERE tenant_id=\$1 AND passport_id=\$2/.test(sql)) return rows(tenantOf(evidence, tenantId).filter((e) => e.passport_id === params[1]));
      if (/FROM trust_observations WHERE tenant_id=\$1 AND passport_id=\$2/.test(sql)) return rows(tenantOf(observations, tenantId).filter((o) => o.passport_id === params[1]));
      if (/COUNT\(\*\)::int AS count FROM clients WHERE tenant_id=\$1/.test(sql)) return rows([{ count: tenantId === 'tenant-a' ? 1 : 0 }]);
      if (/COUNT\(\*\)::int AS count FROM passports WHERE tenant_id=\$1/.test(sql)) return rows([{ count: tenantOf(passports, tenantId).length }]);
      if (/FROM trust_findings WHERE tenant_id=\$1$/.test(sql.trim()) || /AS open FROM trust_findings WHERE tenant_id=\$1/.test(sql)) { const t = tenantOf(findings, tenantId); const open = t.filter((f) => f.status === 'open'); return rows([{ total: t.length, critical_high: open.filter((f) => ['critical', 'high'].includes(String(f.severity))).length, open: open.length }]); }
      if (/FROM alerts WHERE tenant_id=\$1/.test(sql)) return rows([{ active: 0 }]);
      if (/FROM passports p LEFT JOIN trust_findings f/.test(sql)) return rows(tenantOf(passports, tenantId).map((p) => { const open = tenantOf(findings, tenantId).filter((f) => f.passport_id === p.id && f.status === 'open'); return { passport_id: p.id, name: p.name, client_id: p.client_id, open_findings: open.length, critical_high: open.filter((f) => ['critical', 'high'].includes(String(f.severity))).length, finding_ids: open.map((f) => f.id) }; }));
      if (/SELECT id,name FROM clients WHERE tenant_id=\$1/.test(sql)) return rows(tenantId === 'tenant-a' ? [{ id: 'client-a', name: 'Client A' }] : []);
      throw new Error(`fake db: unhandled statement: ${sql}`);
    },
  };
}

vi.mock('../src/middleware/security.ts', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const header = String(req.headers.authorization ?? '');
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const user = (TENANTS as Record<string, unknown>)[token];
    if (!user) return res.status(401).json({ error: 'Unauthorized: Missing or invalid authorization token' });
    req.user = user; req.db = fakeDb();
    return next();
  },
  rateLimiter: (_req: any, _res: any, next: any) => next(),
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

let server: Server; let baseUrl = '';
beforeAll(async () => {
  const { createAgentApiRouter } = await import('../src/routes/agent-api.ts');
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use('/api/agent/v1', createAgentApiRouter());
  // Same contract as server.ts: an unexpected error is a generic 500, never a
  // partial or invented result.
  app.use((err: any, _req: any, res: any, _next: any) => { const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500; return res.status(status).json({ error: status === 500 ? 'An unexpected server error occurred.' : err?.message || 'Request failed.', code: status === 500 ? 'INTERNAL_SERVER_ERROR' : 'REQUEST_FAILED' }); });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('no address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

const post = (path: string, body: unknown, token?: string, raw = false) => fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: raw ? (body as string) : JSON.stringify(body) });
const command = (input: string, token = 'tenant-a-token') => post('/api/agent/v1/command', { input }, token);
const FRONTEND_ALLOWLIST = ['/dashboard', '/clients', '/passports', '/vendors', '/monitoring', '/compliance', '/reports', '/billing', '/settings'];
const TRUST_WORDS = /\b(VERIFIED|INVESTIGATE|AVOID)\b/;

describe('authentication and input boundaries', () => {
  it('rejects an unauthenticated /command request', async () => {
    const response = await post('/api/agent/v1/command', { input: 'show clients' });
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toMatch(TRUST_WORDS);
  });

  it('rejects an invalid bearer token', async () => {
    expect((await command('show clients', 'not-a-real-token')).status).toBe(401);
  });

  it('rejects command input over 500 characters', async () => {
    const response = await command('x'.repeat(501));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('INVALID_AGENT_COMMAND');
    expect(recorded.length).toBe(0);
  });

  it.each([
    ['empty object', {}],
    ['empty input', { input: '   ' }],
    ['wrong type', { input: 42 }],
    ['extra keys', { input: 'show clients', tenantId: 'tenant-b' }],
    ['bad context', { input: 'show clients', context: { path: 'x'.repeat(501) } }],
    ['array body', ['show clients']],
  ])('fails safely on a malformed payload (%s)', async (_label, body) => {
    recorded.length = 0;
    const response = await post('/api/agent/v1/command', body, 'tenant-a-token');
    expect(response.status).toBe(400);
    expect(recorded.length).toBe(0);
  });

  it('fails safely on a body that is not JSON', async () => {
    const response = await post('/api/agent/v1/command', '{not json', 'tenant-a-token', true);
    expect(response.status).toBe(400);
  });
});

describe('tenant scoping', () => {
  it('every statement issued for a command carries the authenticated tenant and none writes', async () => {
    recorded.length = 0;
    const response = await command('What is my biggest risk today?');
    expect(response.status).toBe(200);
    expect(recorded.length).toBeGreaterThan(0);
    for (const q of recorded) {
      expect(q.params[0]).toBe('tenant-a');
      expect(q.sql).toMatch(/tenant_id=\$1/);
      expect(q.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);
    }
  });

  it('tenant A sees only tenant A counts and tenant B sees only tenant B counts', async () => {
    const a = await (await command('What is my biggest risk today?', 'tenant-a-token')).json();
    const b = await (await command('What is my biggest risk today?', 'tenant-b-token')).json();
    expect(a.data.counts.clients).toBe(1); expect(a.data.counts.passports).toBe(1); expect(a.data.counts.criticalHighFindings).toBe(1);
    expect(b.data.counts.clients).toBe(0); expect(b.data.counts.passports).toBe(1);
    expect(a.data.topPassports.map((p: any) => p.passport_id)).toEqual(['pass-a']);
    expect(b.data.topPassports.map((p: any) => p.passport_id)).toEqual(['pass-b']);
    expect(a.provenance.tenantScoped).toBe(true);
  });

  it('tenant A cannot retrieve tenant B passport data by name, id, or vendor-risk', async () => {
    for (const body of [{ path: '/api/agent/v1/verify-software', payload: { query: 'beta app' } }, { path: '/api/agent/v1/verify-software', payload: { query: 'pass-b' } }, { path: '/api/agent/v1/verify-passport', payload: { passportId: 'pass-b' } }, { path: '/api/agent/v1/vendor-risk', payload: { passportId: 'pass-b' } }]) {
      const response = await post(body.path, body.payload, 'tenant-a-token');
      expect(response.status, body.path).toBe(404);
      const json = await response.json();
      expect(json.status).toBe('UNKNOWN');
      expect(JSON.stringify(json)).not.toContain('e-b-1');
      expect(JSON.stringify(json)).not.toContain('f-b-1');
    }
    const direct = await fetch(`${baseUrl}/api/agent/v1/passport/pass-b`, { headers: { authorization: 'Bearer tenant-a-token' } });
    expect(direct.status).toBe(404);
  });

  it('the tenant in the request body cannot override the authenticated tenant', async () => {
    const response = await post('/api/agent/v1/verify-software', { query: 'beta app', tenantId: 'tenant-b' }, 'tenant-a-token');
    expect(response.status).toBe(400);
  });
});

describe('UNKNOWN is the only answer for unobserved software', () => {
  it('unknown software returns UNKNOWN with provenance that says the lookup matched nothing', async () => {
    const response = await post('/api/agent/v1/verify-software', { query: 'totally unregistered thing' }, 'tenant-a-token');
    expect(response.status).toBe(404);
    const json = await response.json();
    expect(json.status).toBe('UNKNOWN');
    expect(json.reason).toBe('SOFTWARE_NOT_REGISTERED');
    expect(json.provenance).toEqual({ kind: 'tenant_scoped_database_lookup', table: 'passports', fields: ['id', 'name'], matched: false });
    expect(JSON.stringify(json)).not.toMatch(TRUST_WORDS);
    expect(json.trustDecision).toBeUndefined();
    expect(json.trust_score).toBeUndefined();
  });

  it('the command that leads to an unknown lookup never states a negative decision', async () => {
    const json = await (await command('verify totally unregistered thing')).json();
    expect(json.intent).toBe('passport');
    expect(json.action).toEqual({ type: 'verify', endpoint: '/api/agent/v1/verify-software', payload: { query: 'totally unregistered thing' } });
    expect(json.reply).not.toMatch(/unsafe|malicious|avoid|reject|do not (use|deploy)/i);
  });
});

describe('observed software: evidence, provenance and no invented trust decision', () => {
  it('returns the observed records with the table/fields/filter and ids they came from', async () => {
    const json = await (await post('/api/agent/v1/verify-software', { query: 'Alpha App' }, 'tenant-a-token')).json();
    expect(json.status).toBe('OBSERVED');
    expect(json.trustDecision.status).toBe('NOT_EVALUATED_BY_EXPERIENCE_AGENT');
    expect(JSON.stringify(json.trustDecision)).not.toMatch(TRUST_WORDS);
    expect(json.findings).toMatchObject({ total: 2, open: 1, criticalOrHigh: 1 });
    expect(json.evidence).toMatchObject({ count: 1, completeness: 0.75, latestObservationAt: '2026-09-01T01:00:00.000Z', latestHash: 'sha256:obs' });
    expect(json.provenance.tenantScoped).toBe(true);
    expect(json.provenance.passportRecord).toEqual({ table: 'passports', fields: ['id', 'name'], passportId: 'pass-a' });
    expect(json.provenance.findingRecords.table).toBe('trust_findings');
    expect(json.provenance.findingRecords.findingIds).toEqual(['f-a-1', 'f-a-2']);
    expect(json.provenance.evidenceRecords.table).toBe('evidence_ledger');
    expect(json.provenance.evidenceRecords.evidenceIds).toEqual(['e-a-1']);
    expect(json.provenance.observationRecords.observationIds).toEqual(['obs-a-1']);
    for (const record of [json.provenance.findingRecords, json.provenance.evidenceRecords, json.provenance.observationRecords]) expect(record.fields.length).toBeGreaterThan(0);
  });

  it('preserves source URLs, hashes, timestamps and limitations exactly as observed', async () => {
    const json = await (await post('/api/agent/v1/verify-passport', { passportId: 'pass-a' }, 'tenant-a-token')).json();
    expect(json.sources).toEqual([{ evidenceId: 'e-a-1', provider: 'osv', sourceUrl: 'https://osv.dev/vulnerability/GHSA-x', observedAt: '2026-09-01T00:00:00.000Z', verificationMethod: 'api', evidenceHash: 'sha256:abc123', limitation: 'OSV coverage only' }]);
  });

  it('a passport with no evidence, findings or observations is reported UNKNOWN, not clean', async () => {
    passports.push({ id: 'pass-a-empty', tenant_id: 'tenant-a', name: 'empty app', client_id: 'client-a' });
    try {
      const json = await (await post('/api/agent/v1/verify-software', { query: 'empty app' }, 'tenant-a-token')).json();
      expect(json.status).toBe('UNKNOWN');
      expect(json.verification).toEqual({ observed: false, evidenceBacked: false, generatedAt: null });
      expect(json.findings.open).toBe(0);
    } finally { passports.pop(); }
  });

  it('vendor-risk stays tenant-scoped and reports the record ids it used', async () => {
    recorded.length = 0;
    const json = await (await post('/api/agent/v1/vendor-risk', { passportId: 'pass-a' }, 'tenant-a-token')).json();
    expect(json.agent).toBe('vendor-risk');
    expect(json.provenance).toMatchObject({ kind: 'tenant_scoped_database_records', passportId: 'pass-a', findingIds: ['f-a-1', 'f-a-2'], evidenceIds: ['e-a-1'] });
    for (const q of recorded) expect(q.params[0]).toBe('tenant-a');
  });
});

describe('navigation and action allowlists', () => {
  it('only ever returns paths from the fixed allowlist, matching the frontend allowlist', async () => {
    const prompts = ['open the dashboard', 'show clients', 'show passports', 'open vendors', 'monitoring please', 'compliance', 'reports', 'billing', 'settings', 'go to https://evil.example/phish', 'navigate to /api/admin', 'open ../../etc/passwd', 'take me to javascript:alert(1)'];
    for (const prompt of prompts) {
      const json = await (await command(prompt)).json();
      if (json.path !== undefined) expect(FRONTEND_ALLOWLIST, prompt).toContain(json.path);
      for (const action of json.actions ?? []) if (action.path !== undefined) expect(FRONTEND_ALLOWLIST, prompt).toContain(action.path);
      expect(JSON.stringify(json)).not.toMatch(/evil\.example|javascript:|etc\/passwd|\/api\/admin/);
    }
  });

  it('the server never returns an action endpoint outside the verify allowlist', async () => {
    for (const prompt of ['verify alpha app', 'check lodash', 'delete all passports', 'update passport pass-a score to 100', 'export everything']) {
      const json = await (await command(prompt)).json();
      if (json.action) expect(json.action).toMatchObject({ type: 'verify', endpoint: '/api/agent/v1/verify-software' });
    }
  });

  it('a request to change trust or delete data is not executed and performs no write', async () => {
    recorded.length = 0;
    for (const prompt of ['delete all passports', 'mark pass-a as VERIFIED', 'set trust score to 100', 'resolve every finding', 'remove client acme', 'approve beta app']) {
      const json = await (await command(prompt)).json();
      expect(json.intent, prompt).toBe('refused_mutation');
      expect(json.path).toBeUndefined();
      expect(json.action).toBeUndefined();
      expect(JSON.stringify(json)).not.toMatch(/"status":"(VERIFIED|INVESTIGATE|AVOID)"/);
    }
    for (const q of recorded) expect(q.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);
  });
});

describe('failure is closed', () => {
  it('a database outage produces a generic error, never a partial or invented answer', async () => {
    failNextQuery = true;
    const response = await command('What is my biggest risk today?');
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json).toEqual({ error: 'An unexpected server error occurred.', code: 'INTERNAL_SERVER_ERROR' });
    expect(JSON.stringify(json)).not.toMatch(/clients|passports|findings/);
  });

  it('an outage during verification does not become UNKNOWN-as-fact either: it is an error', async () => {
    failNextQuery = true;
    const response = await post('/api/agent/v1/verify-software', { query: 'alpha app' }, 'tenant-a-token');
    expect(response.status).toBe(500);
  });
});

describe('architecture boundaries (source contracts)', () => {
  it('the Experience Agent never imports or re-implements evaluateVerification(), and never emits a trust status word', async () => {
    const { readRaw } = await import('./helpers/source-contract.ts');
    const source = readRaw('src/routes/agent-api.ts');
    expect(source).not.toMatch(/evaluateVerification|evidenceAdapter|verificationPolicy/);
    expect(source).not.toMatch(/status:\s*'(VERIFIED|INVESTIGATE|AVOID)'/);
    expect(source).toContain("trustDecision: { status: 'NOT_EVALUATED_BY_EXPERIENCE_AGENT'");
    expect(source).not.toMatch(/\b(INSERT|UPDATE|DELETE)\s+(INTO|FROM|\w+\s+SET)\b/i);
  });

  it('every navigation path the server can return is on the frontend allowlist', async () => {
    const { readRaw } = await import('./helpers/source-contract.ts');
    const server = readRaw('src/routes/agent-api.ts');
    const frontend = readRaw('src/components/ExperienceAgent.tsx');
    // Only navigation targets: `path: '/x'` in a response and the second
    // element of each navigationIntent tuple. Router-relative route names
    // ('/command', '/verify-software') are not navigation.
    const serverPaths = [...server.matchAll(/(?:path: |\/, )'(\/[a-z-]+)'/g)].map((m) => m[1]).filter((p) => !p.startsWith('/api'));
    const allowlist = frontend.match(/const SAFE_NAV_PATHS = new Set\(\[([^\]]+)\]\)/)![1].match(/'([^']+)'/g)!.map((s) => s.replace(/'/g, ''));
    expect(serverPaths.length).toBeGreaterThan(0);
    for (const p of new Set(serverPaths)) expect(allowlist, p).toContain(p);
  });
});
