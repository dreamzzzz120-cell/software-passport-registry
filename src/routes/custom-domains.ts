/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * White-label custom domains: serve a tenant's workspace from its own
 * hostname.
 *
 * How it actually works, end to end:
 *   1. Owner adds a hostname. It is registered on the Vercel project that
 *      serves the app (src/lib/server/vercel-domains.ts) and stored with the
 *      DNS records Vercel requires. Status: pending_dns.
 *   2. The customer creates those records. "Verify" asks Vercel whether the
 *      domain is verified and correctly configured; only Vercel's answer
 *      moves status to active, and the answer's time is recorded.
 *   3. On activation the hostname is added to Firebase Authentication's
 *      authorized domains so sign-in works there. If that call fails the
 *      domain still serves pages but sign_in_enabled stays false and the
 *      error is shown -- never silently assumed.
 *   4. The SPA, when loaded on a hostname that is not SPR's own, asks
 *      GET /api/public/branding/by-host for that host's tenant branding and
 *      applies it before the sign-in page renders.
 *
 * Everything is gated on the white_label capability, same as the branding
 * editor, and on the hosting provider actually being configured.
 */

import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import rateLimit from 'express-rate-limit';
import { db } from '../db/index.ts';
import { AuthenticatedRequest, requireAuth, requireRole, rateLimiter } from '../middleware/security.ts';
import { enforceCapability } from '../security/entitlements.ts';
import { appendAuditEntry } from '../security/audit-log.ts';
import { addAuthorizedDomain, removeAuthorizedDomain } from '../lib/firebase-admin.ts';
import { addProjectDomain, dnsInstructions, getDomainConfig, getProjectDomain, isVercelDomainsConfigured, removeProjectDomain, verifyProjectDomain, VercelApiError } from '../lib/server/vercel-domains.ts';
import { THEME_COLOR_KEYS, type BrandingTheme } from '../lib/brandingTheme.ts';

/** Hostnames SPR itself answers on; a tenant cannot claim these. */
export const RESERVED_HOST_SUFFIXES = ['softwarepassportregistry.com', 'vercel.app', 'railway.app', 'firebaseapp.com', 'web.app', 'localhost'];

const HOSTNAME = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function normalizeHostname(input: string): string | null {
  const hostname = input.trim().toLowerCase().replace(/\.$/, '');
  if (!HOSTNAME.test(hostname)) return null;
  if (RESERVED_HOST_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))) return null;
  return hostname;
}

const addSchema = z.object({ hostname: z.string().trim().min(4).max(253) }).strict();
const domainLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, validate: { trustProxy: false } });
const hostLookupLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false, validate: { trustProxy: false } });

const COLUMNS = sql`id, hostname, status, verification_json AS "dnsRecords", sign_in_enabled AS "signInEnabled", sign_in_error AS "signInError", last_checked_at AS "lastCheckedAt", last_error AS "lastError", activated_at AS "activatedAt", created_at AS "createdAt"`;

function providerError(error: unknown): { status: number; body: { error: string; message: string } } {
  if (error instanceof VercelApiError) return { status: error.status === 503 ? 503 : 502, body: { error: `HOSTING_PROVIDER_${error.code}`, message: error.message } };
  return { status: 502, body: { error: 'HOSTING_PROVIDER_ERROR', message: error instanceof Error ? error.message : 'The hosting provider request failed.' } };
}

/**
 * The subset of a tenant's branding that is safe to hand to an anonymous
 * visitor on the tenant's own hostname: display packaging only. No
 * identifiers, no evidence, no counts.
 */
export function publicBrandingView(row: { companyName: string | null; brandColor: string | null; logoDataUrl: string | null; theme: BrandingTheme | null }) {
  const theme = row.theme ?? {};
  const palette = (mode: 'light' | 'dark') => {
    const source = theme.colors?.[mode] ?? {};
    const out: Record<string, string> = {};
    for (const key of THEME_COLOR_KEYS) { const v = source[key]; if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) out[key] = v; }
    return out;
  };
  return {
    companyName: row.companyName, brandColor: row.brandColor, logoDataUrl: row.logoDataUrl,
    theme: {
      productName: theme.productName ?? null, tagline: theme.tagline ?? null, fontId: theme.fontId ?? null, radius: theme.radius ?? null,
      defaultMode: theme.defaultMode ?? null, colors: { light: palette('light'), dark: palette('dark') }, faviconDataUrl: theme.faviconDataUrl ?? null,
      supportEmail: theme.supportEmail ?? null, supportUrl: theme.supportUrl ?? null, footerText: theme.footerText ?? null, hideSprAttribution: theme.hideSprAttribution === true,
    },
  };
}

export function createCustomDomainsRouter() {
  const router = Router();

  router.get('/organization/domains', domainLimiter, requireAuth, requireRole(['Owner', 'Admin']), rateLimiter, async (req: AuthenticatedRequest, res, next) => {
    try {
      const rows = (await req.db!.execute(sql`SELECT ${COLUMNS} FROM tenant_custom_domains WHERE tenant_id = ${req.user!.tenantId} ORDER BY created_at ASC`) as any).rows ?? [];
      return res.json({ configured: isVercelDomainsConfigured(), domains: rows });
    } catch (error) { return next(error); }
  });

  router.post('/organization/domains', domainLimiter, requireAuth, requireRole('Owner'), rateLimiter, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!(await enforceCapability(req, res, 'white_label'))) return;
      if (!isVercelDomainsConfigured()) return res.status(503).json({ error: 'CUSTOM_DOMAINS_NOT_CONFIGURED', message: 'This deployment has no hosting-provider credentials (VERCEL_API_TOKEN, VERCEL_PROJECT_ID), so a custom domain cannot be registered. Nothing was saved.' });
      const parsed = addSchema.safeParse(req.body);
      const hostname = parsed.success ? normalizeHostname(parsed.data.hostname) : null;
      if (!hostname) return res.status(400).json({ error: 'INVALID_HOSTNAME', message: 'Enter a fully-qualified hostname you control, such as trust.example.com. SPR’s own domains and hosting-provider domains cannot be used.' });
      const tenantId = req.user!.tenantId;
      // Uniqueness is global, not per tenant: checked on the owner connection
      // because another tenant's row is invisible through RLS.
      const taken = (await db.execute(sql`SELECT tenant_id AS "tenantId" FROM tenant_custom_domains WHERE lower(hostname) = ${hostname} LIMIT 1`) as any).rows?.[0];
      if (taken) return res.status(409).json({ error: 'HOSTNAME_IN_USE', message: taken.tenantId === tenantId ? 'This hostname is already added to your workspace.' : 'This hostname is already in use.' });

      let domain;
      try { domain = await addProjectDomain(hostname); } catch (error) {
        const { status, body } = providerError(error);
        return res.status(status).json(body);
      }
      const records = dnsInstructions(hostname, domain);
      const id = `domain_${crypto.randomUUID().replace(/-/g, '')}`;
      await req.db!.execute(sql`
        INSERT INTO tenant_custom_domains (id, tenant_id, hostname, status, verification_json, created_by, last_checked_at)
        VALUES (${id}, ${tenantId}, ${hostname}, 'pending_dns', ${JSON.stringify(records)}::jsonb, ${req.user!.email}, CURRENT_TIMESTAMP)
      `);
      await appendAuditEntry(req.db!, { tenantId, action: 'custom_domain.added', actor: req.user!.email, payload: { hostname } });
      const row = (await req.db!.execute(sql`SELECT ${COLUMNS} FROM tenant_custom_domains WHERE id = ${id}`) as any).rows?.[0];
      return res.status(201).json({ domain: row });
    } catch (error) { return next(error); }
  });

  router.post('/organization/domains/:id/verify', domainLimiter, requireAuth, requireRole(['Owner', 'Admin']), rateLimiter, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!isVercelDomainsConfigured()) return res.status(503).json({ error: 'CUSTOM_DOMAINS_NOT_CONFIGURED', message: 'Hosting-provider credentials are not configured on this deployment.' });
      const tenantId = req.user!.tenantId;
      const id = String(req.params.id ?? '');
      const row = (await req.db!.execute(sql`SELECT id, hostname, status, sign_in_enabled AS "signInEnabled" FROM tenant_custom_domains WHERE id = ${id} AND tenant_id = ${tenantId} LIMIT 1`) as any).rows?.[0];
      if (!row) return res.status(404).json({ error: 'DOMAIN_NOT_FOUND' });
      const hostname: string = row.hostname;

      let verified = false; let misconfigured = true; let records: unknown = null; let lastError: string | null = null;
      try {
        const current = await getProjectDomain(hostname);
        const afterVerify = current.verified ? current : await verifyProjectDomain(hostname);
        const cfg = await getDomainConfig(hostname);
        verified = afterVerify.verified === true;
        misconfigured = cfg.misconfigured !== false;
        records = dnsInstructions(hostname, afterVerify);
      } catch (error) {
        lastError = error instanceof VercelApiError ? `${error.code}: ${error.message}` : (error instanceof Error ? error.message : 'provider request failed');
      }

      const active = verified && !misconfigured && !lastError;
      let signInEnabled: boolean = row.signInEnabled === true;
      let signInError: string | null = null;
      if (active && !signInEnabled) {
        try { await addAuthorizedDomain(hostname); signInEnabled = true; } catch (error) {
          signInError = error instanceof Error ? error.message.slice(0, 500) : 'identity provider update failed';
        }
      }
      const status = lastError ? 'error' : active ? 'active' : 'pending_dns';
      await req.db!.execute(sql`
        UPDATE tenant_custom_domains SET
          status = ${status},
          verification_json = COALESCE(${records ? JSON.stringify(records) : null}::jsonb, verification_json),
          sign_in_enabled = ${signInEnabled}, sign_in_error = ${signInError},
          last_checked_at = CURRENT_TIMESTAMP, last_error = ${lastError},
          activated_at = CASE WHEN ${active} AND activated_at IS NULL THEN CURRENT_TIMESTAMP ELSE activated_at END,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ${id} AND tenant_id = ${tenantId}
      `);
      if (active && row.status !== 'active') await appendAuditEntry(req.db!, { tenantId, action: 'custom_domain.activated', actor: req.user!.email, payload: { hostname, signInEnabled } });
      const updated = (await req.db!.execute(sql`SELECT ${COLUMNS} FROM tenant_custom_domains WHERE id = ${id}`) as any).rows?.[0];
      return res.json({ domain: updated, provider: { verified, misconfigured } });
    } catch (error) { return next(error); }
  });

  router.delete('/organization/domains/:id', domainLimiter, requireAuth, requireRole('Owner'), rateLimiter, async (req: AuthenticatedRequest, res, next) => {
    try {
      const tenantId = req.user!.tenantId;
      const id = String(req.params.id ?? '');
      const row = (await req.db!.execute(sql`SELECT id, hostname, sign_in_enabled AS "signInEnabled" FROM tenant_custom_domains WHERE id = ${id} AND tenant_id = ${tenantId} LIMIT 1`) as any).rows?.[0];
      if (!row) return res.status(404).json({ error: 'DOMAIN_NOT_FOUND' });
      const warnings: string[] = [];
      if (isVercelDomainsConfigured()) {
        try { await removeProjectDomain(row.hostname); } catch (error) { warnings.push(`Hosting provider: ${error instanceof Error ? error.message : 'removal failed'}`); }
      } else {
        warnings.push('Hosting provider is not configured on this deployment; the hostname was not removed there.');
      }
      if (row.signInEnabled) {
        try { await removeAuthorizedDomain(row.hostname); } catch (error) { warnings.push(`Identity provider: ${error instanceof Error ? error.message : 'removal failed'}`); }
      }
      await req.db!.execute(sql`DELETE FROM tenant_custom_domains WHERE id = ${id} AND tenant_id = ${tenantId}`);
      await appendAuditEntry(req.db!, { tenantId, action: 'custom_domain.removed', actor: req.user!.email, payload: { hostname: row.hostname, warnings } });
      return res.json({ removed: true, hostname: row.hostname, warnings });
    } catch (error) { return next(error); }
  });

  // Anonymous, by hostname: which tenant's branding should this host show?
  // Only active domains answer; everything else is a plain 404 so the host
  // list cannot be probed for pending entries.
  router.get('/public/branding/by-host', hostLookupLimiter, async (req, res, next) => {
    try {
      const host = typeof req.query.host === 'string' ? normalizeHostname(req.query.host) : null;
      if (!host) return res.status(404).json({ error: 'NOT_FOUND' });
      const domain = (await db.execute(sql`SELECT tenant_id AS "tenantId" FROM tenant_custom_domains WHERE lower(hostname) = ${host} AND status = 'active' LIMIT 1`) as any).rows?.[0];
      if (!domain) { res.setHeader('Cache-Control', 'public, max-age=60'); return res.status(404).json({ error: 'NOT_FOUND' }); }
      const branding = (await db.execute(sql`SELECT company_name AS "companyName", brand_color AS "brandColor", logo_data_url AS "logoDataUrl", theme FROM tenant_branding WHERE tenant_id = ${domain.tenantId} LIMIT 1`) as any).rows?.[0];
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.json({ host, branding: publicBrandingView(branding ?? { companyName: null, brandColor: null, logoDataUrl: null, theme: {} }) });
    } catch (error) { return next(error); }
  });

  return router;
}
