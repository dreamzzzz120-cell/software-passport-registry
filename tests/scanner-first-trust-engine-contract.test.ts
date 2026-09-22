import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('scanner-first trust engine contracts', () => {
  it('keeps the scanner as the value-producing entry point and the registry as an observed output', () => {
    const home = read('src/components/HomePage.tsx');
    expect(home).toContain('Scanner-first trust engine');
    expect(home).toContain('Scan the software first. Build the registry from evidence.');
    expect(home).toContain('UNKNOWN is preserved.');
    expect(home).not.toContain('vendor-supplied');
  });

  it('uses one repository submission path for public and authenticated scans', () => {
    const submit = read('src/routes/free-review-submit.ts');
    const scanner = read('src/scanners/scan-submission.ts');
    const legacy = read('src/routes/free-review-legacy.ts');

    expect(submit).toContain('enqueueRepositoryScan(scopedDb');
    expect(scanner).toContain('export async function enqueueRepositoryScan');
    expect(scanner).toContain("'repository_scan'");
    expect(scanner).toContain("'repository_security_scan'");
    expect(legacy).toContain('enqueueFreeReview(scopedDb');
  });

  it('defends the queue boundary even when a caller bypasses HTTP validation', () => {
    const scanner = read('src/scanners/scan-submission.ts');
    expect(scanner).toContain('const GITHUB_NAME =');
    expect(scanner).toContain('const GITHUB_REF =');
    expect(scanner).toContain('const SAFE_SUBDIRECTORY =');
    expect(scanner).toContain('assertRepositorySubmission(input);');
    expect(scanner).toContain("throw new Error('REPOSITORY_INPUT_INVALID')");
    expect(scanner).toContain("throw new Error('REPOSITORY_REF_INVALID')");
    expect(scanner).toContain("throw new Error('REPOSITORY_SUBDIRECTORY_INVALID')");
  });

  it('preserves evidence-first failure semantics in the public review', () => {
    const route = read('src/routes/free-review-legacy.ts');
    expect(route).toContain("succeeded.length === 0");
    expect(route).toContain("scanStatus = pending");
    expect(route).toContain('No evidence was collected');
    expect(route).toContain('nothing here should be read as a clean review');
  });

  it('keeps the scanner hardening aligned with the existing file-accounting model', () => {
    const inventory = read('src/scanners/repository-inventory.ts');
    expect(inventory).toContain('unsupported');
    expect(inventory).toContain('skipped');
    expect(inventory).toContain('failed');
    expect(inventory).toContain('analyzed');
    expect(inventory).toContain('finalizeDispositions');
  });
});
