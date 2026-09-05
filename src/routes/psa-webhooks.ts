/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Inbound PSA webhook transport.
//
// Everything here is the part that is identical for every vendor and has to be
// right regardless of which one is wired up: authenticate the sender, resolve
// the ticket to a finding inside the tenant's own RLS boundary, and apply the
// disposition through the state machine. The vendor's wire format is behind the
// adapter seam in psa-finding-sync.ts and is not guessed here.
//
// Four details this route gets right that are easy to get wrong:
//
//  * The body is read RAW. An HMAC is over the bytes the sender signed; once
//    express.json() has parsed and a handler re-serialises, key order and
//    spacing are no longer the sender's, and the signature cannot verify. This
//    router must be mounted with express.raw() before the JSON parser, exactly
//    as /api/billing/webhook already is.
//
//  * The database handle is tenant-scoped via attachTenantScope. There is no
//    authenticated user on a webhook, so req.db does not exist, and the global
//    pool is the owner connection -- psa_webhook_endpoints has FORCE ROW LEVEL
//    SECURITY (migration 0069), so an unscoped read returns zero rows and the
//    endpoint would answer 401 to every genuine request.
//
//  * The secret is decrypted from secret_ciphertext through the credential
//    vault. There is no plaintext `secret` column; the table stores a sha256
//    secret_hash for audit and the ciphertext for verification.
//
//  * The ticket is resolved to a finding by (tenant_id, psa_ticket_id), the
//    unique index from migration 0067 -- not by a findingId in the payload.
//    Trusting an id the caller supplies would let a signed webhook for one
//    ticket rewrite an unrelated finding.

import crypto, { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { sql } from 'drizzle-orm';
import { attachTenantScope } from '../middleware/tenant-scope.ts';
import { decryptCredentials } from '../integrations/credential-vault.ts';
import { verifyWebhookSignature } from '../security/webhook-signing.ts';
import {
  adapterFor,
  isRejection,
  planFindingUpdate,
  PsaVendorContractUnverified,
  registerPsaAdapter,
} from '../integrations/psa-finding-sync.ts';
import { isFindingState } from '../trust/finding-state.ts';
import { connectWiseAdapter, externalEventId, verifyConnectWiseSignature } from '../integrations/connectwise/webhook-adapter.ts';

// ConnectWise signs with a bare HMAC-SHA256 over the body, so it brings its own
// verifier and its own delivery id; the native scheme would reject all of it.
registerPsaAdapter({ ...connectWiseAdapter, verify: verifyConnectWiseSignature, eventId: externalEventId });

const sha256Hex = (value: string) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

const rawBodyOf = (req: Request): string =>
  Buffer.isBuffer(req.body) ? req.body.toString('utf8') : typeof req.body === 'string' ? req.body : '';

export function createPsaWebhookRouter() {
  const router = Router();

  router.post('/:provider/:tenantId', async (req: Request, res: Response, next) => {
    const provider = String(req.params.provider);
    const tenantId = String(req.params.tenantId);
    try {
      let adapter;
      try {
        adapter = adapterFor(provider);
      } catch (error) {
        if (error instanceof PsaVendorContractUnverified) {
          // 501, not 400: the request may be perfectly valid; this deployment
          // simply has no verified contract for that vendor yet.
          return res.status(501).json({ error: error.code, provider });
        }
        throw error;
      }

      const rawBody = rawBodyOf(req);
      if (!rawBody) return res.status(400).json({ error: 'EMPTY_BODY' });

      const scoped = await attachTenantScope(tenantId, res);
      const endpoint = (await scoped.execute(sql`
        SELECT id, secret_ciphertext AS "secretCiphertext"
        FROM psa_webhook_endpoints
        WHERE tenant_id = ${tenantId} AND provider = ${provider} AND active = true
        ORDER BY created_at DESC
        LIMIT 1
      `) as any).rows?.[0];
      // Same answer whether the tenant has no endpoint or the signature is
      // wrong, so this cannot be used to enumerate which tenants are connected.
      if (!endpoint) return res.status(401).json({ error: 'UNAUTHORIZED' });

      let secret: string;
      try {
        secret = String(decryptCredentials(String(endpoint.secretCiphertext)).secret ?? '');
      } catch {
        return res.status(500).json({ error: 'ENDPOINT_SECRET_UNREADABLE' });
      }
      if (!secret) return res.status(500).json({ error: 'ENDPOINT_SECRET_UNREADABLE' });

      const signature = String(req.headers[adapter.signatureHeader.toLowerCase()] ?? '');
      // A vendor that signs differently supplies its own verifier; otherwise the
      // native t=<unix>,v1=<hex> scheme applies.
      const verified = adapter.verify
        ? adapter.verify(secret, rawBody, signature)
        : verifyWebhookSignature(secret, rawBody, signature);
      if (!signature || !verified) {
        return res.status(401).json({ error: 'UNAUTHORIZED' });
      }

      // Replay protection. SPR's native signature carries a timestamp and is
      // rejected outside a five-minute window; a vendor scheme that signs only
      // the body -- ConnectWise's does -- leaves a captured request valid
      // forever. The UNIQUE (endpoint_id, external_event_id) constraint on
      // psa_webhook_events is what bounds it: a replayed delivery conflicts and
      // is acknowledged without being applied a second time.
      const deliveryId = adapter.eventId ? adapter.eventId(rawBody) : `sha256:${sha256Hex(rawBody)}`;
      const firstDelivery = (await scoped.execute(sql`
        INSERT INTO psa_webhook_events (id, endpoint_id, tenant_id, provider, external_event_id, payload_hash)
        VALUES (${`psaevt_${randomUUID()}`}, ${endpoint.id}, ${tenantId}, ${provider}, ${deliveryId}, ${sha256Hex(rawBody)})
        ON CONFLICT (endpoint_id, external_event_id) DO NOTHING
        RETURNING id
      `) as any).rows?.[0];
      if (!firstDelivery) {
        return res.status(200).json({ received: true, applied: false, code: 'DUPLICATE_DELIVERY' });
      }

      const event = adapter.parse(rawBody, req.headers as Record<string, string | undefined>);
      if (!event?.ticketId) return res.status(400).json({ error: 'TICKET_ID_MISSING' });

      const finding = (await scoped.execute(sql`
        SELECT id, state FROM scan_findings
        WHERE tenant_id = ${tenantId} AND psa_ticket_id = ${event.ticketId}
        LIMIT 1
      `) as any).rows?.[0];
      // A ticket SPR never produced is acknowledged and ignored rather than
      // retried forever by the vendor's delivery queue.
      if (!finding) return res.status(202).json({ received: true, linked: false });

      const currentState = String(finding.state);
      if (!isFindingState(currentState)) return res.status(500).json({ error: 'FINDING_STATE_UNRECOGNISED' });

      const outcome = planFindingUpdate(currentState, event.disposition, {
        ticketId: event.ticketId,
        actor: event.actor || `${provider}_webhook`,
        note: event.note,
        observedAt: new Date().toISOString(),
      });

      if (isRejection(outcome)) {
        // Accepted and recorded as a no-op. The vendor did nothing wrong, so a
        // 4xx would just make it retry a request that will never apply.
        return res.status(200).json({ received: true, applied: false, code: outcome.code, reason: outcome.reason });
      }

      await scoped.execute(sql`
        UPDATE scan_findings
        SET state = ${outcome.nextState},
            human_claim_by = ${event.actor || `${provider}_webhook`},
            human_claim_reason = ${outcome.humanClaimReason},
            last_psa_sync_at = NOW(),
            updated_at = NOW()
        WHERE tenant_id = ${tenantId} AND id = ${finding.id}
      `);

      return res.status(200).json({
        received: true,
        applied: true,
        state: outcome.nextState,
        requiresVerification: outcome.requiresVerification,
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
