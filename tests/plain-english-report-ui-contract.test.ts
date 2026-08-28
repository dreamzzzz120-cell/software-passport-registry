import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('PlainEnglishReport is wired into ReportsView from the same loaded passport/type', () => {
  it('ReportsView renders it only once a report has actually been loaded, using the same passport and report type', () => {
    const s = read('src/components/ReportsView.tsx');
    expect(s).toContain('{report && selectedPassport && (');
    expect(s).toContain('<PlainEnglishReport passportId={selectedPassport.id} reportType={reportType} />');
  });

  it('fetches the real plain-english endpoint, not a mocked or hardcoded payload', () => {
    const s = read('src/components/PlainEnglishReport.tsx');
    expect(s).toContain('/api/trust-loop/reports/${encodeURIComponent(passportId)}/plain-english?type=${encodeURIComponent(reportType)}');
  });

  it('never claims a numeric score when none exists', () => {
    const s = read('src/components/PlainEnglishReport.tsx');
    expect(s).toContain("data.scoreExplanation.value === null ? 'Not yet calculable' : data.scoreExplanation.value");
  });
});
