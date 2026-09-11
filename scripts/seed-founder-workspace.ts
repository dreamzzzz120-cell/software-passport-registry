/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Populates the founder's own workspace with real, observed data by queueing
 * the same jobs the product queues for any customer:
 *
 *   1. resolves the founder tenant from FOUNDER_EMAILS / SPR_INITIAL_OWNER_EMAIL;
 *   2. stores the founder's GitHub access token from the server environment
 *      (GITHUB_TOKEN) into that tenant's encrypted credential vault, exactly as
 *      Integrations -> GitHub -> Save does, so private repositories can be
 *      acquired with the tenant's own credential (the token is never printed);
 *   3. creates a client record for the founder's company if none exists;
 *   4. queues the repository scan + security scan for each owner/repo given,
 *      attached to that client. The workers create the passport from acquired
 *      metadata, generate the SBOM, query OSV, persist findings and evidence.
 *
 * It does NOT write scores, findings, evidence or reports itself. Reports are
 * generated afterwards by scripts/generate-founder-reports.ts once the scans
 * have completed.
 *
 * Run inside the app container:
 *   railway ssh --service spr-app-staging -- node dist/seed-founder-workspace.cjs dreamzzzz120-cell/software-passport-registry
 */
import crypto from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { appPool } from '../src/db/index.ts';
import * as schema from '../src/db/schema.ts';
import { encryptCredentials } from '../src/integrations/credential-vault.ts';

const COMPANY = { name: 'Software Passport Registry Ltd.', domain: 'softwarepassportregistry.com', industry: 'Software supply chain security' };
const id = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;

async function main() {
  const repos = process.argv.slice(2).filter((r) => /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(r));
  if (repos.length === 0) { console.error('usage: seed-founder-workspace.cjs <owner/repo> [...]'); process.exit(2); }
  const founderEmail = (process.env.FOUNDER_EMAILS || process.env.SPR_INITIAL_OWNER_EMAIL || '').split(',')[0].trim().toLowerCase();
  if (!founderEmail) throw new Error('FOUNDER_EMAILS / SPR_INITIAL_OWNER_EMAIL not set');
  const githubToken = process.env.GITHUB_TOKEN?.trim();

  const client = await appPool.connect();
  try {
    const user = (await client.query('SELECT id, uid, tenant_id FROM users WHERE lower(email) = $1 ORDER BY created_at ASC LIMIT 1', [founderEmail])).rows[0];
    if (!user) throw new Error(`no user row for ${founderEmail}`);
    const tenantId: string = user.tenant_id;
    console.log('founder tenant', tenantId);

    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const db = drizzle(client, { schema });

    // 2. tenant GitHub credential (skipped if one is already saved)
    const existingCred = (await db.execute(sql`SELECT id FROM integration_credentials WHERE tenant_id = ${tenantId} AND provider = 'github' LIMIT 1`) as any).rows?.[0];
    if (existingCred) console.log('github credential: already saved');
    else if (!githubToken) console.log('github credential: NOT saved (GITHUB_TOKEN not present in environment) -- private repositories will be refused');
    else {
      const encrypted = encryptCredentials({ accessToken: githubToken });
      await db.execute(sql`INSERT INTO integration_credentials (id, tenant_id, provider, encrypted_payload, key_version, status) VALUES (${id('cred')}, ${tenantId}, 'github', ${encrypted}, 1, 'CONFIGURED') ON CONFLICT (tenant_id, provider) DO UPDATE SET encrypted_payload = EXCLUDED.encrypted_payload, status = 'CONFIGURED', updated_at = CURRENT_TIMESTAMP`);
      console.log('github credential: saved to the tenant vault from the server environment');
    }

    // 3. company client
    let clientRow = (await db.execute(sql`SELECT id FROM clients WHERE tenant_id = ${tenantId} AND lower(name) = ${COMPANY.name.toLowerCase()} LIMIT 1`) as any).rows?.[0];
    if (!clientRow) {
      const clientId = id('client');
      await db.execute(sql`INSERT INTO clients (id, tenant_id, name, domain, industry, joined_date) VALUES (${clientId}, ${tenantId}, ${COMPANY.name}, ${COMPANY.domain}, ${COMPANY.industry}, ${new Date().toISOString().slice(0, 10)})`);
      clientRow = { id: clientId };
      console.log('client created', clientId);
    } else console.log('client exists', clientRow.id);

    // 4. scans, one passport per repository
    let connection = (await db.execute(sql`SELECT id FROM repository_connections WHERE tenant_id = ${tenantId} AND provider = 'github' AND status = 'Active' ORDER BY created_at ASC LIMIT 1`) as any).rows?.[0];
    if (!connection) {
      const connectionId = id('repo');
      await db.execute(sql`INSERT INTO repository_connections (id, tenant_id, provider, installation_id, label, access_mode, status) VALUES (${connectionId}, ${tenantId}, 'github', 'tenant-credential', 'GitHub (tenant credential)', 'private', 'Active')`);
      connection = { id: connectionId };
    }
    for (const full of repos) {
      const [owner, repository] = full.split('/');
      const already = (await db.execute(sql`SELECT j.id FROM agent_jobs j JOIN repository_scan_sources s ON s.job_id = j.id AND s.tenant_id = j.tenant_id WHERE j.tenant_id = ${tenantId} AND j.job_type = 'repository_scan' AND j.status IN ('Pending','Running','Completed') AND lower(s.repository_owner) = ${owner.toLowerCase()} AND lower(s.repository_name) = ${repository.toLowerCase()} LIMIT 1`) as any).rows?.[0];
      if (already) { console.log('skip (already queued or scanned)', full); continue; }
      const passportId = id('passport');
      const repositoryJobId = id('job');
      const securityJobId = id('job');
      // Passport row is created by the worker from acquired metadata, but the
      // client link must exist first so the passport lands in the right client.
      await db.execute(sql`INSERT INTO passports (id, tenant_id, client_id, name, version, publisher, category, overall_score, security_score, compliance_score, vendor_reputation_score, verification_status, release_date, file_hash, license_type, ai_summary, sbom, evidence, vulnerabilities, timeline) VALUES (${passportId}, ${tenantId}, ${clientRow.id}, ${full}, 'pending', ${owner}, 'Repository', NULL, NULL, NULL, NULL, 'unverified', CURRENT_DATE::text, 'not-observed', 'Unknown', 'Queued for repository acquisition; no evidence collected yet.', '[]', '[]', '[]', '[]')`);
      await db.execute(sql`INSERT INTO agent_jobs (id, tenant_id, agent_id, passport_id, job_type, status, progress, next_attempt_at, created_at, updated_at) VALUES (${repositoryJobId}, ${tenantId}, 'repository-worker', ${passportId}, 'repository_scan', 'Pending', 0, NOW(), NOW(), NOW()), (${securityJobId}, ${tenantId}, 'security-scanner', ${passportId}, 'repository_security_scan', 'Pending', 0, NOW(), NOW(), NOW())`);
      await db.execute(sql`INSERT INTO repository_scan_sources (id, job_id, tenant_id, connection_id, provider, repository_owner, repository_name, requested_ref, repository_subdirectory, scanner_configuration, created_at) VALUES (${id('source')}, ${repositoryJobId}, ${tenantId}, ${connection.id}, 'github', ${owner}, ${repository}, NULL, '', 'syft:1.49.0:cyclonedx-json+osv:v1', NOW())`);
      await db.execute(sql`INSERT INTO repository_scan_sources (id, job_id, tenant_id, connection_id, provider, repository_owner, repository_name, requested_ref, repository_subdirectory, scanner_configuration, created_at) VALUES (${id('source')}, ${securityJobId}, ${tenantId}, ${connection.id}, 'github', ${owner}, ${repository}, NULL, '', 'syft:1.49.0:cyclonedx-json+osv:v1', NOW())`);
      await db.execute(sql`INSERT INTO agent_logs (job_id, agent_id, message, level) VALUES (${repositoryJobId}, 'repository-worker', 'Queued GitHub acquisition + Syft SBOM + OSV dependency scan (tenant credential).', 'Info'), (${securityJobId}, 'security-scanner', 'Queued secret, IaC/configuration, license and OSV scan (tenant credential).', 'Info')`);
      console.log('queued', full, 'passport', passportId);
    }
    await db.execute(sql`INSERT INTO integrations (id, tenant_id, name, category, icon, connected, description, api_key_hint, last_sync_date) VALUES (${'int_' + crypto.createHash('sha256').update(`${tenantId}:github`).digest('hex').slice(0, 32)}, ${tenantId}, 'GitHub', 'DEVOPS', 'github', 1, 'Live repository evidence connector.', 'tenant-credential', ${new Date().toISOString()}) ON CONFLICT (id) DO UPDATE SET connected = 1, last_sync_date = EXCLUDED.last_sync_date`);
    await client.query('COMMIT');
    console.log('done');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await appPool.end().catch(() => undefined);
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
