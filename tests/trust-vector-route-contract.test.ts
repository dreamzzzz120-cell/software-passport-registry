import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('trust-vector route schema contract', () => {
  it('reads remediation state from the canonical trust-loop work-item table', () => {
    const source = read('src/routes/trust-vector.ts');
    expect(source).toContain('FROM trust_remediation_work_items WHERE tenant_id=');
    expect(source).not.toContain('FROM remediation_tasks');
    expect(source).not.toContain('JOIN alerts a');
  });
});
