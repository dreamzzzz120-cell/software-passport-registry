import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/components/SoftwareLineageTracker.tsx'), 'utf8');

describe('software lineage evidence boundaries', () => {
  it('requires an explicit passport id to associate assets and blast-radius hosts', () => {
    expect(source.match(/String\(a\.passportId \?\? ''\) === (activePassport|p)\.id/g)).toHaveLength(2);
    expect(source).not.toContain('aPassport.includes');
    expect(source).not.toContain('pName.includes');
  });

  it('does not invent customer usage or revenue impact from a product name', () => {
    expect(source).not.toContain('35 employees in sales');
    expect(source).not.toContain('120 active employees');
    expect(source).not.toContain('40% of daily transactions');
    expect(source).toContain('Usage and business impact remain unknown.');
  });
});
