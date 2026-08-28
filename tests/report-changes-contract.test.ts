import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

// Executive/Client Portal's "changes since last report" was the one
// genuinely new piece needed (trust score, inventory, compliance status,
// and open risks were all already real across MSPCommandCenter, ClientsView,
// and ReportsView). It reuses compareCanonicalObservations/
// classifyCanonicalChange -- the exact machinery built for monitoring's
// change detection -- applied between two trust_report_snapshots rows
// instead of two trust_observations rows, since both store the identical
// shape (score, confidence/completeness basis points, finding ids).
describe('GET /trust-loop/reports/:passportId/changes', () => {
  const source = () => read('src/routes/trust-loop.ts');

  it('reuses the real change-detection functions instead of a new formula', () => {
    const s = source();
    expect(s).toContain("import { classifyCanonicalChange, compareCanonicalObservations } from '../utils/observation-history.ts';");
    expect(s).toContain('compareCanonicalObservations(comparable(previous), comparable(current)!)');
  });

  it('never claims a change when fewer than two snapshots exist -- flags insufficientData instead of fabricating a diff', () => {
    const s = source();
    expect(s).toContain('if (!current) return res.json({ insufficientData: true, current: null, previous: null, changes: [] });');
    expect(s).toContain('if (!previous) return res.json({ insufficientData: true, current, previous: null, changes: [] });');
  });

  it('is scoped to the caller\'s tenant and, for the Client role, their own client\'s passport', () => {
    const s = source();
    const routeStart = s.indexOf("router.get('/reports/:passportId/changes'");
    const routeBody = s.slice(routeStart, s.indexOf('router.get', routeStart + 10));
    expect(routeBody).toContain("const clientScope = req.user!.role === 'Client' ? req.user!.clientId : null;");
    expect(routeBody).toContain('AND (${clientScope}::text IS NULL OR client_id = ${clientScope})');
  });
});

describe('ReportsView surfaces changes since last report', () => {
  const source = () => read('src/components/ReportsView.tsx');

  it('loads changes automatically when a passport/report type is selected, not only after generating a report', () => {
    const s = source();
    expect(s).toContain("if (selectedPassportId) { void loadHistory(selectedPassportId); void loadChanges(selectedPassportId); }");
  });

  it('distinguishes "no change" from "not enough data yet" instead of collapsing them into one empty state', () => {
    const s = source();
    expect(s).toContain('changes?.insufficientData');
    expect(s).toContain('No change since the last report');
  });
});
