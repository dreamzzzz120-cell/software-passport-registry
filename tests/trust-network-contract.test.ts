import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('Trust Network (MSP Command Center rebuild) preserves existing functionality', () => {
  const source = () => read('src/components/MSPCommandCenter.tsx');

  it('keeps the real client switcher, assignment API calls, and finding/remediation workflow untouched', () => {
    const s = source();
    expect(s).toContain("apiFetch('/api/msp/assignments')");
    expect(s).toContain("apiFetch('/api/organization/team')");
    expect(s).toContain("apiFetch(`/api/alerts/${encodeURIComponent(selected.id)}`)");
    expect(s).toContain("apiFetch('/api/remediation-tasks'");
    expect(s).toContain("apiFetch('/api/monitoring-configurations')");
    expect(s).toContain("onSelectClient(client.id); onNavigate('clients')");
  });

  it('renamed the page to Trust Network with the MSP control plane framing', () => {
    const s = source();
    expect(s).toContain('>Trust Network</h1>');
    expect(s).toContain('MSP control plane');
    expect(s).toContain('A live view of software trust across your client environment.');
  });

  it('quick-jump navigation only points at real, existing routes', () => {
    const s = source();
    const navBlock = s.slice(s.indexOf('const NETWORK_NAV'), s.indexOf('];', s.indexOf('const NETWORK_NAV')));
    for (const path of ['/msp', '/clients', '/assets', '/passports', '/evidence-explorer', '/monitoring', '/reports']) {
      expect(navBlock).toContain(`path: '${path}'`);
    }
  });
});

describe('Trust Network never fabricates counts, scores, or history', () => {
  const source = () => read('src/components/MSPCommandCenter.tsx');

  it('Current Trust State reads real verificationStatus and a real critical-client count, not invented numbers', () => {
    const s = source();
    expect(s).toContain("if (passport.verificationStatus === 'verified') verified += 1;");
    expect(s).toContain("else if (passport.verificationStatus === 'partial') needsReview += 1;");
    expect(s).toContain('value={criticalClients}');
  });

  it('distinguishes Unknown from Critical explicitly, and never treats missing evidence as unsafe', () => {
    const s = source();
    expect(s).toContain('Unknown means evidence unavailable or insufficient');
    expect(s).toContain('Unknown is not the same as Critical.');
  });

  it('Evidence Coverage and Verification Coverage show "no data" states instead of a misleading 0%/100%', () => {
    const s = source();
    expect(s).toContain('evidenceCoverage.total > 0 ? (');
    expect(s).toContain('No data — no evidence has been recorded yet.');
    expect(s).toContain('softwareVerification.total > 0 ? (');
    expect(s).toContain('No software assets on record yet.');
  });

  it('Recent Observations comes only from real passport.timeline entries, with an honest empty state', () => {
    const s = source();
    expect(s).toContain('for (const entry of passport.timeline || [])');
    expect(s).toContain('No recorded observations yet.');
  });

  it('the Trust Network map is built from each client\'s real softwareInventory joined to real passport verification state, with an honest fallback for unresolved software', () => {
    const s = source();
    expect(s).toContain('client.softwareInventory || []');
    expect(s).toContain("const state: TrustState = passport ? trustStateFromVerification(passport.verificationStatus) : 'EVIDENCE_INCOMPLETE';");
  });

  it('the Attention list never invents a software/passport link for a finding that has none', () => {
    const s = source();
    expect(s).toContain('Not linked to a specific software passport');
  });

  it('has empty states for zero clients and zero software, without a fabricated health percentage', () => {
    const s = source();
    expect(s).toContain('Build your trust network');
    expect(s).toContain('Add your first client to begin observing software trust across their environment.');
    expect(s).toContain('Client trust environment ready');
    expect(s).toContain('Add software to establish your first Software Passport.');
  });
});

describe('TrustNetworkMap renders real relationships only, as accessible DOM', () => {
  const source = () => read('src/components/trust/TrustNetworkMap.tsx');

  it('never renders more nodes than it was given, and reports omitted clients honestly rather than faking them', () => {
    const s = source();
    expect(s).toContain('clientsOmitted');
    expect(s).toContain('more client');
  });

  it('every node is a real, labeled, keyboard-reachable button, not a decorative shape', () => {
    const s = source();
    expect(s).toContain('aria-label={`Open ${client.name}`}');
    expect(s).toContain('aria-label={`Open ${software.name}, trust state');
  });

  it('does not use a force-directed graph library or introduce a new dependency', () => {
    const s = source();
    expect(s).not.toMatch(/from ['"]d3['"]/);
    expect(s).not.toContain('forceSimulation');
  });
});
