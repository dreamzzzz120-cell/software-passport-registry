/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Backend for the public company pages and the Data Processing Agreement.
 *
 *  - POST /api/public/contact              the /contact/ form. Stores the
 *    message, then forwards it to the founder mailbox. The response says
 *    which of those two things actually happened.
 *  - GET  /api/public/subprocessors        the subprocessor list plus, for
 *    each optional provider, whether it is configured on THIS deployment.
 *  - GET  /api/public/dpa                  the current document, version and
 *    canonical SHA-256.
 *  - GET  /api/public/dpa/verify/:id/:sig  verifies a signed execution.
 *  - GET  /api/organization/dpa            this tenant's current execution.
 *  - POST /api/organization/dpa/execute    Owner accepts the current version.
 *  - GET  /api/founder/contact-inquiries   founder reads what came in.
 *  - GET  /api/public/branding/logo/:tenantId/:token
 *        a tenant's saved logo as an image, for branded email. The token is
 *        an HMAC of the tenant id (see brandingLogoToken), so the route
 *        cannot be used to enumerate tenants.
 */

import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import rateLimit from 'express-rate-limit';
import { config } from '../config.ts';
import { db } from '../db/index.ts';
import { attachTenantScope } from '../middleware/tenant-scope.ts';
import { AuthenticatedRequest, requireAuth, requireRole, requireFounder, rateLimiter } from '../middleware/security.ts';
import { isEmailProviderConfigured, sendEmailDirect } from '../lib/email.ts';
import { appendAuditEntry } from '../security/audit-log.ts';
import { SUBPROCESSORS, SUBPROCESSORS_LAST_UPDATED } from '../legal/subprocessors.ts';
import { DPA_VERSION, DPA_EFFECTIVE_DATE, dpaCanonicalText } from '../legal/dpa-document.ts';
import { FREE_REVIEW_TENANT_ID } from './free-review-submit.ts';
import { brandingLogoToken } from '../lib/branded-email.ts';

const PUBLIC_ORIGIN = 'https://www.softwarepassportregistry.com';

export const CONTACT_TOPICS = ['product', 'security', 'partnership', 'msp_pilot', 'privacy', 'other'] as const;

const contactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  company: z.string().trim().max(160).optional(),
  topic: z.enum(CONTACT_TOPICS),
  message: z.string().trim().min(10).max(4000),
  // Honeypot: real browsers leave it empty; bots that fill every field
  // are recorded nowhere and told nothing.
  website: z.string().max(0).optional(),
}).strict();

const executeSchema = z.object({
  customerLegalName: z.string().trim().min(2).max(200),
  signatoryName: z.string().trim().min(2).max(120),
  signatoryTitle: z.string().trim().min(2).max(120),
  accept: z.literal(true),
}).strict();

const contactLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, validate: { trustProxy: false } });
const verifyLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, validate: { trustProxy: false } });

function id(prefix: string) { return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`; }
function hashIp(req: { ip?: string; socket: { remoteAddress?: string } }) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  return crypto.createHmac('sha256', config.publicPassport.secret || 'insecure-dev-only-key').update(ip).digest('hex');
}

/**
 * Key used to sign DPA execution records. An explicit
 * SPR_DOCUMENT_SIGNING_SECRET wins; otherwise the key is derived from the
 * production public-passport secret with HKDF under its own info string, so
 * the two purposes can never produce interchangeable signatures. Returns
 * null when neither secret exists (development without configuration), and
 * every signing endpoint then refuses rather than signing with a default.
 */
export function documentSigningKey(): Buffer | null {
  const explicit = config.documentSigning.secret;
  if (explicit && explicit.length >= 32) return Buffer.from(explicit, 'utf8');
  const master = config.publicPassport.secret;
  if (!master || master.length < 32) return null;
  return Buffer.from(crypto.hkdfSync('sha256', master, 'spr-document-signing', 'spr-dpa-execution-v1', 32));
}

export function dpaDocumentSha256(): string {
  return crypto.createHash('sha256').update(dpaCanonicalText(), 'utf8').digest('hex');
}

export interface DpaExecutionRecord {
  id: string; tenantId: string; documentVersion: string; documentSha256: string; customerLegalName: string;
  signatoryName: string; signatoryTitle: string; signatoryEmail: string; executedAt: string;
}

/** The exact bytes the signature covers. Field order is part of the contract. */
export function dpaSignaturePayload(record: DpaExecutionRecord): string {
  return [record.id, record.tenantId, record.documentVersion, record.documentSha256, record.customerLegalName, record.signatoryName, record.signatoryTitle, record.signatoryEmail, record.executedAt].join('\n');
}

export function signDpaExecution(record: DpaExecutionRecord, secret: string | Buffer): string {
  return crypto.createHmac('sha256', secret).update(dpaSignaturePayload(record), 'utf8').digest('hex');
}

export function verifyDpaSignature(record: DpaExecutionRecord, signature: string, secret: string | Buffer): boolean {
  if (!/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = Buffer.from(signDpaExecution(record, secret), 'hex');
  const given = Buffer.from(signature, 'hex');
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

function rowToRecord(row: any): DpaExecutionRecord {
  return {
    id: row.id, tenantId: row.tenantId, documentVersion: row.documentVersion, documentSha256: row.documentSha256,
    customerLegalName: row.customerLegalName, signatoryName: row.signatoryName, signatoryTitle: row.signatoryTitle,
    signatoryEmail: row.signatoryEmail, executedAt: new Date(row.executedAt).toISOString(),
  };
}

const EXECUTION_COLUMNS = sql`id, tenant_id AS "tenantId", document_version AS "documentVersion", document_sha256 AS "documentSha256", customer_legal_name AS "customerLegalName", signatory_name AS "signatoryName", signatory_title AS "signatoryTitle", signatory_email AS "signatoryEmail", executed_at AS "executedAt", signature`;

function publicView(record: DpaExecutionRecord, signature: string, current: boolean) {
  // tenantId stays server-side: it is an internal identifier and the
  // verification page has no use for it.
  const { tenantId: _tenantId, ...rest } = record;
  return { ...rest, signature, isCurrentVersion: current, verifyUrl: `${PUBLIC_ORIGIN}/dpa/verify/${encodeURIComponent(record.id)}/${signature}` };
}

export function createPublicPagesRouter() {
  const router = Router();

  router.post('/public/contact', contactLimiter, async (req, res, next) => {
    try {
      const parsed = contactSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Name, a valid email address, a topic and a message of at least 10 characters are required.', details: parsed.error.flatten() });
      const body = parsed.data;
      const inquiryId = id('inquiry');
      const scopedDb = await attachTenantScope(FREE_REVIEW_TENANT_ID, res);
      const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 512) : null;
      await scopedDb.execute(sql`
        INSERT INTO contact_inquiries (id, tenant_id, name, email, company, topic, message, ip_hash, user_agent)
        VALUES (${inquiryId}, ${FREE_REVIEW_TENANT_ID}, ${body.name}, ${body.email}, ${body.company ?? null}, ${body.topic}, ${body.message}, ${hashIp(req)}, ${userAgent})
      `);

      // Forward to the founder mailbox. Failure here is recorded on the row and
      // reported to the visitor as "stored, not yet forwarded" -- never as sent.
      let forwarded = false;
      const recipients = config.founder.emails.length ? config.founder.emails : [config.fulfilmentEmail];
      if (isEmailProviderConfigured()) {
        try {
          const text = [
            `New contact inquiry (${body.topic}) — ${inquiryId}`,
            '',
            `From: ${body.name} <${body.email}>${body.company ? ` at ${body.company}` : ''}`,
            '',
            body.message,
            '',
            'Reply directly to the sender. This message was stored in contact_inquiries and forwarded by SPR.',
          ].join('\n');
          for (const recipient of recipients) await sendEmailDirect(recipient, `[SPR contact] ${body.topic}: ${body.name}`, text);
          forwarded = true;
          await scopedDb.execute(sql`UPDATE contact_inquiries SET forwarded_at = CURRENT_TIMESTAMP WHERE id = ${inquiryId}`);
        } catch (error) {
          const message = error instanceof Error ? error.message.slice(0, 500) : 'unknown';
          await scopedDb.execute(sql`UPDATE contact_inquiries SET forward_error = ${message} WHERE id = ${inquiryId}`);
          console.error('[SPR] contact forward failed', inquiryId, message);
        }
      } else {
        await scopedDb.execute(sql`UPDATE contact_inquiries SET forward_error = 'EMAIL_PROVIDER_NOT_CONFIGURED' WHERE id = ${inquiryId}`);
      }
      return res.status(201).json({ id: inquiryId, stored: true, forwarded });
    } catch (error) { return next(error); }
  });

  router.get('/public/subprocessors', async (_req, res) => {
    const configured: Record<string, boolean> = {
      SENTRY_DSN: Boolean(config.sentry.dsn),
      ANTHROPIC_API_KEY: Boolean(config.anthropic.apiKey),
      GEMINI_API_KEY: Boolean(config.gemini.apiKey),
    };
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.json({
      lastUpdated: SUBPROCESSORS_LAST_UPDATED,
      subprocessors: SUBPROCESSORS.map((s) => ({ ...s, configured: s.optional ? Boolean(s.enabledBy && configured[s.enabledBy]) : true })),
    });
  });

  router.get('/public/dpa', async (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.json({ version: DPA_VERSION, effectiveDate: DPA_EFFECTIVE_DATE, sha256: dpaDocumentSha256(), executionEnabled: documentSigningKey() !== null });
  });

  router.get('/public/dpa/verify/:id/:signature', verifyLimiter, async (req, res, next) => {
    try {
      const secret = documentSigningKey();
      if (!secret) return res.status(503).json({ error: 'DPA_SIGNING_NOT_CONFIGURED', message: 'No document-signing key is configured on this deployment; executions cannot be verified.' });
      const executionId = String(req.params.id ?? '');
      const signature = String(req.params.signature ?? '');
      if (!/^dpa_[0-9a-f]{32}$/.test(executionId) || !/^[0-9a-f]{64}$/.test(signature)) return res.status(404).json({ verified: false, error: 'NOT_FOUND' });
      // Looked up by primary key on the owner connection: the id alone
      // identifies nothing, and the signature check below decides disclosure.
      const row = (await db.execute(sql`SELECT ${EXECUTION_COLUMNS} FROM tenant_dpa_executions WHERE id = ${executionId} LIMIT 1`) as any).rows?.[0];
      if (!row) return res.status(404).json({ verified: false, error: 'NOT_FOUND' });
      const record = rowToRecord(row);
      if (!verifyDpaSignature(record, signature, secret) || row.signature !== signature) return res.status(404).json({ verified: false, error: 'NOT_FOUND' });
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ verified: true, execution: publicView(record, signature, record.documentVersion === DPA_VERSION), currentVersion: DPA_VERSION });
    } catch (error) { return next(error); }
  });

  router.get('/organization/dpa', requireAuth, rateLimiter, async (req: AuthenticatedRequest, res, next) => {
    try {
      const row = (await req.db!.execute(sql`SELECT ${EXECUTION_COLUMNS} FROM tenant_dpa_executions WHERE tenant_id = ${req.user!.tenantId} ORDER BY executed_at DESC LIMIT 1`) as any).rows?.[0];
      const current = { version: DPA_VERSION, effectiveDate: DPA_EFFECTIVE_DATE, sha256: dpaDocumentSha256() };
      if (!row) return res.json({ current, execution: null, executionEnabled: documentSigningKey() !== null });
      const record = rowToRecord(row);
      return res.json({ current, execution: publicView(record, row.signature, record.documentVersion === DPA_VERSION), executionEnabled: documentSigningKey() !== null });
    } catch (error) { return next(error); }
  });

  router.post('/organization/dpa/execute', requireAuth, requireRole('Owner'), rateLimiter, async (req: AuthenticatedRequest, res, next) => {
    try {
      const secret = documentSigningKey();
      if (!secret) return res.status(503).json({ error: 'DPA_SIGNING_NOT_CONFIGURED', message: 'No document-signing key is configured on this deployment, so an execution could not be signed. Nothing was recorded.' });
      const parsed = executeSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Customer legal name, signatory name and title, and explicit acceptance are required.', details: parsed.error.flatten() });
      const tenantId = req.user!.tenantId;
      const existing = (await req.db!.execute(sql`SELECT id FROM tenant_dpa_executions WHERE tenant_id = ${tenantId} AND document_version = ${DPA_VERSION} LIMIT 1`) as any).rows?.[0];
      if (existing) return res.status(409).json({ error: 'DPA_ALREADY_EXECUTED', message: `Version ${DPA_VERSION} has already been executed for this workspace.` });

      const record: DpaExecutionRecord = {
        id: id('dpa'), tenantId, documentVersion: DPA_VERSION, documentSha256: dpaDocumentSha256(),
        customerLegalName: parsed.data.customerLegalName, signatoryName: parsed.data.signatoryName, signatoryTitle: parsed.data.signatoryTitle,
        signatoryEmail: req.user!.email, executedAt: new Date().toISOString(),
      };
      const signature = signDpaExecution(record, secret);
      const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 512) : null;
      await req.db!.execute(sql`
        INSERT INTO tenant_dpa_executions (id, tenant_id, document_version, document_sha256, customer_legal_name, signatory_name, signatory_title, signatory_email, signatory_uid, ip_hash, user_agent, executed_at, signature)
        VALUES (${record.id}, ${tenantId}, ${record.documentVersion}, ${record.documentSha256}, ${record.customerLegalName}, ${record.signatoryName}, ${record.signatoryTitle}, ${record.signatoryEmail}, ${req.user!.uid}, ${hashIp(req)}, ${userAgent}, ${record.executedAt}::timestamp, ${signature})
      `);
      await appendAuditEntry(req.db!, { tenantId, action: 'dpa.executed', actor: req.user!.email, payload: { executionId: record.id, documentVersion: DPA_VERSION, documentSha256: record.documentSha256 } });
      return res.status(201).json({ execution: publicView(record, signature, true) });
    } catch (error) { return next(error); }
  });

  router.get('/public/branding/logo/:tenantId/:token', verifyLimiter, async (req, res, next) => {
    try {
      const tenantId = String(req.params.tenantId ?? '');
      const token = String(req.params.token ?? '');
      const expected = tenantId.length > 0 && tenantId.length <= 256 ? brandingLogoToken(tenantId) : null;
      if (!expected || token.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) return res.status(404).end();
      const row = (await db.execute(sql`SELECT logo_data_url AS "logoDataUrl" FROM tenant_branding WHERE tenant_id = ${tenantId} LIMIT 1`) as any).rows?.[0];
      const match = typeof row?.logoDataUrl === 'string' ? row.logoDataUrl.match(/^data:(image\/(?:png|jpeg|gif|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/) : null;
      if (!match) return res.status(404).end();
      res.setHeader('Content-Type', match[1]);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      return res.send(Buffer.from(match[2], 'base64'));
    } catch (error) { return next(error); }
  });

  router.get('/founder/contact-inquiries', requireAuth, requireRole('Owner'), requireFounder, rateLimiter, async (req: AuthenticatedRequest, res, next) => {
    try {
      const scopedDb = await attachTenantScope(FREE_REVIEW_TENANT_ID, res);
      const rows = (await scopedDb.execute(sql`
        SELECT id, name, email, company, topic, message, forwarded_at AS "forwardedAt", forward_error AS "forwardError", created_at AS "createdAt"
        FROM contact_inquiries WHERE tenant_id = ${FREE_REVIEW_TENANT_ID} ORDER BY created_at DESC LIMIT 200
      `) as any).rows ?? [];
      return res.json({ inquiries: rows });
    } catch (error) { return next(error); }
  });

  return router;
}
