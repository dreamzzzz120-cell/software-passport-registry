/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import rateLimit from 'express-rate-limit';
import { config } from '../config.ts';
import { attachTenantScope } from '../middleware/tenant-scope.ts';
import { verifyFreeReviewStatusToken } from './public-connect.ts';
import { FREE_REVIEW_TENANT_ID } from './free-review-submit.ts';

// Lead capture on a Free Review result. The visitor already holds the signed
// status token for their own review; giving a name and business email records
// a lead and unlocks the client-side PDF of the result they can already see.
// Nothing extra is revealed by the server -- the PDF is rendered in the
// browser from the same payload -- so the gate is honest about what it gates.

export const CONSENT_TEXT = 'SPR may email you about this review and related services. Unsubscribe any time.';

// Consumer mailbox domains: a B2B lead needs a work address. Kept short and
// explicit; anything not listed is accepted.
const FREE_MAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'yahoo.co.uk', 'yahoo.ca', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.de', 'mail.com', 'yandex.com', 'zoho.com']);

const leadSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  company: z.string().trim().max(160).optional(),
  consent: z.literal(true),
}).strict();

const leadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, validate: { trustProxy: false } });

function id(prefix: string) { return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`; }
function hashIp(req: { ip?: string; socket: { remoteAddress?: string } }) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  return crypto.createHmac('sha256', config.publicPassport.secret || 'insecure-dev-only-key').update(ip).digest('hex');
}

export function isBusinessEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  return domain.length > 0 && !FREE_MAIL_DOMAINS.has(domain);
}

export function createFreeReviewLeadsRouter() {
  const router = Router();

  router.post('/free-review/scan/:passportId/report-request/:token', leadLimiter, async (req, res, next) => {
    try {
      const passportId = String(req.params.passportId ?? '');
      const token = String(req.params.token ?? '');
      const payload = verifyFreeReviewStatusToken(token, passportId);
      if (!payload) return res.status(401).json({ error: 'Invalid or expired Free Review link.' });
      const parsed = leadSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Name, a valid email address and consent are required.', details: parsed.error.flatten() });
      if (!isBusinessEmail(parsed.data.email)) return res.status(422).json({ error: 'Please use your work email address. Personal mailbox domains are not accepted for the PDF report.', code: 'BUSINESS_EMAIL_REQUIRED' });

      const scopedDb = await attachTenantScope(FREE_REVIEW_TENANT_ID, res);
      const submission = (await scopedDb.execute(sql`SELECT repository_owner AS owner, repository_name AS repository FROM free_review_submissions WHERE tenant_id = ${FREE_REVIEW_TENANT_ID} AND passport_id = ${passportId} ORDER BY created_at DESC LIMIT 1`) as any).rows?.[0];
      if (!submission) return res.status(404).json({ error: 'Free Review submission not found.' });
      const repository = `${submission.owner}/${submission.repository}`;
      const leadId = id('lead');
      const ipHash = hashIp(req);
      await scopedDb.execute(sql`INSERT INTO free_review_leads (id, tenant_id, passport_id, name, email, company, repository, ip_hash, consent_text) VALUES (${leadId}, ${FREE_REVIEW_TENANT_ID}, ${passportId}, ${parsed.data.name}, ${parsed.data.email}, ${parsed.data.company ?? null}, ${repository}, ${ipHash}, ${CONSENT_TEXT})`);

      // Operator notification through the same durable outbox purchases use.
      const subject = `[SPR lead] ${parsed.data.name} <${parsed.data.email}> requested the PDF for ${repository}`;
      const body = [
        `A Free Review visitor requested the PDF report.`, '',
        `Name: ${parsed.data.name}`, `Email: ${parsed.data.email}`, `Company: ${parsed.data.company ?? '(not given)'}`,
        `Repository: ${repository}`, `Passport: ${passportId}`, `Lead id: ${leadId}`, '',
        `Consent recorded: "${CONSENT_TEXT}"`,
      ].join('\n');
      await scopedDb.execute(sql`INSERT INTO notification_outbox (id, tenant_id, channel, destination, subject, body) VALUES (${`lead_${leadId}_ops`}, ${FREE_REVIEW_TENANT_ID}, 'email', ${config.fulfilmentEmail}, ${subject}, ${body}) ON CONFLICT (id) DO NOTHING`);

      return res.status(201).json({ leadId, unlocked: true });
    } catch (error) { return next(error); }
  });

  return router;
}
