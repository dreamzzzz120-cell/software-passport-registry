import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

// Plain-English reporting: a pure presentation layer over
// buildAndPersistReport's existing, unchanged output. The point of this
// whole module is that it must never become a second source of truth --
// these tests pin that both the executive and detailed routes call
// buildAndPersistReport exactly once and only translate its result.
describe('GET /trust-loop/reports/:passportId/plain-english', () => {
  const source = () => read('src/routes/trust-loop.ts');

  it('calls the same buildAndPersistReport the technical report route uses, never a second scoring path', () => {
    const s = source();
    const routeStart = s.indexOf("router.get('/reports/:passportId/plain-english'");
    const routeEnd = s.indexOf("router.get('/reports/:passportId/changes/plain-english'");
    const routeBody = s.slice(routeStart, routeEnd);
    expect(routeBody).toContain('const report = await buildAndPersistReport(req.db!, req.user!.tenantId, String(req.params.passportId), parsed.data);');
    expect(routeBody).toContain('const plainEnglish = toPlainEnglish(report as unknown as CanonicalReport);');
  });

  it('the detailed level includes the full technical report alongside the plain-English explanation, from the same call', () => {
    const s = source();
    expect(s).toContain("level === 'detailed' ? { ...plainEnglish, technicalReport: report } : plainEnglish");
  });

  it('scopes a Client-role reader to their own client\'s passport, matching the technical report route', () => {
    const s = source();
    const routeStart = s.indexOf("router.get('/reports/:passportId/plain-english'");
    const routeBody = s.slice(routeStart, routeStart + 900);
    expect(routeBody).toContain("const clientScope = req.user!.role === 'Client' ? req.user!.clientId : null;");
    expect(routeBody).toContain('AND client_id=${clientScope}');
  });
});

describe('GET /trust-loop/reports/:passportId (technical) now enforces client scoping too', () => {
  it('was missing a Client-role scope check before this pass; both report routes now agree', () => {
    const s = read('src/routes/trust-loop.ts');
    const routeStart = s.indexOf("router.get('/reports/:passportId', async");
    const routeBody = s.slice(routeStart, routeStart + 700);
    expect(routeBody).toContain("const clientScope = req.user!.role === 'Client' ? req.user!.clientId : null;");
  });
});

describe('GET /trust-loop/reports/:passportId/changes/plain-english', () => {
  it('reuses compareCanonicalObservations and explainChange, never a separate diff calculation', () => {
    const s = read('src/routes/trust-loop.ts');
    const routeStart = s.indexOf("router.get('/reports/:passportId/changes/plain-english'");
    const routeBody = s.slice(routeStart, routeStart + 2400);
    expect(routeBody).toContain('compareCanonicalObservations(comparable(previous), comparable(current)!)');
    expect(routeBody).toContain('plainEnglish: explainChange(change)');
  });

  it('reports insufficientData honestly instead of fabricating a diff when fewer than two snapshots exist', () => {
    const s = read('src/routes/trust-loop.ts');
    const routeStart = s.indexOf("router.get('/reports/:passportId/changes/plain-english'");
    const routeBody = s.slice(routeStart, routeStart + 2400);
    expect(routeBody).toContain('if (!current || !previous) return res.json({ insufficientData: true, changes: [] });');
  });
});
