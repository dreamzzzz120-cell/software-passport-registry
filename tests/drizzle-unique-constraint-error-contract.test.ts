import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

// Real production defect, found via live adversarial testing: drizzle-orm's
// db.execute/db.insert wrap the real pg error in a DrizzleQueryError, so
// the actual Postgres error code lives at error.cause.code, not
// error.code. Every `error?.code === '23505'` check in this codebase
// checked the wrong property and never matched -- confirmed live by
// reproducing a duplicate-vendor-name insert through the real HTTP route
// and getting a raw 500 instead of the intended 409. The same bug broke
// the collector-job idempotency retry in monitoring.ts (it always
// rethrew instead of returning the existing job).
describe('unique-constraint (23505) handling checks both error.code and error.cause.code', () => {
  const checks = [
    { file: 'src/routes/vendors.ts', label: 'vendor creation duplicate name' },
    { file: 'src/routes/auth.ts', label: 'client creation duplicate domain' },
  ];

  for (const { file, label } of checks) {
    it(`${label} (${file})`, () => {
      const s = read(file);
      expect(s).toContain("error?.code === '23505' || error?.cause?.code === '23505'");
    });
  }

  it('monitoring configuration creation duplicate (src/routes/monitoring.ts)', () => {
    const s = read('src/routes/monitoring.ts');
    expect(s).toContain("if (error?.code === '23505' || error?.cause?.code === '23505') return res.status(409).json({ error: 'MONITORING_CONFIGURATION_EXISTS' });");
  });

  it('collector-job idempotency retry no longer always rethrows (src/routes/monitoring.ts)', () => {
    const s = read('src/routes/monitoring.ts');
    expect(s).toContain("if (error?.code !== '23505' && error?.cause?.code !== '23505') throw error;");
  });
});
