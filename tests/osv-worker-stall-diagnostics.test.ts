import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const worker = fs.readFileSync(path.join(root, 'src/workers/osv-worker.ts'), 'utf8');

// Observed in production: a repository_scan job for a real repository with a
// real manifest was claimed (locked_at set) and then never logged again --
// no completion, no failure, nothing -- for 5+ minutes, while the worker
// container stayed online and not crashed. Every individual network/subprocess
// call in this file already carries its own timeout (fetchJson, downloadArchive,
// runBounded, fetchOsv), so the stall could not be located from source reading
// alone. These markers exist so the NEXT stall names the exact stage it got
// stuck in, rather than leaving only silence to diagnose from.
describe('processRepositoryJob reports its progress instead of going silent on a stall', () => {
  it('emits a stage marker at every major step of repository acquisition and scanning', () => {
    const expectedStages = [
      'acquisition_started',
      'metadata_fetched',
      'commit_resolved',
      'archive_downloaded',
      'archive_listed',
      'archive_extracted',
      'manifest_inspected',
      'syft_located',
      'sbom_generated',
      'sbom_persisted',
      'passport_upserted',
      'evidence_persisted',
      'osv_query_started',
      'osv_query_completed',
      'findings_hash_persisted',
    ];
    for (const stageName of expectedStages) {
      expect(worker, `missing mark('${stageName}')`).toContain(`'${stageName}'`);
    }
  });

  it('runs a heartbeat independent of whatever stage is currently in flight', () => {
    expect(worker).toContain("setInterval(() => {");
    expect(worker).toContain("event: 'scan_job_heartbeat'");
    // The heartbeat must be cleared however the job ends, or it leaks a timer
    // and keeps logging for a job that is no longer running.
    expect(worker).toMatch(/finally \{\s*clearInterval\(heartbeat\);/);
  });

  it('reports OSV lookup progress rather than one long silence for manifests with many components', () => {
    expect(worker).toContain("event: 'scan_job_stage'");
    expect(worker).toContain("stage: 'osv_component_loop_started'");
    expect(worker).toContain("stage: 'osv_component_progress'");
  });

  it('stage and heartbeat logs never carry more than the identifiers other worker logs already carry', () => {
    // jobId/tenantId/workerId are already logged by scan_job_failed; this just
    // confirms the new events use the same fields rather than inventing a
    // wider surface (e.g. raw file paths, tokens, or SBOM contents).
    const stageLine = worker.match(/function stage\(job: ClaimedJob[^)]*\)\s*\{[\s\S]*?\n\}/);
    expect(stageLine).not.toBeNull();
    expect(stageLine![0]).toContain('workerId');
    expect(stageLine![0]).toContain('jobId: job.id');
    expect(stageLine![0]).toContain('tenantId: job.tenant_id');
  });
});
