import crypto from 'node:crypto';
import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { requireAuth, requireRole, AuthenticatedRequest } from '../middleware/security.ts';
import { INTEGRATION_CATALOG } from '../integrations/catalog.ts';
import { collectProviderEvidence, Provider, ProviderCredentials } from '../integrations/adapters.ts';
import { decryptCredentials, encryptCredentials } from '../integrations/credential-vault.ts';

const PROVIDERS = new Set(INTEGRATION_CATALOG.map(item => item.provider));
const credentialSchema = z.record(z.string().min(1).max(128), z.string().max(4096)).refine(v => Object.keys(v).length > 0, 'Credentials cannot be empty');
const testSchema = z.object({ passportId: z.string().trim().min(1).max(255) }).strict();
function id(prefix: string) { return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`; }
function routeParam(value: string | string[] | undefined): string { return Array.isArray(value) ? value[0] || '' : value || ''; }
function providerFromParam(value: string): Provider { if (!PROVIDERS.has(value) || value === 'github') throw new Error('PROVIDER_NOT_SUPPORTED_BY_GENERIC_ADAPTER'); return value as Provider; }
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
      const provider = providerFromParam(routeParam(req.params.provider));
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

  return router;
}
