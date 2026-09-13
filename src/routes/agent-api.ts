import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '../middleware/security.ts';
import type { ScopedDb } from '../middleware/tenant-scope.ts';
import { evaluateVendorRisk } from '../agents/vendor-risk-agent.ts';

const passportInput = z.object({ passportId: z.string().trim().min(1).max(255) }).strict();
const softwareInput = z.object({ query: z.string().trim().min(1).max(500) }).strict();
const vendorRiskInput = z.object({ passportId: z.string().trim().min(1).max(255), staleAfterDays: z.number().int().min(1).max(3650).optional() }).strict();
const commandInput = z.object({ input: z.string().trim().min(1).max(500), context: z.object({ path: z.string().max(500).optional() }).optional() }).strict();

// Verbs that ask the agent to change state or hand down a decision. None of
// these has (or will have) a wired action; see the refusal in /command.
const MUTATION_INTENT = /\b(delete|remove|purge|drop|wipe|erase|destroy|update|edit|modify|change|override|overwrite|set|mark|flag|resolve|close|reopen|approve|reject|revoke|certify|whitelist|blocklist|ban)\b/;

export function createAgentApiRouter() {
  const router = Router();
  router.use(requireAuth);

  router.post('/command', async (req: AuthenticatedRequest, res, next) => {
    const parsed = commandInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_AGENT_COMMAND', details: parsed.error.flatten() });
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const input = parsed.data.input;
      const q = input.toLowerCase();
      if (/what can you do|help|how do you work/.test(q)) return res.json({ schemaVersion: 'spr-experience-agent-v1', intent: 'help', reply: 'I can summarize observed workspace data, inspect a passport, review vendor risk, and take you to the right workspace. Every factual result includes provenance. I do not invent evidence or silently change trust decisions.', actions: [{ label: 'Show my risk', command: 'What is my biggest risk today?' }, { label: 'Show clients', path: '/clients' }, { label: 'Show passports', path: '/passports' }, { label: 'Show vendor risk', path: '/vendors' }] });
      // The agent has no write actions at all. A request to delete, change or
      // decide something is refused here, explicitly, before any other intent
      // can match: "delete all passports" must not quietly become "open the
      // Passports page", and "mark X as VERIFIED" must not become a lookup
      // whose answer could be read as agreement.
      if (MUTATION_INTENT.test(q)) return res.json({ schemaVersion: 'spr-experience-agent-v1', intent: 'refused_mutation', reply: 'I can’t do that. The SPR Agent has no ability to create, change, delete, resolve or decide anything — it only reports records it can retrieve from your workspace. Use the relevant SPR workspace for changes; every change there is authorised and recorded on its own.', actions: [{ label: 'Risk summary', command: 'What is my biggest risk today?' }, { label: 'Open Passports', path: '/passports' }] });
      const nav = navigationIntent(q);
      if (nav) return res.json({ schemaVersion: 'spr-experience-agent-v1', intent: 'navigation', ...nav });
      if (/biggest risk|highest risk|most risky|risk today|what should i (do|work on)|priority|priorities|overview|summary|how are we doing/.test(q)) {
        const summary = await getRiskSummary(db, tenantId);
        return res.json({ schemaVersion: 'spr-experience-agent-v1', intent: 'summary', reply: summary.reply, data: summary.data, provenance: summary.provenance });
      }
      const passportMatch = q.match(/(?:why did|explain|show|inspect|check|assess|verify)\s+(?:the\s+)?(?:passport|software)\s*[:#-]?\s*(.+)$/i) || q.match(/(?:verify|check|assess)\s+(.+)$/i);
      if (passportMatch?.[1]?.trim()) return res.json({ schemaVersion: 'spr-experience-agent-v1', intent: 'passport', action: { type: 'verify', endpoint: '/api/agent/v1/verify-software', payload: { query: passportMatch[1].trim() } }, reply: `I’ll inspect “${passportMatch[1].trim()}” and return the observed records and their provenance. I will not invent a trust decision.` });
      if (/vendor|third.?party/.test(q) && /risk|review|check|assess/.test(q)) return res.json({ schemaVersion: 'spr-experience-agent-v1', intent: 'vendor_risk', path: '/vendors', reply: 'Opening Vendor Risk. Results there are based on observed evidence and findings.' });
      return res.json({ schemaVersion: 'spr-experience-agent-v1', intent: 'unsupported', reply: 'I don’t have a safe wired action for that request yet. I can summarize observed risk, inspect or verify software, review vendor risk, or open an SPR workspace.', actions: [{ label: 'Risk summary', command: 'What is my biggest risk today?' }, { label: 'Open Command Center', path: '/dashboard' }, { label: 'Open Passports', path: '/passports' }] });
    } catch (error) { return next(error); }
  });

  router.post('/verify-software', async (req: AuthenticatedRequest, res, next) => {
    const parsed = softwareInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_QUERY', details: parsed.error.flatten() });
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const q = parsed.data.query.toLowerCase();
      const passport = (await db.execute(sql`SELECT id,name FROM passports WHERE tenant_id=${tenantId} AND (LOWER(name)=${q} OR LOWER(id)=${q}) LIMIT 1`) as any).rows?.[0];
      if (!passport) return res.status(404).json({ schemaVersion: 'spr-agent-v1', status: 'UNKNOWN', reason: 'SOFTWARE_NOT_REGISTERED', query: parsed.data.query, provenance: { kind: 'tenant_scoped_database_lookup', table: 'passports', fields: ['id', 'name'], matched: false } });
      return buildVerificationResponse(db, tenantId, passport, res, next);
    } catch (error) { return next(error); }
  });

  router.post('/verify-passport', async (req: AuthenticatedRequest, res, next) => {
    const parsed = passportInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_PASSPORT_ID', details: parsed.error.flatten() });
    try {
      const db = req.db!;
      const passport = (await db.execute(sql`SELECT id,name FROM passports WHERE tenant_id=${req.user!.tenantId} AND id=${parsed.data.passportId} LIMIT 1`) as any).rows?.[0];
      if (!passport) return res.status(404).json({ schemaVersion: 'spr-agent-v1', status: 'UNKNOWN', reason: 'PASSPORT_NOT_FOUND', passportId: parsed.data.passportId, provenance: { kind: 'tenant_scoped_database_lookup', table: 'passports', fields: ['id', 'name'], matched: false } });
      return buildVerificationResponse(db, req.user!.tenantId, passport, res, next);
    } catch (error) { return next(error); }
  });

  router.get('/passport/:passportId', async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const passportId = req.params.passportId;
      const scope = (await db.execute(sql`SELECT id,name FROM passports WHERE tenant_id=${req.user!.tenantId} AND id=${passportId} LIMIT 1`) as any).rows?.[0];
      if (!scope) return res.status(404).json({ schemaVersion: 'spr-agent-v1', status: 'UNKNOWN', reason: 'PASSPORT_NOT_FOUND', passportId, provenance: { kind: 'tenant_scoped_database_lookup', table: 'passports', fields: ['id', 'name'], matched: false } });
      return buildVerificationResponse(db, req.user!.tenantId, scope, res, next);
    } catch (error) { return next(error); }
  });

  router.post('/vendor-risk', async (req: AuthenticatedRequest, res, next) => {
    const parsed = vendorRiskInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID_VENDOR_RISK_REQUEST', details: parsed.error.flatten() });
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const passport = (await db.execute(sql`SELECT id,name FROM passports WHERE tenant_id=${tenantId} AND id=${parsed.data.passportId} LIMIT 1`) as any).rows?.[0];
      if (!passport) return res.status(404).json({ status: 'UNKNOWN', reason: 'PASSPORT_NOT_FOUND', passportId: parsed.data.passportId, provenance: { kind: 'tenant_scoped_database_lookup', table: 'passports', fields: ['id', 'name'], matched: false } });
      const findings = (await db.execute(sql`SELECT id,severity,status,title,updated_at FROM trust_findings WHERE tenant_id=${tenantId} AND passport_id=${passport.id} ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END, updated_at DESC LIMIT 200`) as any).rows || [];
      const evidence = (await db.execute(sql`SELECT id,provider,observed_at,verification_method,status,limitation FROM evidence_ledger WHERE tenant_id=${tenantId} AND passport_id=${passport.id} ORDER BY observed_at DESC LIMIT 500`) as any).rows || [];
      const latest = (await db.execute(sql`SELECT generated_at,completeness_basis_points FROM trust_observations WHERE tenant_id=${tenantId} AND passport_id=${passport.id} ORDER BY observation_version DESC LIMIT 1`) as any).rows?.[0];
      const result = evaluateVendorRisk({ passport: { id: passport.id, name: passport.name }, findings: findings.map((finding: any) => ({ id: String(finding.id), severity: String(finding.severity || 'unknown'), status: String(finding.status || 'unknown'), title: String(finding.title || 'Untitled finding'), updatedAt: finding.updated_at ? new Date(finding.updated_at).toISOString() : null })), evidence: evidence.map((item: any) => ({ id: String(item.id), provider: item.provider == null ? null : String(item.provider), observedAt: item.observed_at ? new Date(item.observed_at).toISOString() : null, verificationMethod: item.verification_method == null ? null : String(item.verification_method), status: item.status == null ? null : String(item.status), limitation: item.limitation == null ? null : String(item.limitation) })), latestObservationAt: latest?.generated_at ? new Date(latest.generated_at).toISOString() : null, completeness: latest?.completeness_basis_points == null ? null : Number(latest.completeness_basis_points) / 10000, evaluatedAt: Date.now(), staleAfterDays: parsed.data.staleAfterDays });
      return res.json({ ...result, provenance: { kind: 'tenant_scoped_database_records', passportId: passport.id, findingIds: findings.map((f: any) => String(f.id)), evidenceIds: evidence.map((e: any) => String(e.id)), latestObservationAt: latest?.generated_at ?? null } });
    } catch (error) { return next(error); }
  });

  return router;
}

function navigationIntent(q: string): { path: string; reply: string } | null {
  const routes: Array<[RegExp, string, string]> = [[/command center|dashboard|home/, '/dashboard', 'Opening the Command Center.'], [/clients?|customer list|client management/, '/clients', 'Opening Clients.'], [/passports?|registry|software inventory/, '/passports', 'Opening Passports.'], [/vendors?|third.?party risk/, '/vendors', 'Opening Vendor Risk.'], [/monitoring|alerts?/, '/monitoring', 'Opening Monitoring.'], [/compliance|governance/, '/compliance', 'Opening Compliance.'], [/reports?/, '/reports', 'Opening Reports.'], [/billing|subscription|plan/, '/billing', 'Opening Billing.'], [/settings?/, '/settings', 'Opening Settings.']];
  for (const [pattern, path, reply] of routes) if (pattern.test(q)) return { path, reply };
  return null;
}

async function getRiskSummary(db: ScopedDb, tenantId: string) {
  const [clients, passports, findings, alerts] = await Promise.all([
    db.execute(sql`SELECT COUNT(*)::int AS count FROM clients WHERE tenant_id=${tenantId}`),
    db.execute(sql`SELECT COUNT(*)::int AS count FROM passports WHERE tenant_id=${tenantId}`),
    db.execute(sql`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE LOWER(severity) IN ('critical','high') AND LOWER(status) NOT IN ('resolved','closed','verified'))::int AS critical_high, COUNT(*) FILTER (WHERE LOWER(status) NOT IN ('resolved','closed','verified'))::int AS open FROM trust_findings WHERE tenant_id=${tenantId}`),
    db.execute(sql`SELECT COUNT(*) FILTER (WHERE LOWER(status) NOT IN ('resolved','closed'))::int AS active FROM alerts WHERE tenant_id=${tenantId}`),
  ]);
  const top = (await db.execute(sql`SELECT p.id AS passport_id, p.name, p.client_id, COUNT(f.id)::int AS open_findings, COUNT(f.id) FILTER (WHERE LOWER(f.severity) IN ('critical','high'))::int AS critical_high, ARRAY_AGG(f.id) FILTER (WHERE f.id IS NOT NULL AND LOWER(f.status) NOT IN ('resolved','closed','verified')) AS finding_ids FROM passports p LEFT JOIN trust_findings f ON f.passport_id=p.id AND f.tenant_id=${tenantId} AND LOWER(f.status) NOT IN ('resolved','closed','verified') WHERE p.tenant_id=${tenantId} GROUP BY p.id,p.name,p.client_id ORDER BY critical_high DESC, open_findings DESC, p.name ASC LIMIT 10`) as any).rows || [];
  const clientRows = (await db.execute(sql`SELECT id,name FROM clients WHERE tenant_id=${tenantId} ORDER BY name ASC LIMIT 10`) as any).rows || [];
  const c = (clients as any).rows?.[0]?.count ?? 0;
  const p = (passports as any).rows?.[0]?.count ?? 0;
  const f = (findings as any).rows?.[0] ?? {};
  const a = (alerts as any).rows?.[0]?.active ?? 0;
  const generatedAt = new Date().toISOString();
  return { reply: `I found ${c} client(s), ${p} passport(s), ${f.open ?? 0} open finding(s), ${f.critical_high ?? 0} critical/high open finding(s), and ${a} active alert(s). These are database observations, not invented estimates.`, data: { counts: { clients: c, passports: p, openFindings: f.open ?? 0, criticalHighFindings: f.critical_high ?? 0, activeAlerts: a }, topPassports: top, topClients: clientRows }, provenance: { generatedAt, tenantScoped: true, sources: [{ table: 'clients', fields: ['id'], observation: 'COUNT(*)', filter: 'tenant_id = authenticated tenant' }, { table: 'passports', fields: ['id'], observation: 'COUNT(*)', filter: 'tenant_id = authenticated tenant' }, { table: 'trust_findings', fields: ['id', 'severity', 'status'], observation: 'open and critical/high counts plus finding IDs for ranked passports', filter: 'tenant_id = authenticated tenant' }, { table: 'alerts', fields: ['status'], observation: 'active alert count', filter: 'tenant_id = authenticated tenant' }] } };
}

async function buildVerificationResponse(db: ScopedDb, tenantId: string, passport: any, res: any, next: any) {
  try {
    const findings = (await db.execute(sql`SELECT id,control_id,title,severity,status,description,remediation,evidence_ids,updated_at,resolved_at FROM trust_findings WHERE tenant_id=${tenantId} AND passport_id=${passport.id} ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END, updated_at DESC`) as any).rows || [];
    const evidence = (await db.execute(sql`SELECT id,provider,control_id,subject,source_url,observed_at,verification_method,status,severity,evidence_hash,limitation FROM evidence_ledger WHERE tenant_id=${tenantId} AND passport_id=${passport.id} ORDER BY observed_at DESC LIMIT 200`) as any).rows || [];
    const observations = (await db.execute(sql`SELECT id,observation_version,generated_at,previous_observation_id,evidence_ids,finding_ids,canonical_payload_hash,completeness_basis_points,open_finding_count,unknown_dimension_count FROM trust_observations WHERE tenant_id=${tenantId} AND passport_id=${passport.id} ORDER BY observation_version DESC LIMIT 20`) as any).rows || [];
    const latest = observations[0];
    const openFindings = findings.filter((f: any) => !['resolved','closed','verified'].includes(String(f.status).toLowerCase()));
    const criticalOrHigh = openFindings.filter((f: any) => ['critical','high'].includes(String(f.severity).toLowerCase()));
    const completeness = latest?.completeness_basis_points == null ? null : Number(latest.completeness_basis_points) / 10000;
    const observed = Boolean(latest || evidence.length || findings.length);
    return res.json({ schemaVersion: 'spr-agent-v1', status: observed ? 'OBSERVED' : 'UNKNOWN', software: { passportId: passport.id, name: passport.name }, trustDecision: { status: 'NOT_EVALUATED_BY_EXPERIENCE_AGENT', reason: 'The Experience Agent reports observed records and does not create or duplicate SPR trust decisions.' }, evidence: { count: evidence.length, completeness, latestObservationAt: latest?.generated_at ?? null, latestHash: latest?.canonical_payload_hash ?? null }, findings: { total: findings.length, open: openFindings.length, criticalOrHigh: criticalOrHigh.length, items: findings.slice(0, 50) }, verification: { observed, evidenceBacked: evidence.length > 0, generatedAt: latest?.generated_at ?? null }, sources: evidence.slice(0, 50).map((e: any) => ({ evidenceId: String(e.id), provider: e.provider, sourceUrl: e.source_url, observedAt: e.observed_at, verificationMethod: e.verification_method, evidenceHash: e.evidence_hash, limitation: e.limitation })), provenance: { tenantScoped: true, passportRecord: { table: 'passports', fields: ['id', 'name'], passportId: passport.id }, findingRecords: { table: 'trust_findings', fields: ['id', 'control_id', 'title', 'severity', 'status', 'description', 'remediation', 'evidence_ids', 'updated_at', 'resolved_at'], findingIds: findings.map((f: any) => String(f.id)) }, evidenceRecords: { table: 'evidence_ledger', fields: ['id', 'provider', 'control_id', 'subject', 'source_url', 'observed_at', 'verification_method', 'status', 'severity', 'evidence_hash', 'limitation'], evidenceIds: evidence.map((e: any) => String(e.id)) }, observationRecords: { table: 'trust_observations', fields: ['id', 'observation_version', 'generated_at', 'previous_observation_id', 'evidence_ids', 'finding_ids', 'canonical_payload_hash', 'completeness_basis_points', 'open_finding_count', 'unknown_dimension_count'], observationIds: observations.map((o: any) => String(o.id)) } }, policy: { rule: 'The Experience Agent reports only records it can retrieve from the authenticated tenant scope. Missing evidence is UNKNOWN. It does not manufacture, infer, or silently alter trust.' } });
  } catch (error) { return next(error); }
}
