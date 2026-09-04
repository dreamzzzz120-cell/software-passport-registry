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

  // Billing was listed here as having no backend. It has one -- real Stripe
  // Checkout, the billing portal, signature-verified webhooks and server-side
  // client-limit enforcement -- so the honest entry is a description of what
  // it does, not a disclaimer. The guarantee this test protects is that the
  // guide describes billing truthfully either way: it must not go silent, and
  // it must not still claim the backend is missing once it exists.
  it('describes the billing backend that exists, and no longer claims there is none', () => {
    const s = source();
    expect(s).not.toContain('no backend exists yet');
    expect(s).toContain('Billing</h4>');
    expect(s).toContain('Real Stripe Checkout');
  });

  it('still discloses custom domains are not implemented', () => {
    expect(source()).toContain('Custom domains</strong> — not implemented');
  });

  it('still discloses branding does not yet reach the public passport/emails', () => {
    expect(source()).toContain('only feeds the Reports PDF export, not yet the public passport page itself');
  });
});
