import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  toJsonArrayColumn,
  normalizeClientRecord,
  normalizeClientRecords,
  CLIENT_JSON_ARRAY_FIELDS,
} from '../src/lib/clientJsonColumns.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

// Regression tests for the production crash surfaced by the view error
// boundary:  TypeError: (D.softwareInventory || []).some is not a function
//
// clients.software_inventory (and its three sibling columns) are
// JSON-stringified TEXT columns, but the API aliased them straight through,
// so the browser received strings while src/types.ts declared arrays.
const REAL_INVENTORY = [
  { passportId: 'passport_a', name: 'nginx', version: '1.25.3', overallScore: 91, riskStatus: 'Safe', lastScanDate: '2026-08-01' },
  { passportId: 'passport_b', name: 'redis', version: '7.2.4', overallScore: 74, riskStatus: 'Warning', lastScanDate: '2026-08-02' },
];

describe('toJsonArrayColumn', () => {
  it('valid array passes through unchanged', () => {
    expect(toJsonArrayColumn(REAL_INVENTORY)).toEqual(REAL_INVENTORY);
  });

  it('empty array stays empty', () => {
    expect(toJsonArrayColumn([])).toEqual([]);
  });

  it('null becomes an empty array', () => {
    expect(toJsonArrayColumn(null)).toEqual([]);
  });

  it('undefined becomes an empty array', () => {
    expect(toJsonArrayColumn(undefined)).toEqual([]);
  });

  it("the column default '[]' becomes a real empty array, not a 2-char string", () => {
    const result = toJsonArrayColumn('[]');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
    // The precise bug: '[]'.length === 2 made empty inventories report as 2.
    expect(result.length).not.toBe('[]'.length);
  });

  it('JSON-stringified array is parsed back into real entries', () => {
    const result = toJsonArrayColumn(JSON.stringify(REAL_INVENTORY));
    expect(result).toEqual(REAL_INVENTORY);
    expect(Array.isArray(result)).toBe(true);
  });

  it('a single legacy object is preserved as one entry rather than discarded', () => {
    expect(toJsonArrayColumn(JSON.stringify(REAL_INVENTORY[0]))).toEqual([REAL_INVENTORY[0]]);
    expect(toJsonArrayColumn(REAL_INVENTORY[0])).toEqual([REAL_INVENTORY[0]]);
  });

  it('malformed and meaningless values become empty, never fabricated data', () => {
    for (const bad of ['not json at all', '{oops', '', '   ', '42', 'true', '"a string"', '{}', 42, true, Symbol('x')]) {
      const result = toJsonArrayColumn(bad as unknown);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(0);
    }
  });

  it('is idempotent, so applying it at both API and browser boundaries is safe', () => {
    const once = toJsonArrayColumn(JSON.stringify(REAL_INVENTORY));
    expect(toJsonArrayColumn(once)).toEqual(once);
  });

  it('always returns something every array method can be called on', () => {
    for (const input of [null, undefined, '[]', '{}', 'garbage', JSON.stringify(REAL_INVENTORY), REAL_INVENTORY, 7]) {
      const result = toJsonArrayColumn(input as unknown);
      // The exact operations the crashing call sites perform.
      expect(() => result.some((x: any) => x?.passportId === 'passport_a')).not.toThrow();
      expect(() => result.map((x: any) => x)).not.toThrow();
      expect(() => result.filter(Boolean)).not.toThrow();
      expect(() => result.find(Boolean)).not.toThrow();
      expect(() => [...result]).not.toThrow();
      expect(typeof result.length).toBe('number');
    }
  });
});

describe('normalizeClientRecord', () => {
  it('coerces all four JSON columns on a realistic raw database row', () => {
    const raw = {
      id: 'client_1', name: 'Acme', domain: 'acme.test', industry: 'Tech',
      softwareInventory: JSON.stringify(REAL_INVENTORY),
      complianceStatus: '[]',
      teamMembers: JSON.stringify([{ name: 'A', email: 'a@acme.test' }]),
      activityTimeline: null,
    };
    const normalized = normalizeClientRecord(raw);
    for (const field of CLIENT_JSON_ARRAY_FIELDS) {
      expect(Array.isArray((normalized as any)[field])).toBe(true);
    }
    expect(normalized.softwareInventory).toEqual(REAL_INVENTORY);
    expect(normalized.complianceStatus).toEqual([]);
    expect(normalized.teamMembers).toHaveLength(1);
    expect(normalized.activityTimeline).toEqual([]);
    // Non-JSON fields are untouched.
    expect(normalized.id).toBe('client_1');
    expect(normalized.name).toBe('Acme');
  });

  it('reproduces the exact crashing expression safely', () => {
    const clients = normalizeClientRecords([
      { id: 'c1', softwareInventory: JSON.stringify(REAL_INVENTORY) },
      { id: 'c2', softwareInventory: '[]' },
      { id: 'c3', softwareInventory: null },
    ]);
    // PassportsView.tsx: clients.find((c) => (c.softwareInventory || []).some(...))
    expect(() =>
      clients.find((c: any) => (c.softwareInventory || []).some((item: any) => item.passportId === 'passport_a')),
    ).not.toThrow();
    const owner = clients.find((c: any) => (c.softwareInventory || []).some((item: any) => item.passportId === 'passport_a'));
    expect(owner?.id).toBe('c1');
  });

  it('does not mutate the input row', () => {
    const raw = { id: 'c1', softwareInventory: '[]' };
    normalizeClientRecord(raw);
    expect(raw.softwareInventory).toBe('[]');
  });

  it('normalizeClientRecords tolerates a non-array payload', () => {
    expect(normalizeClientRecords(null)).toEqual([]);
    expect(normalizeClientRecords({ clients: [] } as unknown)).toEqual([]);
  });
});

describe('the normalization is wired into every production path', () => {
  it('the clients list and create endpoints both normalize before responding', () => {
    const source = read('src/routes/auth.ts');
    expect(source).toContain("from '../lib/clientJsonColumns.ts'");
    expect(source).toContain('normalizeClientRecords((result as any).rows || [])');
    expect(source).toContain('normalizeClientRecord(row)');
  });

  it('the browser normalizes clients on receipt as defence in depth', () => {
    const source = read('src/App.tsx');
    expect(source).toContain('normalizeClientRecord({ ...row');
  });

  it('a locally constructed client is normalized too', () => {
    const source = read('src/components/ClientsView.tsx');
    expect(source).toContain('softwareInventory: toJsonArrayColumn(data.softwareInventory)');
    expect(source).toContain('complianceStatus: toJsonArrayColumn(data.complianceStatus)');
    expect(source).toContain('teamMembers: toJsonArrayColumn(data.teamMembers)');
    expect(source).toContain('activityTimeline: toJsonArrayColumn(data.activityTimeline)');
  });

  it('the view error boundary is retained as the final safety net', () => {
    expect(read('src/App.tsx')).toContain('<ViewErrorBoundary routeKey={path}>');
    expect(fs.existsSync(path.join(root, 'src/components/ViewErrorBoundary.tsx'))).toBe(true);
  });
});
