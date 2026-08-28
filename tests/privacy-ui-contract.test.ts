import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

const PRIVACY_FILES = [
  'src/components/PrivacyView.tsx',
  'src/components/privacy/PrivacyInventoryTab.tsx',
  'src/components/privacy/PrivacyRequestsTab.tsx',
  'src/components/privacy/PrivacyPiaTab.tsx',
];

describe('Privacy UI: zero dead controls', () => {
  it('contains no empty click handlers, TODO/FIXME placeholders, or mock data', () => {
    for (const file of PRIVACY_FILES) {
      const s = read(file);
      expect(s, `${file} has an empty onClick handler`).not.toMatch(/onClick=\{(\(\)|_)\s*=>\s*\{?\s*\}?\s*\}/);
      expect(s, `${file} has a TODO/FIXME`).not.toMatch(/TODO|FIXME/);
      expect(s, `${file} calls window.alert`).not.toMatch(/\balert\(/);
      expect(s, `${file} references mock/fake data`).not.toMatch(/mockData|fakeApi|FAKE_|MOCK_/);
    }
  });

  it('every button that performs a mutation calls a real /api/privacy endpoint', () => {
    const inventory = read('src/components/privacy/PrivacyInventoryTab.tsx');
    expect(inventory).toContain("apiFetch('/api/privacy/inventory'");
    const requests = read('src/components/privacy/PrivacyRequestsTab.tsx');
    expect(requests).toContain("apiFetch('/api/privacy/requests'");
    expect(requests).toContain('method: \'PATCH\'');
    const pias = read('src/components/privacy/PrivacyPiaTab.tsx');
    expect(pias).toContain("apiFetch('/api/privacy/pias'");
    expect(pias).toContain('/decide');
  });

  it('PrivacyView is actually mounted in App.tsx and CommandCenter.tsx -- the nav item is not a dead route', () => {
    const app = read('src/App.tsx');
    expect(app).toContain("import PrivacyView from './components/PrivacyView';");
    expect(app).toContain("case '/privacy': view = <PrivacyView role={role} />; break;");
    const nav = read('src/components/CommandCenter.tsx');
    expect(nav).toMatch(/id: 'privacy', label: 'Privacy', icon: '◍', path: '\/privacy'/);
  });
});

describe('Privacy UI: PIA decision requires a named reviewer before it can be submitted', () => {
  it('the decision buttons are disabled until a reviewer name is entered', () => {
    const s = read('src/components/privacy/PrivacyPiaTab.tsx');
    expect(s).toContain('disabled={!reviewerName.trim() || deciding}');
  });
});

describe('Privacy UI never claims legal compliance or certification', () => {
  it('no privacy component contains a "compliant" or "certified" claim', () => {
    for (const file of PRIVACY_FILES) {
      const s = read(file).toLowerCase();
      expect(s, `${file} claims compliance/certification`).not.toMatch(/\bcompliant\b|\bcertified\b/);
    }
  });

  it('PrivacyView explicitly states it does not determine legal compliance', () => {
    const s = read('src/components/PrivacyView.tsx');
    expect(s).toContain('it does not determine legal compliance on its own');
  });
});

describe('Privacy UI: loading, error, and empty states are honest', () => {
  it('every tab shows a real loading indicator and an explicit empty-state message', () => {
    const inventory = read('src/components/privacy/PrivacyInventoryTab.tsx');
    expect(inventory).toContain('No inventory items exist yet.');
    const requests = read('src/components/privacy/PrivacyRequestsTab.tsx');
    expect(requests).toContain('No privacy requests logged yet.');
    const pias = read('src/components/privacy/PrivacyPiaTab.tsx');
    expect(pias).toContain('No assessments exist yet.');
  });
});
