import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth, type AuthenticatedRequest } from '../middleware/security.ts';

const commandInput = z.object({
  input: z.string().trim().min(1).max(500),
  context: z.object({ path: z.string().max(500).optional() }).optional(),
}).strict();

type Intent = 'help' | 'summary' | 'client_risk' | 'passport' | 'vendor_risk' | 'navigation' | 'unsupported';

export function createExperienceAgentRouter() {
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

      if (/what can you do|help|how do you work/.test(q)) {
        return res.json({
          schemaVersion: 'spr-experience-agent-v1', intent: 'help' satisfies Intent,
          reply: 'I can summarize your SPR environment, find the highest-risk observed software, inspect a passport, review vendor risk, and take you to the right workspace. I only use tenant-scoped observed data and never invent or silently change trust decisions.',
          actions: [
            { label: 'Show my risk', command: 'What is my biggest risk today?' },
            { label: 'Show clients', path: '/clients' },
            { label: 'Show passports', path: '/passports' },
            { label: 'Show vendor risk', path: '/vendors' },
          ],
        });
      }

      const nav = navigationIntent(q);
      if (nav) return res.json({ schemaVersion: 'spr-experience-agent-v1', intent: 'navigation' satisfies Intent, ...nav });

      if (/biggest risk|highest risk|most risky|risk today|what should i (do|work on)|priority|priorities|overview|summary|how are we doing/.test(q)) {
        const summary = await getRiskSummary(db, tenantId);
        return res.json({ schemaVersion: 'spr-experience-agent-v1', intent: 'summary' satisfies Intent, reply: summary.reply, data: summary.data });
      }

      const passportMatch = q.match(/(?:why did|explain|show|inspect|check|assess|verify)\s+(?:the\s+)?(?:passport|software)\s*[:#-]?\s*(.+)$/i)
        || q.match(/(?:verify|check|assess)\s+(.+)$/i);
      if (passportMatch && passportMatch[1].trim()) {
        const query = passportMatch[1].trim();
        return res.json({
          schemaVersion: 'spr-experience-agent-v1', intent: 'passport' satisfies Intent,
          action: { type: 'verify', endpoint: '/api/agent/v1/verify-software', payload: { query } },
          reply: `I’ll verify “${query}” against the observed evidence in your workspace.`,
        });
      }

      if (/vendor|third.?party/.test(q) && /risk|review|check|assess/.test(q)) {
        return res.json({ schemaVersion: 'spr-experience-agent-v1', intent: 'vendor_risk' satisfies Intent, path: '/vendors', reply: 'Opening Vendor Risk. I can review the observed evidence and findings there.' });
      }

      return res.json({
        schemaVersion: 'spr-experience-agent-v1', intent: 'unsupported' satisfies Intent,
        reply: 'I don’t have a safe wired action for that request yet. I can summarize observed risk, inspect or verify software, review vendor risk, or open an SPR workspace.',
        actions: [
          { label: 'Risk summary', command: 'What is my biggest risk today?' },
          { label: 'Verify software', command: 'Verify software: ' },
          { label: 'Open Command Center', path: '/dashboard' },
        ],
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

function navigationIntent(q: string): { path: string; reply: string } | null {
  const routes: Array<[RegExp, string, string]> = [
    [/command center|dashboard|home/, '/dashboard', 'Opening the Command Center.'],
    [/clients?|customer list|client management/, '/clients', 'Opening Clients.'],
    [/passports?|registry|software inventory/, '/passports', 'Opening Passports.'],
    [/vendors?|third.?party risk/, '/vendors', 'Opening Vendor Risk.'],
    [/monitoring|alerts?/, '/monitoring', 'Opening Monitoring.'],
    [/compliance|governance/, '/compliance', 'Opening Compliance.'],
    [/reports?/, '/reports', 'Opening Reports.'],
    [/billing|subscription|plan/, '/billing', 'Opening Billing.'],
    [/settings?/, '/settings', 'Opening Settings.'],
  ];
  if (/what|which|show|tell|find|why|how|verify|check|assess|risk|priority/.test(q)) return null;
  for (const [pattern, path, reply] of routes) if (pattern.test(q)) return { path, reply };
  return null;
}

async function getRiskSummary(db: any, tenantId: string) {
  const [clients, passports, findings, alerts] = await Promise.all([
    db.execute(sql`SELECT COUNT(*)::int AS count FROM clients WHERE tenant_id=${tenantId}`),
    db.execute(sql`SELECT COUNT(*)::int AS count FROM passports WHERE tenant_id=${tenantId}`),
    db.execute(sql`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE LOWER(severity) IN ('critical','high') AND LOWER(status) NOT IN ('resolved','closed','verified'))::int AS critical_high, COUNT(*) FILTER (WHERE LOWER(status) NOT IN ('resolved','closed','verified'))::int AS open FROM trust_findings WHERE tenant_id=${tenantId}`),
    db.execute(sql`SELECT COUNT(*) FILTER (WHERE LOWER(status) NOT IN ('resolved','closed'))::int AS active FROM alerts WHERE tenant_id=${tenantId}`),
  ]);

  const top = (await db.execute(sql`
    SELECT p.id AS passport_id, p.name, p.client_id,
      COUNT(f.id)::int AS open_findings,
      COUNT(f.id) FILTER (WHERE LOWER(f.severity) IN ('critical','high'))::int AS critical_high
    FROM passports p
    LEFT JOIN trust_findings f ON f.passport_id=p.id AND f.tenant_id=${tenantId}
      AND LOWER(f.status) NOT IN ('resolved','closed','verified')
    WHERE p.tenant_id=${tenantId}
    GROUP BY p.id,p.name,p.client_id
    ORDER BY critical_high DESC, open_findings DESC, p.name ASC
    LIMIT 10
  `) as any).rows || [];

  const clientRows = (await db.execute(sql`
    SELECT id,name,risk_level,critical_risks_count,passport_count
    FROM clients WHERE tenant_id=${tenantId}
    ORDER BY critical_risks_count DESC, passport_count DESC, name ASC
    LIMIT 10
  `) as any).rows || [];

  const c = (clients as any).rows?.[0]?.count ?? 0;
  const p = (passports as any).rows?.[0]?.count ?? 0;
  const f = (findings as any).rows?.[0] ?? {};
  const a = (alerts as any).rows?.[0]?.active ?? 0;
  return {
    reply: `I found ${c} client(s), ${p} passport(s), ${f.open ?? 0} open finding(s), ${f.critical_high ?? 0} critical/high open finding(s), and ${a} active alert(s). The highest-priority observed items are listed below.`,
    data: { counts: { clients: c, passports: p, openFindings: f.open ?? 0, criticalHighFindings: f.critical_high ?? 0, activeAlerts: a }, topPassports: top, topClients: clientRows },
  };
}
