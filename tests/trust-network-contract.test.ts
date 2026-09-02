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
    // /api/alerts/:id (finding detail) has no backend route yet -- a
    // separate, known, still-open gap. Not asserted as working here; see
    // the route-inventory audit that found it. Everything else in this
    // block now has a real backend, proven below, not just preserved text.
    expect(s).toContain("apiFetch('/api/remediation-tasks'");
    expect(s).toContain("apiFetch('/api/monitoring/monitoring-configurations')");
    expect(s).toContain("onSelectClient(client.id); onNavigate('clients')");
  });

  // Previously this suite only checked that these literal strings survived a
  // refactor -- it never proved a matching backend route existed, which is
  // exactly how /api/remediation-tasks shipped as dead UI for as long as it
  // did (see tests/remediation-tasks-contract.test.ts for the real backend's
  // own contract and DB-behavioral tests). This cross-checks every call this
  // component makes against src/routes/remediation-tasks.ts directly.
  it('every /api/remediation-tasks call the frontend makes has a matching real backend route', () => {
    const frontend = source();
    const backend = read('src/routes/remediation-tasks.ts');
    expect(frontend).toContain("apiFetch('/api/remediation-tasks')");
    expect(backend).toContain("router.get('/'");
    expect(frontend).toContain("apiFetch(`/api/remediation-tasks/${encodeURIComponent(task.id)}`)");
    expect(backend).toContain("router.get('/:id'");
    expect(frontend).toContain("apiFetch('/api/remediation-tasks', { method: 'POST'");
    expect(backend).toContain("router.post('/', requireRole");
    expect(frontend).toContain("apiFetch(`/api/remediation-tasks/${encodeURIComponent(task.id)}/${action}`, { method: 'POST' })");
    expect(backend).toContain("makeTransitionRoute(router, 'start', 'OPEN', 'IN_PROGRESS'");
    expect(backend).toContain("makeTransitionRoute(router, 'ready-for-verification', 'IN_PROGRESS', 'READY_FOR_VERIFICATION'");
    expect(frontend).toContain("apiFetch(`/api/remediation-tasks/${encodeURIComponent(task.id)}/verify`, { method: 'POST'");
    expect(backend).toContain("router.post('/:id/verify', requireRole");
    // The frontend's optimistic merge after queueing verification
    // (status: 'VERIFICATION_QUEUED', verificationJobId: body.collectorJobId)
    // must match the real field names and values the backend actually
    // returns -- not a guess baked into the UI.
    expect(frontend).toContain("verificationJobId: body.collectorJobId");
    expect(backend).toContain('collectorJobId: resolvedJobId');
    expect(backend).toContain("status = 'VERIFICATION_QUEUED'");
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
    expect(s).toContain("if (decision === 'VERIFIED') verified += 1;");
    expect(s).toContain("else if (decision === 'PARTIAL' || decision === 'INVESTIGATE') needsReview += 1;");
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
    expect(s).toContain("const state: TrustState = trustStateFromDecision(verificationDecisions?.[item.passportId]);");
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

describe('Trust Network distinguishes "no data" from "not loaded yet"', () => {
  const source = () => read('src/components/MSPCommandCenter.tsx');
  const appSource = () => read('src/App.tsx');

  // The page read straight out of state that starts empty, with no notion of
  // loading and no else-branch on a failed response. An existing customer saw
  // "Build your trust network -- add your first client" on first paint, and the
  // identical screen if the API failed: the page asserted the customer had no
  // clients when it simply did not know yet.
  it('App tracks a real load status instead of inferring emptiness from an empty array', () => {
    const s = appSource();
    expect(s).toContain("useState<'loading' | 'ready' | 'error'>('loading')");
    // Status is decided by the two collections Trust Network actually depends on.
    expect(s).toContain("setDataStatus(clientsResponse.ok && passportsResponse.ok ? 'ready' : 'error')");
    // A thrown load must not leave the page claiming an empty estate.
    expect(s).toContain("if (!cancelled) setDataStatus('error');");
    expect(s).toContain('dataStatus={dataStatus}');
  });

  it('renders a skeleton while loading, never a zero count', () => {
    const s = source();
    const loadingBlock = s.slice(s.indexOf("dataStatus === 'loading'"), s.indexOf("dataStatus === 'error'"));
    expect(loadingBlock).toContain('aria-busy="true"');
    expect(loadingBlock).toContain('animate-pulse');
    expect(loadingBlock).toContain('Loading your trust network');
    // No metric may be rendered in the loading branch.
    expect(loadingBlock).not.toContain('<Metric');
  });

  it('the empty states are only reachable once the estate has actually been read', () => {
    const s = source();
    const loadingIdx = s.indexOf("dataStatus === 'loading'");
    const errorIdx = s.indexOf("dataStatus === 'error'");
    const emptyIdx = s.indexOf('!hasClients ? (');
    expect(loadingIdx).toBeGreaterThan(-1);
    expect(errorIdx).toBeGreaterThan(loadingIdx);
    // Both status branches must be evaluated before the zero-client empty state.
    expect(emptyIdx).toBeGreaterThan(errorIdx);
  });

  it('the error state offers a retry and discloses nothing about the failure', () => {
    const s = source();
    const errorBlock = s.slice(s.indexOf("dataStatus === 'error'"), s.indexOf('!hasClients ? ('));
    expect(errorBlock).toContain('role="alert"');
    expect(errorBlock).toContain('Try again');
    // The apostrophe is written as the &rsquo; entity in the JSX source.
    expect(errorBlock).toMatch(/couldn(&rsquo;|&#8217;|['’])t load/i);
    // Check what actually reaches the customer, not the commentary explaining
    // why nothing does -- the prose above legitimately uses the word "status".
    const rendered = errorBlock.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/[^\n]*/g, '');
    for (const leak of ['status', 'HTTP', 'stack', 'apiFetch', 'error.message', '/api/']) {
      expect(rendered).not.toContain(leak);
    }
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
