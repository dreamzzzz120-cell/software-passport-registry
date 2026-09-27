import crypto from 'node:crypto';
import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth, requireRole, AuthenticatedRequest } from '../middleware/security.ts';
import { appendAuditEntry } from '../security/audit-log.ts';
import { INTEGRATION_CATALOG } from '../integrations/catalog.ts';
import { collectProviderEvidence, Provider, ProviderCredentials } from '../integrations/adapters.ts';
import { decryptCredentials, encryptCredentials } from '../integrations/credential-vault.ts';
import { discoverProviderCustomersWithCoverage, supportsCustomerDiscovery, type CustomerDiscoveryProvider } from '../integrations/customer-discovery.ts';
import { collectProviderSoftwareInventory } from '../integrations/provider-software-inventory.ts';

const PROVIDERS = new Set(INTEGRATION_CATALOG.map(item => item.provider));
const credentialSchema = z.record(z.string().min(1).max(128), z.string().max(4096)).refine(v => Object.keys(v).length > 0, 'Credentials cannot be empty');
const testSchema = z.object({ passportId: z.string().trim().min(1).max(255) }).strict();
const mappingSchema = z.object({ clientId: z.string().trim().min(1).max(255).nullable() }).strict();
function id(prefix: string) { return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`; }
function routeParam(value: string | string[] | undefined): string { return Array.isArray(value) ? value[0] || '' : value || ''; }
export function providerFromParam(value: string): Provider { if (!PROVIDERS.has(value) || value === 'github') throw new Error('PROVIDER_NOT_SUPPORTED_BY_GENERIC_ADAPTER'); return value as Provider; }
export function credentialProviderFromParam(value: string): string { if (!PROVIDERS.has(value)) throw new Error('PROVIDER_NOT_SUPPORTED_BY_GENERIC_ADAPTER'); return value; }
function customerDiscoveryProviderFromParam(value: string): CustomerDiscoveryProvider { if (!supportsCustomerDiscovery(value)) throw new Error('PROVIDER_DOES_NOT_SUPPORT_CUSTOMER_DISCOVERY'); return value; }
function integrationId(tenantId: string, provider: string) { return `int_${crypto.createHash('sha256').update(`${tenantId}:${provider}`).digest('hex').slice(0, 32)}`; }

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

  router.put('/:provider/credentials', requireAuth, requireRole(['Owner', 'Admin']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const provider = credentialProviderFromParam(routeParam(req.params.provider));
      const parsed = credentialSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid credentials payload', details: parsed.error.flatten() });
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const encryptedPayload = encryptCredentials(parsed.data);
      await db.execute(sql`INSERT INTO integration_credentials (id, tenant_id, provider, encrypted_payload, key_version, status) VALUES (${id('cred')}, ${tenantId}, ${provider}, ${encryptedPayload}, 1, 'CONFIGURED') ON CONFLICT (tenant_id, provider) DO UPDATE SET encrypted_payload = EXCLUDED.encrypted_payload, key_version = EXCLUDED.key_version, status = 'CONFIGURED', updated_at = CURRENT_TIMESTAMP`);
      await appendAuditEntry(db, { tenantId, action: 'integration_credentials.saved', actor: req.user!.uid, payload: { provider, fields: Object.keys(parsed.data) } });
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
      await appendAuditEntry(db, { tenantId, action: 'integration_credentials.deleted', actor: req.user!.uid, payload: { provider } });
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
      const runId = id('custdisc');
      const startedAt = new Date().toISOString();
      const discovery = await discoverProviderCustomersWithCoverage(provider, decryptCredentials(payload) as ProviderCredentials);
      const now = new Date().toISOString();
      await db.transaction(async tx => {
        await tx.execute(sql`INSERT INTO provider_customer_discovery_runs (id, tenant_id, provider, status, pages_fetched, records_fetched, limitation, started_at, completed_at) VALUES (${runId}, ${tenantId}, ${provider}, ${discovery.complete ? 'COMPLETE' : 'PARTIAL'}, ${discovery.pagesFetched}, ${discovery.customers.length}, ${discovery.limitation}, ${startedAt}, ${now})`);
        for (const customer of discovery.customers) {
          await tx.execute(sql`INSERT INTO provider_customers (id, tenant_id, provider, external_customer_id, external_customer_name, raw_metadata, discovered_at, last_synced_at, lifecycle_status, last_seen_run_id, absent_since) VALUES (${id('provcust')}, ${tenantId}, ${provider}, ${customer.externalId}, ${customer.name}, ${JSON.stringify(customer.raw)}, ${now}, ${now}, 'ACTIVE', ${runId}, NULL) ON CONFLICT (tenant_id, provider, external_customer_id) DO UPDATE SET external_customer_name = EXCLUDED.external_customer_name, raw_metadata = EXCLUDED.raw_metadata, last_synced_at = EXCLUDED.last_synced_at, lifecycle_status = 'ACTIVE', last_seen_run_id = EXCLUDED.last_seen_run_id, absent_since = NULL`);
        }
        if (discovery.complete) {
          await tx.execute(sql`UPDATE provider_customers SET lifecycle_status = 'ABSENT', absent_since = COALESCE(absent_since, ${now}) WHERE tenant_id = ${tenantId} AND provider = ${provider} AND lifecycle_status = 'ACTIVE' AND (last_seen_run_id IS NULL OR last_seen_run_id <> ${runId})`);
        }
      });
      return res.json({ provider, runId, status: discovery.complete ? 'COMPLETE' : 'PARTIAL', complete: discovery.complete, discoveredCount: discovery.customers.length, pagesFetched: discovery.pagesFetched, limitation: discovery.limitation, syncedAt: now });
    } catch (error: any) { const message = error instanceof Error ? error.message : String(error); if (/CREDENTIAL_|PROVIDER_|UNSUPPORTED_|HTTP_/.test(message)) return res.status(502).json({ error: message }); return next(error); }
  });

  router.post('/:provider/customers/:externalId/software/discover', requireAuth, requireRole(['Owner', 'Admin', 'Operator']), async (req: AuthenticatedRequest, res, next) => {
    try {
      const provider = customerDiscoveryProviderFromParam(routeParam(req.params.provider));
      const externalId = routeParam(req.params.externalId);
      const db = req.db!;
      const tenantId = req.user!.tenantId;
      const customer = await db.execute(sql`SELECT id, client_id FROM provider_customers WHERE tenant_id = ${tenantId} AND provider = ${provider} AND external_customer_id = ${externalId} AND lifecycle_status = 'ACTIVE' LIMIT 1`);
      const customerRow = (customer as any).rows?.[0];
      if (!customerRow) return res.status(404).json({ error: 'Active discovered customer not found for this tenant.' });
      const stored = await db.execute(sql`SELECT encrypted_payload FROM integration_credentials WHERE tenant_id = ${tenantId} AND provider = ${provider} LIMIT 1`);
      const payload = (stored as any).rows?.[0]?.encrypted_payload;
      if (!payload) return res.status(409).json({ error: 'CREDENTIAL_NOT_CONFIGURED' });

      const runId = id('softdisc');
      const startedAt = new Date().toISOString();
      await db.execute(sql`INSERT INTO provider_software_inventory_runs (id, tenant_id, provider, provider_customer_id, status, observations_fetched, limitation, started_at, completed_at) VALUES (${runId}, ${tenantId}, ${provider}, ${customerRow.id}, 'RUNNING', 0, NULL, ${startedAt}, NULL)`);
      try {
        const inventory = await collectProviderSoftwareInventory(provider, decryptCredentials(payload) as ProviderCredentials, externalId);
        const completedAt = new Date().toISOString();
        await db.execute(sql`UPDATE provider_software_inventory_runs SET status = ${inventory.status}, observations_fetched = ${inventory.observations.length}, limitation = ${inventory.limitation}, completed_at = ${completedAt} WHERE id = ${runId} AND tenant_id = ${tenantId}`);
        return res.json({ provider, externalCustomerId: externalId, runId, status: inventory.status, complete: inventory.complete, observationsFetched: inventory.observations.length, limitation: inventory.limitation, collectedAt: completedAt });
      } catch (collectionError: any) {
        const completedAt = new Date().toISOString();
        const safeReason = /^([A-Z0-9_]{3,80})$/.test(collectionError?.message || '') ? collectionError.message : 'SOFTWARE_INVENTORY_COLLECTION_FAILED';
        await db.execute(sql`UPDATE provider_software_inventory_runs SET status = 'FAILED', limitation = ${safeReason}, completed_at = ${completedAt} WHERE id = ${runId} AND tenant_id = ${tenantId}`);
        throw collectionError;
      }
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      if (/CREDENTIAL_|PROVIDER_|UNSUPPORTED_|HTTP_/.test(message)) return res.status(502).json({ error: message });
      return next(error);
    }
  });

  router.get('/:provider/customers', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const provider = customerDiscoveryProviderFromParam(routeParam(req.params.provider));
      const db = req.db!; const tenantId = req.user!.tenantId; const isClient = req.user!.role === 'Client'; const clientId = req.user!.clientId;
      if (isClient && !clientId) return res.status(403).json({ error: 'Client account has invalid client configuration' });
      const rows = await db.execute(sql`SELECT pc.id, pc.external_customer_id, pc.external_customer_name, pc.client_id, pc.discovered_at, pc.last_synced_at, pc.mapped_at, pc.lifecycle_status, pc.absent_since, pc.last_seen_run_id, c.name AS client_name FROM provider_customers pc LEFT JOIN clients c ON c.id = pc.client_id AND c.tenant_id = pc.tenant_id WHERE pc.tenant_id = ${tenantId} AND pc.provider = ${provider} AND (${isClient ? sql`pc.client_id = ${clientId}` : sql`TRUE`}) ORDER BY pc.external_customer_name ASC`);
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

