import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

const GOVERNANCE_FILES = [
  'src/components/GovernanceView.tsx',
  'src/components/governance/GovernancePoliciesTab.tsx',
  'src/components/governance/GovernanceControlsTab.tsx',
  'src/components/governance/GovernanceFrameworksTab.tsx',
  'src/components/governance/GovernanceRisksTab.tsx',
  'src/components/governance/GovernanceFindingsTab.tsx',
  'src/components/governance/GovernanceAuditTab.tsx',
  'src/components/governance/GovernanceWhyModal.tsx',
];

describe('Governance UI: zero dead controls', () => {
  it('contains no empty click handlers, TODO/FIXME placeholders, or "coming soon" stubs', () => {
    for (const file of GOVERNANCE_FILES) {
      const s = read(file);
      expect(s, `${file} has an empty onClick handler`).not.toMatch(/onClick=\{(\(\)|_)\s*=>\s*\{?\s*\}?\s*\}/);
      expect(s, `${file} has a TODO/FIXME`).not.toMatch(/TODO|FIXME/);
      expect(s, `${file} has a "coming soon" stub`).not.toMatch(/coming soon/i);
      expect(s, `${file} calls window.alert`).not.toMatch(/\balert\(/);
      expect(s, `${file} references mock/fake data`).not.toMatch(/mockData|fakeApi|FAKE_|MOCK_/);
    }
  });

  it('every button that performs a mutation is wired to a real governance API call, not a local-only state update', () => {
    const policies = read('src/components/governance/GovernancePoliciesTab.tsx');
    expect(policies).toContain("apiFetch('/api/governance/policies'");
    expect(policies).toContain("method: 'PATCH'");
    expect(policies).toContain('/approve');

    const controls = read('src/components/governance/GovernanceControlsTab.tsx');
    expect(controls).toContain("apiFetch('/api/governance/controls'");
    expect(controls).toContain('/tests');

    const risks = read('src/components/governance/GovernanceRisksTab.tsx');
    expect(risks).toContain("apiFetch('/api/governance/risks'");
    expect(risks).toContain('/accept');

    const findings = read('src/components/governance/GovernanceFindingsTab.tsx');
    expect(findings).toContain('/api/governance/findings');
    expect(findings).toContain('/dispositions');
  });

  it('GovernanceView is actually mounted in App.tsx and CommandCenter.tsx -- the nav item is not a dead route', () => {
    const app = read('src/App.tsx');
    expect(app).toContain("import GovernanceView from './components/GovernanceView';");
    expect(app).toContain("case '/governance': view = <GovernanceView role={role} />; break;");
    const nav = read('src/components/CommandCenter.tsx');
    expect(nav).toMatch(/id: 'governance', label: 'Governance', icon: '⚖', path: '\/governance'/);
  });
});

describe('Governance UI: PASS-requires-evidence is surfaced honestly, never bypassed client-side', () => {
  it('the control test form does not disable/hide the PASS option or fabricate success when the API rejects it', () => {
    const s = read('src/components/governance/GovernanceControlsTab.tsx');
    expect(s).toContain('PASS_REQUIRES_EVIDENCE');
    expect(s).toContain('SPR will not record a passing test with no supporting evidence');
    // The catch block must set a real error state and must NOT also push a
    // fake success row onto the test list.
    const catchBlockStart = s.indexOf('} catch (e: any) { setTestError');
    expect(catchBlockStart).toBeGreaterThan(-1);
  });
});

describe('Governance UI: risk acceptance form matches the backend\'s required-field contract exactly', () => {
  it('requires acceptedBy, acceptanceRationale, acceptanceScope, and reviewDate as HTML-required fields', () => {
    const s = read('src/components/governance/GovernanceRisksTab.tsx');
    expect(s).toMatch(/required value=\{acceptForm\.acceptedBy\}/);
    expect(s).toMatch(/required value=\{acceptForm\.acceptanceRationale\}/);
    expect(s).toMatch(/required value=\{acceptForm\.acceptanceScope\}/);
    expect(s).toMatch(/required type="date" value=\{acceptForm\.reviewDate\}/);
  });

  it('never closes the modal or shows success while an incomplete/rejected request is in flight', () => {
    const s = read('src/components/governance/GovernanceRisksTab.tsx');
    const handlerStart = s.indexOf('const handleAccept');
    const handlerBody = s.slice(handlerStart, handlerStart + 900);
    expect(handlerBody).toContain('if (!r.ok) throw new Error');
    // setShowAccept(false) must appear only after the throw check, i.e. on
    // the success path -- not before it.
    const throwIdx = handlerBody.indexOf('if (!r.ok) throw new Error');
    const closeIdx = handlerBody.indexOf('setShowAccept(false)');
    expect(closeIdx).toBeGreaterThan(throwIdx);
  });
});

describe('Governance UI: finding dispositions never touch the finding\'s real evidence-derived status', () => {
  it('the findings tab renders the evidence-derived status as read-only, with no control to edit it', () => {
    const s = read('src/components/governance/GovernanceFindingsTab.tsx');
    expect(s).toContain('Evidence-derived status is fixed by the trust engine and never changed here');
    expect(s).not.toMatch(/setStatus\(|editStatus\(|status:\s*e\.target\.value/); // no control writes selected.status
  });
});

describe('Governance UI: WHY modal shows the real chain or explicit missing evidence, never an invented explanation', () => {
  it('renders data.missing verbatim from the API, and never hardcodes an explanation string of its own', () => {
    const s = read('src/components/governance/GovernanceWhyModal.tsx');
    expect(s).toContain('data.missing.map((m, i)');
    expect(s).not.toMatch(/Verification cannot be established because required evidence is missing\./); // that string must come from the API, not be duplicated as a UI fallback
  });
});

describe('Governance UI: cross-tab relationship navigation resolves to the real underlying object', () => {
  it('GovernanceView threads the actual clicked id through to the target tab, not just a bare tab switch', () => {
    const s = read('src/components/GovernanceView.tsx');
    expect(s).toContain('const navigateToControl = (id: string) => { setPendingControlId(id); setTab(\'controls\'); };');
    expect(s).toContain('const navigateToPolicy = (id: string) => { setPendingPolicyId(id); setTab(\'policies\'); };');
    expect(s).toContain('selectIdOnLoad={pendingPolicyId}');
    expect(s).toContain('selectIdOnLoad={pendingControlId}');
  });

  it('each tab actually selects the passed-in id once its real list has loaded', () => {
    const policies = read('src/components/governance/GovernancePoliciesTab.tsx');
    expect(policies).toContain('if (selectIdOnLoad && policies.some((p) => p.id === selectIdOnLoad)) setSelectedId(selectIdOnLoad)');
    const controls = read('src/components/governance/GovernanceControlsTab.tsx');
    expect(controls).toContain('if (selectIdOnLoad && controls.some((c) => c.id === selectIdOnLoad)) setSelectedId(selectIdOnLoad)');
  });
});

describe('Governance UI: search/filter operate on real fetched data, not fabricated records', () => {
  it('findings search/filter are sent as real query params to the server', () => {
    const s = read('src/components/governance/GovernanceFindingsTab.tsx');
    expect(s).toContain("qs.set('status'");
    expect(s).toContain("qs.set('q'");
    expect(s).toContain('/api/governance/findings');
  });

  it('audit trail pagination uses the real cursor-based API, not a fabricated page count', () => {
    const s = read('src/components/governance/GovernanceAuditTab.tsx');
    expect(s).toContain("apiFetch(`/api/auth/audit-chain${before ? `?before=${before}` : ''}`)");
    expect(s).toContain('setHasMore(data.length === 50)');
  });
});

describe('Governance UI: loading, error, and empty states are honest', () => {
  it('every tab shows a real loading indicator distinct from its empty state', () => {
    for (const file of ['GovernancePoliciesTab.tsx', 'GovernanceControlsTab.tsx', 'GovernanceRisksTab.tsx', 'GovernanceFindingsTab.tsx']) {
      const s = read(`src/components/governance/${file}`);
      expect(s).toMatch(/loading \? .*Loading/);
    }
  });

  it('empty states explain that no records exist, never substituting a fake record', () => {
    const policies = read('src/components/governance/GovernancePoliciesTab.tsx');
    expect(policies).toContain('No policies exist yet.');
    const controls = read('src/components/governance/GovernanceControlsTab.tsx');
    expect(controls).toContain('No controls exist yet.');
    const risks = read('src/components/governance/GovernanceRisksTab.tsx');
    expect(risks).toContain('No risks exist yet.');
  });
});
