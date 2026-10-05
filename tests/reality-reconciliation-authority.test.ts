import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('reality reconciliation repair authority', () => {
  it('autonomous worker executes only Class 0 or Class 1 repairs', () => {
    const source = read('src/workers/reality-reconciliation-worker.ts');
    expect(source).toContain('c.repair_class >= 0 && c.repair_class <= 1');
    expect(source).toContain('Repair requires explicit Owner approval; autonomous execution blocked by authority policy.');
    expect(source).toContain('Repair is Class 3 and may never execute autonomously; diagnosis only.');
    expect(source).not.toContain('(c?.repair_class ?? 0) >= 1');
  });

  it('founder repair endpoint blocks Class 3 execution', () => {
    const source = read('src/routes/founder-command-center.ts');
    expect(source).toContain("error: 'REPAIR_EXECUTION_FORBIDDEN'");
    expect(source).toContain("Class 3 incidents are diagnosis-only and may never execute a repair.");
  });

  it('founder repair endpoint validates authority before mutation', () => {
    const source = read('src/routes/founder-command-center.ts');
    const authorityCheck = source.indexOf("error: 'REPAIR_EXECUTION_FORBIDDEN'");
    const firstMutation = source.indexOf("UPDATE agent_jobs", authorityCheck);
    expect(authorityCheck).toBeGreaterThan(-1);
    expect(firstMutation).toBeGreaterThan(authorityCheck);
  });

  it('still requires reconciliation to prove a repair fixed the incident', () => {
    const source = read('src/routes/founder-command-center.ts');
    expect(source).toContain("status: 'VERIFYING'");
    expect(source).toContain("fixed: false");
    expect(source).toContain("verification: 'automatic_reconciliation'");
  });
});
