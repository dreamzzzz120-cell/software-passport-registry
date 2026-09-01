import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// The spr-worker service crash-looped in production on
//   [Worker] Fatal startup error: password authentication failed for user "spr_worker_runtime"
// while WORKER_DATABASE_URL and WORKER_RUNTIME_DB_PASSWORD agreed with each
// other in Railway. The passwords in Postgres had simply never been rotated to
// match, because scripts/provision-runtime-roles.ts is what performs that
// rotation and it had stopped running: railway.toml is Config as Code and
// overrides the dashboard's pre-deploy command, and it listed only the
// migration step. The dashboard's copy included the provisioner, which is why
// this looked configured to anyone reading the Railway UI.
const read = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

describe('runtime role provisioning survives a deploy', () => {
  it('runs the provisioner from railway.toml, not only from the dashboard', () => {
    const railwayConfig = read('railway.toml');
    expect(railwayConfig).toContain('dist/migrate.cjs');
    expect(railwayConfig).toContain('dist/provision-runtime-roles.cjs');
  });

  it('builds the provisioner into dist, so the pre-deploy command has something to run', () => {
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
