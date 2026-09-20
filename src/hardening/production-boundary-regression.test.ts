import { describe, expect, it } from 'vitest';
import {
  computeCoverage,
  finalizeDispositions,
  newEntry,
  type CoverageRow,
  type InventoryEntry,
} from '../scanners/file-inventory.ts';

describe('production file-accounting invariants', () => {
  it('never leaves a discovered file unaccounted when finalization runs', () => {
    const entries = [
      newEntry(0, 'src/main.ts', 'github-archive', null, 0),
      newEntry(1, 'assets/blob.bin', 'github-archive', null, 0),
      newEntry(2, 'docs/readme.md', 'github-archive', null, 0),
    ];
    finalizeDispositions(entries, {
      contentUnsupportedReason: entry => entry.category === 'binary' ? 'NO_BINARY_CONTENT_ENGINE' : null,
      contentInspectionRan: true,
    });
    expect(entries.every(entry => entry.disposition !== 'discovered')).toBe(true);
    expect(entries.map(entry => entry.disposition)).toEqual(['unknown', 'unsupported', 'unknown']);
  });

  it('keeps explicit failures instead of allowing later policy outcomes to erase them', () => {
    const entry = newEntry(0, 'src/main.ts', 'github-archive', null, 0);
    entry.disposition = 'failed';
    entry.reasonCode = 'READ_FAILED';
    finalizeDispositions([entry], {
      contentUnsupportedReason: () => null,
      contentInspectionRan: true,
    });
    expect(entry.disposition).toBe('failed');
    expect(entry.reasonCode).toBe('READ_FAILED');
  });

  it('reports incomplete discovery as a lower-bound inventory, never as 100 percent coverage', () => {
    const rows: CoverageRow[] = [
      {
        disposition: 'inventoried',
        inspectionStatus: 'not_inspected',
        analysisStatus: 'not_analyzed',
        category: 'source_code',
        source: 'github-archive',
        isArchive: false,
        archiveEnumerated: null,
        hasFindings: false,
        hasEvidence: false,
      },
    ];
    const coverage = computeCoverage(rows, { inventoryComplete: false });
    expect(coverage.inventoryComplete).toBe(false);
    expect(coverage.accountingCoveragePct).toBeLessThan(100);
    expect(coverage.limitations.some(value => value.startsWith('INVENTORY_TRUNCATED'))).toBe(true);
  });
});
