import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('public registry investigation handoff', () => {
  const registry = read('src/components/PublicRegistryView.tsx');
  const app = read('src/App.tsx');
  const scans = read('src/routes/scans.ts');
  const nav = read('src/components/CommandCenter.tsx');

  it('lets an authorized operator start a real GitHub investigation from a registry row', () => {
    expect(registry).toContain("apiFetch('/api/scans/submit'");
    expect(registry).toContain("source: 'github'");
    expect(registry).toContain('repository_owner');
    expect(registry).toContain('repository_name');
    expect(registry).toContain('Investigate → Launch Ticket');
  });

  it('opens the created Launch Ticket after submission', () => {
    expect(app).toContain('onInvestigationStarted');
    expect(app).toContain('setSelectedPassportId(passportId)');
    expect(app).toContain("navigate('/passports')");
  });

  it('does not duplicate an active repository investigation on retry', () => {
    expect(scans).toContain("source='github'");
    expect(scans).toContain("status IN ('Queued','Pending','Running','Processing')");
    expect(scans).toContain('existing: true');
    expect(scans).toContain('repositoryJobId');
    expect(scans).toContain('securityJobId');
  });

  it('uses Launch Ticket as the customer-facing navigation term', () => {
    expect(nav).toContain("label: 'Launch Tickets'");
    expect(nav).not.toContain("label: 'Passports'");
  });
});
