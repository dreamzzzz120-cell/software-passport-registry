import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

// The in-app "Getting Started" guide (Settings) is documentation, not a
// mockup -- it must never claim a capability that isn't real, and must keep
// listing the genuine gaps honestly rather than going silent about them as
// features get added around it.
describe('Settings "Getting Started" guide stays honest about real gaps', () => {
  const source = () => read('src/components/SettingsView.tsx');

  it('is wired as a real tab, not dead markup', () => {
    const s = source();
    expect(s).toContain("setActiveSubTab('guide')");
    expect(s).toContain('<GettingStartedGuide />');
  });

  it('still discloses billing has no backend', () => {
    expect(source()).toContain('no backend exists yet');
  });

  it('still discloses custom domains are not implemented', () => {
    expect(source()).toContain('Custom domains</strong> — not implemented');
  });

  it('still discloses branding does not yet reach the public passport/emails', () => {
    expect(source()).toContain('only feeds the Reports PDF export, not yet the public passport page itself');
  });
});
