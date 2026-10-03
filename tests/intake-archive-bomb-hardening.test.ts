import { describe, expect, it } from 'vitest';
import { parseDeclaredSizes } from '../src/workers/intake-scan-worker.ts';

describe('intake archive bomb preflight', () => {
  it('sums ZIP member counts and declared expanded bytes', () => {
    const listing = [
      'Archive: bundle.zip',
      '  Length      Date    Time    Name',
      '---------  ---------- -----   ----',
      ' 104857600  2026-10-01 12:00   payload/a.bin',
      ' 104857601  2026-10-01 12:00   payload/b.bin',
      '        12  2026-10-01 12:00   payload/readme.txt',
    ].join('\n');
    expect(parseDeclaredSizes('zip', listing)).toEqual({ entries: 3, bytes: 209715213 });
  });

  it('does not count directory entries as extracted files', () => {
    const listing = [
      '        0  2026-10-01 12:00   payload/',
      '       10  2026-10-01 12:00   payload/a.txt',
    ].join('\n');
    expect(parseDeclaredSizes('zip', listing)).toEqual({ entries: 1, bytes: 10 });
  });

  it('fails closed to unknown when listing output cannot be parsed', () => {
    expect(parseDeclaredSizes('zip', 'not a valid archive listing')).toBeNull();
    expect(parseDeclaredSizes('tar', 'not a valid archive listing')).toBeNull();
  });
});
