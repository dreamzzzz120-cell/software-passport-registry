import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('SPR white-label reporting and multi-client export contracts', () => {
  it('wires the previously orphaned generateCoBrandedTrustReport into a real UI panel', () => {
    const view = read('src/components/ReportsView.tsx');
    expect(view).toContain("import { generateCoBrandedTrustReport, generatePassportEvidenceReport } from '../utils/pdfGenerator'");
    expect(view).toContain('const generateWhiteLabelReport');
    expect(view).toContain('generateCoBrandedTrustReport(client, mspName.trim()');
  });

  it('filters CSV export to the selected client subset instead of always exporting every tenant record', () => {
    const view = read('src/components/ReportsView.tsx');
    expect(view).toContain('const clientFilter = exportClientIds.size > 0 ? exportClientIds : null');
    expect(view).toContain('const toggleExportClient');
  });
});
