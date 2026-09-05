import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// The spr-worker service crash-looped in production on
//   [Worker] Fatal startup error: password authentication failed for user "spr_worker_runtime"
// while WORKER_DATABASE_URL and WORKER_RUNTIME_DB_PASSWORD agreed with each
// other in Railway. The password in Postgres had never been rotated to match,
// because scripts/provision-runtime-roles.ts performs that rotation and was
// never running.
//
// Two dead ends got there first, both worth pinning against:
//   1. "node dist/migrate.cjs && node dist/provision-runtime-roles.cjs" as a
//      single entry. Railway executes the entry directly, not through a shell,
//      so node received "&&" and the rest as extra argv and ignored them. The
//      migration ran, the provisioner did not, and the deploy went green.
//   2. Splitting it into two array entries. Railway rejects that outright:
//      "deploy.preDeployCommand: Too big: expected array to have <=1 items",
//      failing at SNAPSHOT_CODE before anything runs.
// One entry that invokes npm satisfies both constraints, because npm runs its
// script through a shell.
const read = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

const preDeployEntries = (railwayConfig: string): string[] => {
  const raw = /preDeployCommand\s*=\s*\[(.*)\]/.exec(railwayConfig)?.[1] ?? '';
  return raw.split(',').map(entry => entry.trim().replace(/^"|"$/g, '')).filter(Boolean);
};

describe('runtime role provisioning survives a deploy', () => {
  it('uses exactly one pre-deploy entry, since Railway rejects more than one', () => {
    expect(preDeployEntries(read('railway.toml'))).toHaveLength(1);
    expect(preDeployEntries(read('railway.worker.toml')).length).toBeLessThanOrEqual(1);
  });

  it('routes that entry through a shell instead of chaining with a bare &&', () => {
    const [entry] = preDeployEntries(read('railway.toml'));
    expect(entry).toBe('npm run release');
    // A bare "a && b" here never reaches a shell, so the second half is dropped.
    expect(entry).not.toContain('&&');
  });

  it('runs both the migration and the provisioner from the release script', () => {
    const packageJson = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(packageJson.scripts.release).toContain('dist/migrate.cjs');
    expect(packageJson.scripts.release).toContain('dist/provision-runtime-roles.cjs');
  });

  it('builds the provisioner into dist, so the release script has something to run', () => {
    const packageJson = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(packageJson.scripts.build).toContain('provision-runtime-roles.ts');
    expect(packageJson.scripts.build).toContain('dist/provision-runtime-roles.cjs');
  });

  it('still sets both runtime role passwords', () => {
    const provisioner = read('scripts/provision-runtime-roles.ts');
    // The implementation intentionally uses fixed role literals through a
    // typed helper rather than duplicating two ALTER ROLE statements. Assert
    // the security-relevant behavior without coupling the test to formatting.
    expect(provisioner).toContain("'spr_app_runtime'");
    expect(provisioner).toContain("'spr_worker_runtime'");
    expect(provisioner).toContain('WITH PASSWORD');
  });
});
