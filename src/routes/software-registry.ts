/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router, type Request, type Response } from 'express';
import { sql } from 'drizzle-orm';
import { attachTenantScope } from '../middleware/tenant-scope.ts';
import { FREE_REVIEW_TENANT_ID } from './free-review-submit.ts';

// Public, indexable software pages: /software and /software/:owner/:repo.
//
// Every page is built from a Free Review that actually COMPLETED (both the
// repository job and the security job finished) on a public GitHub
// repository. Nothing here is estimated: component counts come from the Syft
// SBOM the worker persisted, findings from scan_findings, evidence from
// evidence_items, and the commit and time from repository_scan_sources. A
// repository that has never been reviewed has no page -- there is no "0%
// verified, N signals" placeholder, because those numbers would be invented.
//
// Rendered as plain HTML on the server (not the SPA) so crawlers get the
// content without executing JavaScript.

const PUBLIC_ORIGIN = 'https://www.softwarepassportregistry.com';
const OWNER_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;

type Entry = {
  owner: string; repository: string; passportId: string; commitSha: string | null; acquiredAt: string | null; defaultBranch: string | null;
  componentCount: number | null; evidenceCount: number; findings: Record<string, number>; openFindings: number;
};

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

async function listCompleted(scopedDb: any, limit = 5000): Promise<Entry[]> {
  // Latest completed review per owner/repo. Both jobs must be Completed.
  const rows = (await scopedDb.execute(sql`
    WITH completed AS (
      SELECT s.repository_owner AS owner, s.repository_name AS repository, j.passport_id, s.resolved_commit_sha AS commit_sha, s.acquired_at, s.default_branch, j.created_at,
             ROW_NUMBER() OVER (PARTITION BY lower(s.repository_owner), lower(s.repository_name) ORDER BY j.created_at DESC) AS rn
      FROM agent_jobs j
      JOIN repository_scan_sources s ON s.job_id = j.id AND s.tenant_id = j.tenant_id
      WHERE j.tenant_id = ${FREE_REVIEW_TENANT_ID} AND j.job_type = 'repository_scan' AND j.status = 'Completed'
        AND EXISTS (SELECT 1 FROM agent_jobs sj WHERE sj.tenant_id = j.tenant_id AND sj.passport_id = j.passport_id AND sj.job_type = 'repository_security_scan' AND sj.status = 'Completed')
    )
    SELECT c.owner, c.repository, c.passport_id AS "passportId", c.commit_sha AS "commitSha", c.acquired_at AS "acquiredAt", c.default_branch AS "defaultBranch", p.sbom
    FROM completed c JOIN passports p ON p.id = c.passport_id AND p.tenant_id = ${FREE_REVIEW_TENANT_ID}
    WHERE c.rn = 1 ORDER BY c.acquired_at DESC NULLS LAST LIMIT ${limit}
  `) as any).rows ?? [];
  const entries: Entry[] = [];
  for (const row of rows) {
    let componentCount: number | null = null;
    try { const parsed = typeof row.sbom === 'string' ? JSON.parse(row.sbom) : row.sbom; componentCount = Array.isArray(parsed) ? parsed.length : null; } catch { componentCount = null; }
    entries.push({ owner: row.owner, repository: row.repository, passportId: row.passportId, commitSha: row.commitSha ?? null, acquiredAt: row.acquiredAt ? new Date(row.acquiredAt).toISOString() : null, defaultBranch: row.defaultBranch ?? null, componentCount, evidenceCount: 0, findings: {}, openFindings: 0 });
  }
  if (entries.length === 0) return entries;
  const ids = entries.map((e) => e.passportId);
  const findingRows = (await scopedDb.execute(sql`SELECT asset_id AS "passportId", lower(severity) AS severity, count(*)::int AS count FROM scan_findings WHERE tenant_id = ${FREE_REVIEW_TENANT_ID} AND asset_id IN ${ids} AND lower(status) NOT IN ('resolved','closed','verified') GROUP BY asset_id, lower(severity)`) as any).rows ?? [];
  const evidenceRows = (await scopedDb.execute(sql`SELECT asset_id AS "passportId", count(*)::int AS count FROM evidence_items WHERE tenant_id = ${FREE_REVIEW_TENANT_ID} AND asset_id IN ${ids} GROUP BY asset_id`) as any).rows ?? [];
  const byId = new Map(entries.map((e) => [e.passportId, e]));
  for (const f of findingRows) { const e = byId.get(f.passportId); if (!e) continue; e.findings[f.severity] = Number(f.count); e.openFindings += Number(f.count); }
  for (const ev of evidenceRows) { const e = byId.get(ev.passportId); if (e) e.evidenceCount = Number(ev.count); }
  return entries;
}

async function findingDetails(scopedDb: any, passportId: string, limit = 25) {
  return (await scopedDb.execute(sql`SELECT severity, category, title, component, fixed_version AS "fixedVersion", detected_at AS "detectedAt" FROM scan_findings WHERE tenant_id = ${FREE_REVIEW_TENANT_ID} AND asset_id = ${passportId} AND lower(status) NOT IN ('resolved','closed','verified') ORDER BY CASE lower(severity) WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END, detected_at DESC LIMIT ${limit}`) as any).rows ?? [];
}

const STYLE = `:root{--ink:#111A24;--muted:#5C6670;--line:#D9DED9;--bg:#F6F7F4;--surface:#fff;--accent:#1F5F7A;--crit:#9E2B25;--high:#B7791F;--ok:#2E7D4F}@media(prefers-color-scheme:dark){:root{--ink:#E6EAEE;--muted:#97A2AB;--line:#263038;--bg:#0F1519;--surface:#161E25;--accent:#6FB3D2;--crit:#F08A80;--high:#E0B25C;--ok:#6CC594}}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px 16px 64px}main{max-width:900px;margin:0 auto}h1{font-size:28px;margin:0 0 6px}h2{font-size:17px;margin:28px 0 8px}p{margin:0 0 8px}a{color:var(--accent)}.k{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:16px 0}.tile{background:var(--surface);border:1px solid var(--line);padding:12px 14px}.tile b{font-size:22px;font-variant-numeric:tabular-nums;display:block}table{width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--line);font-variant-numeric:tabular-nums}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);font-size:13px;vertical-align:top}th{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}.sev-critical{color:var(--crit);font-weight:600}.sev-high{color:var(--high);font-weight:600}.note{border:1px solid var(--line);background:var(--surface);padding:12px 14px;font-size:13px;color:var(--muted)}.cta{display:inline-block;margin-top:12px;padding:8px 14px;background:var(--accent);color:#fff;text-decoration:none;font-weight:600;font-size:14px}`;

function layout(title: string, description: string, canonical: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${escapeHtml(canonical)}"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><style>${STYLE}</style></head><body><main>${body}<p class="note" style="margin-top:32px">Software Passport Registry Ltd. Every number on this page was observed by SPR's own scan of the public repository at the commit shown; nothing is estimated or vendor-supplied. Absence of a finding is not proof of safety. <a href="${PUBLIC_ORIGIN}/terms">Terms</a> · <a href="${PUBLIC_ORIGIN}/privacy">Privacy</a></p></main></body></html>`;
}

export function createSoftwareRegistryRouter() {
  const router = Router();

  router.get('/sitemap.xml', async (_req: Request, res: Response, next) => {
    try {
      const scopedDb = await attachTenantScope(FREE_REVIEW_TENANT_ID, res);
      const entries = await listCompleted(scopedDb, 50000);
      // Server-rendered public pages live in this sitemap; the static
      // sitemap.xml is reserved for the prerendered SPA routes.
      const urls = [`${PUBLIC_ORIGIN}/software`, `${PUBLIC_ORIGIN}/whitepaper`, ...entries.map((e) => `${PUBLIC_ORIGIN}/software/${encodeURIComponent(e.owner)}/${encodeURIComponent(e.repository)}`)];
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${escapeHtml(u)}</loc></url>`).join('\n')}\n</urlset>\n`);
    } catch (error) { return next(error); }
  });

  router.get('/index.json', async (_req: Request, res: Response, next) => {
    try {
      const scopedDb = await attachTenantScope(FREE_REVIEW_TENANT_ID, res);
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.json({ generatedAt: new Date().toISOString(), entries: await listCompleted(scopedDb) });
    } catch (error) { return next(error); }
  });

  router.get('/', async (_req: Request, res: Response, next) => {
    try {
      const scopedDb = await attachTenantScope(FREE_REVIEW_TENANT_ID, res);
      const entries = await listCompleted(scopedDb, 2000);
      const rows = entries.map((e) => `<tr><td><a href="/software/${encodeURIComponent(e.owner)}/${encodeURIComponent(e.repository)}">${escapeHtml(e.owner)}/${escapeHtml(e.repository)}</a></td><td>${e.componentCount ?? '—'}</td><td>${e.openFindings}${e.findings.critical ? ` <span class="sev-critical">(${e.findings.critical} critical)</span>` : ''}${e.findings.high ? ` <span class="sev-high">(${e.findings.high} high)</span>` : ''}</td><td>${e.evidenceCount}</td><td>${e.acquiredAt ? escapeHtml(e.acquiredAt.slice(0, 10)) : '—'}</td></tr>`).join('');
      const body = `<p class="k">Software Passport Registry</p><h1>Observed software passports</h1><p>${entries.length} public repositories reviewed by SPR's own scanners: SBOM generated with Syft, dependency vulnerabilities checked against OSV, secrets and licences scanned. Each page shows exactly what was observed at a specific commit.</p><a class="cta" href="${PUBLIC_ORIGIN}/free-review">Review a public repository free</a><h2>All reviewed software</h2><table><thead><tr><th>Repository</th><th>SBOM components</th><th>Open findings</th><th>Evidence items</th><th>Reviewed</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No completed reviews yet.</td></tr>'}</tbody></table>`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.send(layout('Observed software passports — Software Passport Registry', `${entries.length} public repositories reviewed with real SBOM, vulnerability and evidence data.`, `${PUBLIC_ORIGIN}/software`, body));
    } catch (error) { return next(error); }
  });

  router.get('/:owner/:repository', async (req: Request, res: Response, next) => {
    try {
      const owner = String(req.params.owner ?? ''); const repository = String(req.params.repository ?? '');
      if (!OWNER_PATTERN.test(owner) || !OWNER_PATTERN.test(repository)) return res.status(404).send('Not found');
      const scopedDb = await attachTenantScope(FREE_REVIEW_TENANT_ID, res);
      const entries = await listCompleted(scopedDb, 50000);
      const entry = entries.find((e) => e.owner.toLowerCase() === owner.toLowerCase() && e.repository.toLowerCase() === repository.toLowerCase());
      if (!entry) { res.setHeader('Cache-Control', 'no-store'); return res.status(404).send(layout('Not reviewed — Software Passport Registry', 'No completed review exists for this repository.', `${PUBLIC_ORIGIN}/software`, `<p class="k">Software Passport Registry</p><h1>${escapeHtml(owner)}/${escapeHtml(repository)}</h1><p>SPR has not completed a review of this repository, so there is nothing to show. No score or estimate is substituted.</p><a class="cta" href="${PUBLIC_ORIGIN}/free-review">Run a free review</a>`)); }
      const findings = await findingDetails(scopedDb, entry.passportId);
      const sev = (s: string) => entry.findings[s] ?? 0;
      const findingRows = findings.map((f: any) => `<tr><td class="sev-${escapeHtml(String(f.severity).toLowerCase())}">${escapeHtml(String(f.severity).toUpperCase())}</td><td>${escapeHtml(f.title)}</td><td>${escapeHtml(f.component ?? '')}</td><td>${escapeHtml(f.fixedVersion ?? '')}</td></tr>`).join('');
      const name = `${entry.owner}/${entry.repository}`;
      const desc = `SPR observed ${entry.componentCount ?? 'an unknown number of'} SBOM components, ${entry.openFindings} open findings (${sev('critical')} critical, ${sev('high')} high) and ${entry.evidenceCount} evidence items for ${name} at commit ${entry.commitSha ? entry.commitSha.slice(0, 7) : 'n/a'}.`;
      const body = `<p class="k">Software Passport · public repository</p><h1>${escapeHtml(name)}</h1><p>Observed by SPR on ${entry.acquiredAt ? escapeHtml(entry.acquiredAt.slice(0, 10)) : 'an unknown date'} at commit <code>${escapeHtml(entry.commitSha ?? 'n/a')}</code>${entry.defaultBranch ? ` (${escapeHtml(entry.defaultBranch)})` : ''}. Source: <a rel="nofollow" href="https://github.com/${escapeHtml(entry.owner)}/${escapeHtml(entry.repository)}">github.com/${escapeHtml(name)}</a>.</p>
<div class="grid"><div class="tile"><span class="k">SBOM components</span><b>${entry.componentCount ?? '—'}</b></div><div class="tile"><span class="k">Open findings</span><b>${entry.openFindings}</b></div><div class="tile"><span class="k">Critical / high</span><b>${sev('critical')} / ${sev('high')}</b></div><div class="tile"><span class="k">Evidence items</span><b>${entry.evidenceCount}</b></div></div>
<h2>What was observed</h2><p>Syft generated the software bill of materials from the repository's manifests; each component was checked against the OSV vulnerability database; the tree was scanned for secrets, infrastructure-as-code issues and licence signals. Vendor-supplied attestations: none — this page contains only independent observation.</p>
<h2>Open findings${findings.length < entry.openFindings ? ` (top ${findings.length} of ${entry.openFindings})` : ''}</h2>${findingRows ? `<table><thead><tr><th>Severity</th><th>Finding</th><th>Component</th><th>Fixed in</th></tr></thead><tbody>${findingRows}</tbody></table>` : '<p class="note">No open findings were recorded by the scanners at this commit. That is a statement about what the scanners observed, not a guarantee.</p>'}
<h2>Get the full passport</h2><p>Continuous verification, evidence ledger, plain-English and auditor reports, and a shareable signed passport are available to SPR customers.</p><a class="cta" href="${PUBLIC_ORIGIN}/pricing">See plans</a> &nbsp; <a class="cta" style="background:transparent;color:var(--accent);border:1px solid var(--accent)" href="${PUBLIC_ORIGIN}/free-review">Review your own repository free</a>`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=600');
      return res.send(layout(`${name} — software passport, SBOM and vulnerabilities`, desc, `${PUBLIC_ORIGIN}/software/${encodeURIComponent(entry.owner)}/${encodeURIComponent(entry.repository)}`, body));
    } catch (error) { return next(error); }
  });

  return router;
}
