import crypto from 'node:crypto';
import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth, requireRole, AuthenticatedRequest } from '../middleware/security.ts';
import { INTEGRATION_CATALOG } from '../integrations/catalog.ts';
import { collectProviderEvidence, Provider, ProviderCredentials } from '../integrations/adapters.ts';
import { decryptCredentials, encryptCredentials } from '../integrations/credential-vault.ts';
import { discoverProviderCustomers, supportsCustomerDiscovery, type CustomerDiscoveryProvider } from '../integrations/customer-discovery.ts';

const PROVIDERS = new Set(INTEGRATION_CATALOG.map(item => item.provider));
const PSA_WEBHOOK_PROVIDERS = new Set(['connectwise', 'autotask', 'ninjaone']);
const credentialSchema = z.record(z.string().min(1).max(128), z.string().max(4096)).refine(v => Object.keys(v).length > 0, 'Credentials cannot be empty');
const testSchema = z.object({ passportId: z.string().trim().min(1).max(255) }).strict();
const mappingSchema = z.object({ clientId: z.string().trim().min(1).max(255).nullable() }).strict();
const psaEndpointSchema = z.object({ provider: z.enum(['connectwise', 'autotask', 'ninjaone']), secret: z.string().min(32).max(4096) }).strict();
const psaBindingSchema = z.object({ provider: z.enum(['connectwise', 'autotask', 'ninjaone']), ticketId: z.string().trim().min(1).max(255) }).strict();
function id(prefix: string) { return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`; }
function routeParam(value: string | string[] | undefined): string { return Array.isArray(value) ? value[0] || '' : value || ''; }
export function providerFromParam(value: string): Provider { if (!PROVIDERS.has(value) || value === 'github') throw new Error('PROVIDER_NOT_SUPPORTED_BY_GENERIC_ADAPTER'); return value as Provider; }
export function credentialProviderFromParam(value: string): string { if (!PROVIDERS.has(value)) throw new Error('PROVIDER_NOT_SUPPORTED_BY_GENERIC_ADAPTER'); return value; }
function customerDiscoveryProviderFromParam(value: string): CustomerDiscoveryProvider { if (!supportsCustomerDiscovery(value)) throw new Error('PROVIDER_DOES_NOT_SUPPORT_CUSTOMER_DISCOVERY'); return value; }
function integrationId(tenantId: string, provider: string) { return `int_${crypto.createHash('sha256').update(`${tenantId}:${provider}`).digest('hex').slice(0, 32)}`; }
function secretHash(secret: string) { return crypto.createHash('sha256').update(secret, 'utf8').digest('hex'); }
function verifyPsaSignature(secret: string, payload: string, header: string | undefined): boolean {
  if (!header) return false;
  const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header.trim());
  if (!match) return false;
  const timestamp = Number(match[1]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${payload}`, 'utf8').digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(match[2], 'hex'));
}
function eventIdFromPayload(provider: string, body: any, headers: Record<string, string | string[] | undefined>): string | null {
  const headerId = headers['x-event-id'] || headers['x-webhook-id'] || headers['x-request-id'];
  const rawHeader = Array.isArray(headerId) ? headerId[0] : headerId;
  if (rawHeader) return rawHeader.slice(0, 255);
  if (provider === 'autotask' && typeof body?.Guid === 'string') return body.Guid.slice(0, 255);
  if (provider === 'connectwise' && typeof body?.id !== 'undefined') return `cw:${String(body.id).slice(0, 240)}`;
  if (provider === 'ninjaone' && typeof body?.id !== 'undefined') return `n1:${String(body.id).slice(0, 240)}`;
  return null;
}
function ticketIdFromPayload(provider: string, body: any): string | null {
  const candidates = provider === 'autotask'
    ? [body?.Id, body?.TicketId, body?.ticketId]
    : [body?.ticketId, body?.TicketId, body?.ticket?.id, body?.id];
  const value = candidates.find(v => typeof v === 'string' || typeof v === 'number');
  return value == null ? null : String(value).slice(0, 255);
}
function eventTypeFromPayload(provider: string, body: any): string {
  const value = provider === 'autotask' ? body?.Action : (body?.eventType || body?.type || body?.event || body?.activityType);
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 128) : 'unknown';
}

export function createLiveIntegrationsRouter() {
  const router = Router();

  router.get('/', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const credentials = await db.execute(sql`SELECT provider, status, last_tested_at FROM integration_credentials WHERE tenant_id = ${tenantId}`);
      const rows = new Map<string, any>((credentials as any).rows?.map((r: any) => [r.provider, r]) ?? []);
      return res.json(INTEGRATION_CATALOG.map(item => ({ ...item, adapter: item.provider === 'github' ? 'repository-worker' : 'live-http', credentialStatus: rows.get(item.provider)?.status ?? 'NOT_CONFIGURED', lastTestedAt: rows.get(item.provider)?.last_tested_at ?? null })));
    } catch (error) { return next(error); }
  });

  // Owner/Admin creates an opaque inbound endpoint. The plaintext secret is never stored;
  // the encrypted value is needed only for signature verification, while the hash supports audit.
  router.post('/psa/webhooks', requireAuth, requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const parsed = psaEndpointSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid PSA webhook configuration', details: parsed.error.flatten() });
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const endpointId = id('psawh');
      const encrypted = encryptCredentials({ secret: parsed.data.secret });
      await db.execute(sql`INSERT INTO psa_webhook_endpoints (id, tenant_id, provider, secret_hash, secret_ciphertext, active, created_by) VALUES (${endpointId}, ${tenantId}, ${parsed.data.provider}, ${secretHash(parsed.data.secret)}, ${encrypted}, true, ${req.user!.uid})`);
      return res.status(201).json({ id: endpointId, provider: parsed.data.provider, active: true, secretHash: secretHash(parsed.data.secret), endpointPath: `/api/integrations-live/psa/webhooks/${endpointId}` });
    } catch (error: any) {
      if (/INTEGRATION_MASTER_KEY/.test(error?.message || '')) return res.status(503).json({ error: error.message });
      return next(error);
    }
  });

  router.delete('/psa/webhooks/:endpointId', requireAuth, requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const endpointId = routeParam(req.params.endpointId);
      await req.db!.execute(sql`UPDATE psa_webhook_endpoints SET active = false, rotated_at = CURRENT_TIMESTAMP WHERE id = ${endpointId} AND tenant_id = ${req.user!.tenantId}`);
      return res.status(204).send();
    } catch (error) { return next(error); }
  });

  // Binds a vendor ticket to a finding before the vendor is allowed to influence its state.
  // This is deliberately an authenticated admin action; a webhook cannot invent its own finding link.
  router.put('/psa/findings/:findingId/ticket', requireAuth, requireRole(['Owner', 'Admin', 'Operator']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const findingId = routeParam(req.params.findingId);
      const parsed = psaBindingSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid PSA ticket binding', details: parsed.error.flatten() });
      const db = req.db!;
      const existing = await db.execute(sql`SELECT id, state FROM scan_findings WHERE id = ${findingId} AND tenant_id = ${req.user!.tenantId} LIMIT 1`);
      if (!((existing as any).rows?.length)) return res.status(404).json({ error: 'Finding not found for this tenant.' });
      const conflict = await db.execute(sql`SELECT id FROM scan_findings WHERE tenant_id = ${req.user!.tenantId} AND psa_provider = ${parsed.data.provider} AND psa_ticket_id = ${parsed.data.ticketId} AND id <> ${findingId} LIMIT 1`);
      if ((conflict as any).rows?.length) return res.status(409).json({ error: 'PSA ticket is already bound to another finding.' });
      await db.execute(sql`UPDATE scan_findings SET psa_provider = ${parsed.data.provider}, psa_ticket_id = ${parsed.data.ticketId}, updated_at = CURRENT_TIMESTAMP WHERE id = ${findingId} AND tenant_id = ${req.user!.tenantId}`);
      return res.status(204).send();
    } catch (error) { return next(error); }
  });

  // Public inbound webhook. The endpoint ID is opaque, the secret is tenant-scoped,
  // signatures are time-bound, and event IDs are unique per endpoint for replay defense.
  router.post('/psa/webhooks/:endpointId', async (req: any, res, next) => {
    try {
      const endpointId = routeParam(req.params.endpointId);
      const result = await req.app.locals?.__sprDb?.execute?.(sql`SELECT id, tenant_id, provider, secret_ciphertext, active FROM psa_webhook_endpoints WHERE id = ${endpointId} LIMIT 1`);
      const db = result ? req.app.locals.__sprDb : null;
      if (!db) {
        // Public routes normally use the application db because no authenticated tenant context exists.
        const { db: applicationDb } = await import('../db/index.ts');
        const rowResult = await applicationDb.execute(sql`SELECT id, tenant_id, provider, secret_ciphertext, active FROM psa_webhook_endpoints WHERE id = ${endpointId} LIMIT 1`);
        const row = (rowResult as any).rows?.[0];
        if (!row?.active) return res.status(404).json({ error: 'Webhook endpoint not found.' });
        return processInboundPsaWebhook(applicationDb, row, req, res);
      }
      const row = (result as any).rows?.[0];
      if (!row?.active) return res.status(404).json({ error: 'Webhook endpoint not found.' });
      return processInboundPsaWebhook(db, row, req, res);
    } catch (error) { return next(error); }
  });

  router.put('/:provider/credentials', requireAuth, requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const provider = credentialProviderFromParam(routeParam(req.params.provider));
      const parsed = credentialSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid credentials payload', details: parsed.error.flatten() });
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const encryptedPayload = encryptCredentials(parsed.data);
      await db.execute(sql`INSERT INTO integration_credentials (id, tenant_id, provider, encrypted_payload, key_version, status) VALUES (${id('cred')}, ${tenantId}, ${provider}, ${encryptedPayload}, 1, 'CONFIGURED') ON CONFLICT (tenant_id, provider) DO UPDATE SET encrypted_payload = EXCLUDED.encrypted_payload, key_version = EXCLUDED.key_version, status = 'CONFIGURED', updated_at = CURRENT_TIMESTAMP`);
      return res.status(204).send();
    } catch (error: any) {
      if (/INTEGRATION_MASTER_KEY|PROVIDER_NOT_SUPPORTED/.test(error?.message || '')) return res.status(503).json({ error: error.message });
      return next(error);
    }
  });

  router.delete('/:provider/credentials', requireAuth, requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const provider = credentialProviderFromParam(routeParam(req.params.provider));
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      await db.transaction(async tx => {
        await tx.execute(sql`DELETE FROM integration_credentials WHERE tenant_id = ${tenantId} AND provider = ${provider}`);
        await tx.execute(sql`UPDATE integrations SET connected = 0 WHERE id = ${integrationId(tenantId, provider)} AND tenant_id = ${tenantId}`);
      });
      return res.status(204).send();
    } catch (error: any) {
      if (/PROVIDER_NOT_SUPPORTED/.test(error?.message || '')) return res.status(503).json({ error: error.message });
      return next(error);
    }
  });

  router.get('/github/repositories', requireAuth, requireRole(['Owner', 'Admin', 'Operator']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const stored = await db.execute(sql`SELECT encrypted_payload FROM integration_credentials WHERE tenant_id = ${tenantId} AND provider = 'github' LIMIT 1`);
      const payload = (stored as any).rows?.[0]?.encrypted_payload;
      if (!payload) return res.status(409).json({ error: 'CREDENTIAL_NOT_CONFIGURED' });
      const credentials = decryptCredentials(payload) as Record<string, string>;
      const token = credentials.accessToken || credentials.token;
      if (!token) return res.status(409).json({ error: 'CREDENTIAL_MISSING_ACCESS_TOKEN' });
      const response = await fetch('https://api.github.com/user/repos?per_page=100&affiliation=owner,collaborator,organization_member&sort=updated', { headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2026-03-10' } });
      if (!response.ok) return res.status(502).json({ error: `GITHUB_HTTP_${response.status}` });
      const repos = await response.json();
      if (!Array.isArray(repos)) return res.status(502).json({ error: 'GITHUB_UNEXPECTED_RESPONSE' });
      return res.json(repos.map((repo: any) => ({ fullName: repo.full_name, private: Boolean(repo.private), defaultBranch: repo.default_branch || 'main', htmlUrl: repo.html_url })));
    } catch (error) { return next(error); }
  });

  router.post('/:provider/test', requireAuth, requireRole(['Owner', 'Admin', 'Operator']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const provider = providerFromParam(routeParam(req.params.provider));
      const parsed = testSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'passportId is required' });
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const passport = await db.execute(sql`SELECT id FROM passports WHERE id = ${parsed.data.passportId} AND tenant_id = ${tenantId} LIMIT 1`);
      if (!((passport as any).rows?.length)) return res.status(404).json({ error: 'Passport not found for this tenant.' });
      const stored = await db.execute(sql`SELECT encrypted_payload FROM integration_credentials WHERE tenant_id = ${tenantId} AND provider = ${provider} LIMIT 1`);
      const payload = (stored as any).rows?.[0]?.encrypted_payload;
      if (!payload) return res.status(409).json({ error: 'CREDENTIAL_NOT_CONFIGURED' });
      const observation = await collectProviderEvidence(provider, decryptCredentials(payload) as ProviderCredentials);
      const evidenceId = id(`ev-${provider}`);
      await db.transaction(async tx => {
        await tx.execute(sql`INSERT INTO evidence_items (id, tenant_id, asset_id, name, type, verified, status, signer, timestamp, hash, raw_content, engine_id, verification_failure_reason) VALUES (${evidenceId}, ${tenantId}, ${parsed.data.passportId}, ${`${provider} authenticated observation`}, 'Integration Evidence', 0, 'OBSERVED', ${provider}, ${observation.observedAt}, ${observation.responseHash}, ${JSON.stringify(observation.observation)}, ${`integration-${provider}`}, NULL)`);
        await tx.execute(sql`UPDATE integration_credentials SET status = 'LIVE', last_tested_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ${tenantId} AND provider = ${provider}`);
        const catalog = INTEGRATION_CATALOG.find(x => x.provider === provider)!;
        await tx.execute(sql`INSERT INTO integrations (id, tenant_id, name, category, icon, connected, description, api_key_hint, last_sync_date) VALUES (${integrationId(tenantId, provider)}, ${tenantId}, ${catalog.name}, ${catalog.category}, ${catalog.icon}, 1, ${catalog.description}, 'encrypted-provider-credential', ${observation.observedAt}) ON CONFLICT (id) DO UPDATE SET connected = 1, last_sync_date = EXCLUDED.last_sync_date`);
      });
      return res.json({ provider, status: 'LIVE', evidenceId, subject: observation.subject, observedAt: observation.observedAt, responseHash: observation.responseHash, verificationMethod: observation.verificationMethod });
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      if (/CREDENTIAL_|PROVIDER_|UNSUPPORTED_|HTTP_/.test(message)) return res.status(502).json({ error: message });
      return next(error);
    }
  });

  router.post('/:provider/customers/discover', requireAuth, requireRole(['Owner', 'Admin', 'Operator']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const provider = customerDiscoveryProviderFromParam(routeParam(req.params.provider));
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const stored = await db.execute(sql`SELECT encrypted_payload FROM integration_credentials WHERE tenant_id = ${tenantId} AND provider = ${provider} LIMIT 1`);
      const payload = (stored as any).rows?.[0]?.encrypted_payload;
      if (!payload) return res.status(409).json({ error: 'CREDENTIAL_NOT_CONFIGURED' });
      const discovered = await discoverProviderCustomers(provider, decryptCredentials(payload) as ProviderCredentials);
      const now = new Date().toISOString();
      await db.transaction(async tx => { for (const customer of discovered) { await tx.execute(sql`INSERT INTO provider_customers (id, tenant_id, provider, external_customer_id, external_customer_name, raw_metadata, discovered_at, last_synced_at) VALUES (${id('provcust')}, ${tenantId}, ${provider}, ${customer.externalId}, ${customer.name}, ${JSON.stringify(customer.raw)}, ${now}, ${now}) ON CONFLICT (tenant_id, provider, external_customer_id) DO UPDATE SET external_customer_name = EXCLUDED.external_customer_name, raw_metadata = EXCLUDED.raw_metadata, last_synced_at = EXCLUDED.last_synced_at`); } });
      return res.json({ provider, discoveredCount: discovered.length, syncedAt: now });
    } catch (error: any) { const message = error instanceof Error ? error.message : String(error); if (/CREDENTIAL_|PROVIDER_|UNSUPPORTED_|HTTP_/.test(message)) return res.status(502).json({ error: message }); return next(error); }
  });

  router.get('/:provider/customers', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const provider = customerDiscoveryProviderFromParam(routeParam(req.params.provider));
      const db = req.db!; const tenantId = req.user!.tenantId; const isClient = req.user!.role === 'Client'; const clientId = req.user!.clientId;
      if (isClient && !clientId) return res.status(403).json({ error: 'Client account has invalid client configuration' });
      const rows = await db.execute(sql`SELECT pc.id, pc.external_customer_id, pc.external_customer_name, pc.client_id, pc.discovered_at, pc.last_synced_at, pc.mapped_at, c.name AS client_name FROM provider_customers pc LEFT JOIN clients c ON c.id = pc.client_id AND c.tenant_id = pc.tenant_id WHERE pc.tenant_id = ${tenantId} AND pc.provider = ${provider} AND (${isClient ? sql`pc.client_id = ${clientId}` : sql`TRUE`}) ORDER BY pc.external_customer_name ASC`);
      return res.json((rows as any).rows ?? []);
    } catch (error: any) { if (/PROVIDER_/.test(error?.message || '')) return res.status(400).json({ error: error.message }); return next(error); }
  });

  router.put('/:provider/customers/:externalId/mapping', requireAuth, requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const provider = customerDiscoveryProviderFromParam(routeParam(req.params.provider)); const externalId = routeParam(req.params.externalId); const parsed = mappingSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      const db = req.db!; const tenantId = req.user!.tenantId;
      const existing = await db.execute(sql`SELECT id FROM provider_customers WHERE tenant_id = ${tenantId} AND provider = ${provider} AND external_customer_id = ${externalId} LIMIT 1`);
      if (!((existing as any).rows?.length)) return res.status(404).json({ error: 'Discovered customer not found for this tenant. Run discovery first.' });
      if (parsed.data.clientId) { const client = await db.execute(sql`SELECT id FROM clients WHERE id = ${parsed.data.clientId} AND tenant_id = ${tenantId} LIMIT 1`); if (!((client as any).rows?.length)) return res.status(404).json({ error: 'Client not found for this tenant.' }); }
      const now = new Date().toISOString(); await db.execute(sql`UPDATE provider_customers SET client_id = ${parsed.data.clientId}, mapped_at = ${parsed.data.clientId ? now : null}, mapped_by = ${parsed.data.clientId ? req.user!.uid : null} WHERE tenant_id = ${tenantId} AND provider = ${provider} AND external_customer_id = ${externalId}`);
      return res.status(204).send();
    } catch (error: any) { if (/PROVIDER_/.test(error?.message || '')) return res.status(400).json({ error: error.message }); return next(error); }
  });

  return router;
}

async function processInboundPsaWebhook(db: any, row: any, req: any, res: any) {
  const provider = String(row.provider);
  if (!PSA_WEBHOOK_PROVIDERS.has(provider)) return res.status(404).json({ error: 'PSA provider not supported.' });
  const payload = JSON.stringify(req.body ?? null);
  const credentials = decryptCredentials(row.secret_ciphertext);
  const secret = credentials.secret;
  if (!secret) return res.status(503).json({ error: 'Webhook secret unavailable.' });
  const signature = typeof req.headers['x-spr-webhook-signature'] === 'string' ? req.headers['x-spr-webhook-signature'] : undefined;
  if (!verifyPsaSignature(secret, payload, signature)) return res.status(401).json({ error: 'Invalid webhook signature.' });
  const externalEventId = eventIdFromPayload(provider, req.body, req.headers);
  if (!externalEventId) return res.status(400).json({ error: 'Webhook event id is required.' });
  const ticketId = ticketIdFromPayload(provider, req.body);
  const eventType = eventTypeFromPayload(provider, req.body);
  const payloadHash = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
  const eventDbId = id('psaevt');
  const inserted = await db.execute(sql`INSERT INTO psa_webhook_events (id, endpoint_id, tenant_id, provider, external_event_id, ticket_id, event_type, payload_hash) VALUES (${eventDbId}, ${row.id}, ${row.tenant_id}, ${provider}, ${externalEventId}, ${ticketId}, ${eventType}, ${payloadHash}) ON CONFLICT (endpoint_id, external_event_id) DO NOTHING RETURNING id`);
  if (!((inserted as any).rows?.length)) return res.status(200).json({ accepted: true, duplicate: true });
  let updated = 0;
  if (ticketId) {
    const result = await db.execute(sql`UPDATE scan_findings SET state = CASE WHEN state = 'detected' OR state = 'claimed_false_positive' OR state = 'remediated_claimed' THEN 'under_verification' ELSE state END, last_psa_sync_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ${row.tenant_id} AND psa_provider = ${provider} AND psa_ticket_id = ${ticketId} AND state NOT IN ('verified_not_affected','remediated_verified')`);
    updated = Number((result as any).rowCount || 0);
  }
  await db.execute(sql`UPDATE psa_webhook_events SET processed_at = CURRENT_TIMESTAMP WHERE id = ${eventDbId}`);
  return res.status(202).json({ accepted: true, duplicate: false, provider, eventId: externalEventId, ticketId, findingsQueued: updated });
}
