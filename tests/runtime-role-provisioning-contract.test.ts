import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// The spr-worker service crash-looped in production on
//   [Worker] Fatal startup error: password authentication failed for user "spr_worker_runtime"
// while WORKER_DATABASE_URL and WORKER_RUNTIME_DB_PASSWORD agreed with each
// other in Railway. The passwords in Postgres had never been rotated to match,
// because scripts/provision-runtime-roles.ts performs that rotation and was
// never actually running: railway.toml chained it onto the migration with
// "&&" inside a single pre-deploy entry, and Railway runs each entry directly
// rather than through a shell. node took the "&&" and everything after it as
// extra argv and ignored it, so the migration ran, the provisioner did not, and
// the deploy reported success with nothing in the log to show for it.
const read = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

describe('runtime role provisioning survives a deploy', () => {
  it('gives the provisioner its own pre-deploy entry instead of a shell chain', () => {
    const railwayConfig = read('railway.toml');
    const preDeploy = /preDeployCommand\s*=\s*\[(.*)\]/.exec(railwayConfig)?.[1] ?? '';
    expect(preDeploy).toContain('dist/migrate.cjs');
    expect(preDeploy).toContain('dist/provision-runtime-roles.cjs');
    // The failure mode this pins: a shell operator in an entry that never
    // reaches a shell.
    expect(preDeploy).not.toContain('&&');
    expect(preDeploy.split(',')).toHaveLength(2);
  });

  it('builds the provisioner into dist, so the pre-deploy entry has something to run', () => {
    const packageJson = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(packageJson.scripts.build).toContain('provision-runtime-roles.ts');
    expect(packageJson.scripts.build).toContain('dist/provision-runtime-roles.cjs');
  });

  it('still sets both runtime role passwords, not just the app one', () => {
    const provisioner = read('scripts/provision-runtime-roles.ts');
    expect(provisioner).toContain('ALTER ROLE spr_app_runtime WITH PASSWORD');
    expect(provisioner).toContain('ALTER ROLE spr_worker_runtime WITH PASSWORD');
  });
});
