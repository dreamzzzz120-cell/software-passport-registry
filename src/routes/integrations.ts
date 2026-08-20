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

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

function parseGitHubRepository(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') {
    throw new Error('Only https://github.com repository URLs are supported by the GitHub connector.');
  }
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length !== 2) throw new Error('GitHub repository URL must be https://github.com/{owner}/{repository}.');
  const owner = parts[0];
  const repository = parts[1].replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(repository)) {
    throw new Error('Invalid GitHub repository coordinates.');
  }
  return { owner, repository };
}

export function createIntegrationsRouter() {
  const router = Router();

  router.get('/', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const tenantId = req.user!.tenantId;
      const result = await db.execute(sql`
        SELECT id, name, category, icon, connected, description, api_key_hint, last_sync_date
        FROM integrations
        WHERE tenant_id = ${tenantId}
        ORDER BY name ASC
      `);
      const rows = new Map<string, any>((result as any).rows?.map((row: any) => [row.id, row]) ?? []);
      const response = INTEGRATION_CATALOG.map((item) => {
        const row = rows.get(item.id);
        return {
          id: item.id,
          name: item.name,
          category: item.category,
          icon: item.icon,
          provider: item.provider,
          description: item.description,
          capability: item.capability,
          connected: Boolean(row?.connected),
          apiKeyHint: row?.api_key_hint ?? '',
          lastSyncDate: row?.last_sync_date ?? null,
        };
      });
      return res.json(response);
    } catch (error) {
      return next(error);
    }
  });

  /**
   * Start the real GitHub repository evidence pipeline. This endpoint does not
   * claim that the scan succeeded; it creates a durable worker job. The worker
   * later resolves the ref, downloads the archive, runs Syft, persists evidence,
   * and queries OSV.
   */
  router.post('/github/repository-scan', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const parsed = githubScanSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      const tenantId = req.user!.tenantId;
      const { owner, repository } = parseGitHubRepository(parsed.data.repositoryUrl);

      const passportResult = await db.execute(sql`
        SELECT id, name, version
        FROM passports
        WHERE id = ${parsed.data.passportId} AND tenant_id = ${tenantId}
        LIMIT 1
      `);
      const passport = (passportResult as any).rows?.[0];
      if (!passport) return res.status(404).json({ error: 'Passport not found for this tenant.' });

      const connectionId = id('repo');
      const jobId = id('job');
      const now = new Date().toISOString();
      const idempotencyKey = `github:${tenantId}:${owner}:${repository}:${parsed.data.ref || 'default'}:${parsed.data.subdirectory}`;

      await db.transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO repository_connections
            (id, tenant_id, provider, installation_id, label, access_mode, status)
          VALUES
            (${connectionId}, ${tenantId}, 'github', ${`${owner}/${repository}`}, ${`${owner}/${repository}`}, 'public', 'Active')
        `);

        await tx.execute(sql`
          INSERT INTO agent_jobs
            (id, tenant_id, agent_id, passport_id, job_type, status, progress, result, attempt_count, max_attempts, next_attempt_at, created_at, updated_at)
          VALUES
            (${jobId}, ${tenantId}, 'repository-worker', ${parsed.data.passportId}, 'repository_scan', 'Pending', 0, NULL, 0, 3, NOW(), NOW(), NOW())
        `);

        await tx.execute(sql`
          INSERT INTO repository_scan_sources
            (id, job_id, tenant_id, connection_id, provider, repository_owner, repository_name, requested_ref, repository_subdirectory, scanner_configuration)
          VALUES
            (${id('source')}, ${jobId}, ${tenantId}, ${connectionId}, 'github', ${owner}, ${repository}, ${parsed.data.ref ?? null}, ${parsed.data.subdirectory}, 'syft:1.49.0:cyclonedx-json+osv:v1')
        `);
      });

      return res.status(202).json({
        jobId,
        passportId: parsed.data.passportId,
        provider: 'github',
        repository: `${owner}/${repository}`,
        requestedRef: parsed.data.ref ?? null,
        state: 'queued',
        evidencePolicy: 'Only observed provider responses and scanner output become evidence; no trust score is synthesized by this endpoint.',
        queuedAt: now,
      });
    } catch (error) {
      if (error instanceof Error && /GitHub repository URL|Invalid GitHub repository/.test(error.message)) {
        return res.status(400).json({ error: error.message });
      }
      return next(error);
    }
  });

  return router;
}
