import crypto from 'node:crypto';
import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.ts';
import { requireAuth, AuthenticatedRequest } from '../middleware/security.ts';
import { INTEGRATION_CATALOG } from '../integrations/catalog.ts';

const githubScanSchema = z.object({
  passportId: z.string().trim().min(1).max(255),
  repositoryUrl: z.string().url().max(2048),
  ref: z.string().trim().max(255).optional(),
  subdirectory: z.string().trim().max(500).default(''),
}).strict();

function id(prefix: string) { return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`; }
function parseGitHubRepository(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') throw new Error('Only https://github.com repository URLs are supported by the GitHub connector.');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length !== 2) throw new Error('GitHub repository URL must be https://github.com/{owner}/{repository}.');
  const owner = parts[0];
  const repository = parts[1].replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(repository)) throw new Error('Invalid GitHub repository coordinates.');
  return { owner, repository };
}
function tenantIntegrationId(tenantId: string, provider: string) { return `int_${crypto.createHash('sha256').update(`${tenantId}:${provider}`).digest('hex').slice(0, 32)}`; }

export function createIntegrationsRouter() {
  const router = Router();

  router.get('/', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const tenantId = req.user!.tenantId;
      const result = await db.execute(sql`SELECT name, connected, api_key_hint, last_sync_date FROM integrations WHERE tenant_id = ${tenantId}`);
      const rows = new Map<string, any>((result as any).rows?.map((row: any) => [row.name, row]) ?? []);
      return res.json(INTEGRATION_CATALOG.map(item => {
        const row = rows.get(item.name);
        return {
          id: item.id, name: item.name, category: item.category, icon: item.icon, provider: item.provider,
          description: item.description, capability: item.capability, connected: Boolean(row?.connected),
          apiKeyHint: row?.api_key_hint ?? '', lastSyncDate: row?.last_sync_date ?? null,
        };
      }));
    } catch (error) { return next(error); }
  });

  /**
   * Queue the real GitHub repository evidence pipeline. A 202 means only that
   * the durable worker job was accepted; it is deliberately not a claim that
   * the repository is safe or that the scan has succeeded.
   */
  router.post('/github/repository-scan', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const parsed = githubScanSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      const tenantId = req.user!.tenantId;
      const { owner, repository } = parseGitHubRepository(parsed.data.repositoryUrl);
      const passportResult = await db.execute(sql`SELECT id FROM passports WHERE id = ${parsed.data.passportId} AND tenant_id = ${tenantId} LIMIT 1`);
      if (!((passportResult as any).rows?.length)) return res.status(404).json({ error: 'Passport not found for this tenant.' });

      const connectionId = id('repo');
      const jobId = id('job');
      const sourceId = id('source');
      const now = new Date().toISOString();

      await db.transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO repository_connections (id, tenant_id, provider, installation_id, label, access_mode, status)
          VALUES (${connectionId}, ${tenantId}, 'github', ${`${owner}/${repository}`}, ${`${owner}/${repository}`}, 'public', 'Active')
        `);
        await tx.execute(sql`
          INSERT INTO agent_jobs (id, tenant_id, agent_id, passport_id, job_type, status, progress, result, attempt_count, max_attempts, next_attempt_at, created_at, updated_at)
          VALUES (${jobId}, ${tenantId}, 'repository-worker', ${parsed.data.passportId}, 'repository_scan', 'Pending', 0, NULL, 0, 3, NOW(), NOW(), NOW())
        `);
        await tx.execute(sql`
          INSERT INTO repository_scan_sources
            (id, job_id, tenant_id, connection_id, provider, repository_owner, repository_name, requested_ref, repository_subdirectory, scanner_configuration)
          VALUES
            (${sourceId}, ${jobId}, ${tenantId}, ${connectionId}, 'github', ${owner}, ${repository}, ${parsed.data.ref ?? null}, ${parsed.data.subdirectory}, 'syft:1.49.0:cyclonedx-json+osv:v1')
        `);
        await tx.execute(sql`
          INSERT INTO integrations (id, tenant_id, name, category, icon, connected, description, api_key_hint, last_sync_date)
          VALUES (${tenantIntegrationId(tenantId, 'github')}, ${tenantId}, 'GitHub', 'DEVOPS', 'github', 1, 'Live repository evidence connector.', 'public-repository', ${now})
          ON CONFLICT (id) DO UPDATE SET connected = 1, last_sync_date = EXCLUDED.last_sync_date
        `);
      });

      return res.status(202).json({
        jobId, passportId: parsed.data.passportId, provider: 'github', repository: `${owner}/${repository}`,
        requestedRef: parsed.data.ref ?? null, state: 'queued',
        evidencePolicy: 'Only observed provider responses and scanner output become evidence; no trust score is synthesized by this endpoint.',
        queuedAt: now,
      });
    } catch (error) {
      if (error instanceof Error && /GitHub repository URL|Invalid GitHub repository/.test(error.message)) return res.status(400).json({ error: error.message });
      return next(error);
    }
  });

  return router;
}
