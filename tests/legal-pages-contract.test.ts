import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('public /terms and /privacy routing', () => {
  const app = () => read('src/App.tsx');

  it('are reachable without authentication', () => {
    const s = app();
    expect(s).toContain("PUBLIC_PATHS = new Set(['/','/login','/free-review','/pricing','/msp','/terms','/privacy'])");
    expect(s).toContain("if (path === '/terms') return <TermsView />;");
    expect(s).toContain("if (!user && path === '/privacy') return <PrivacyPolicyView />;");
  });

  it('does not disturb the existing authenticated /privacy route (internal Privacy Governance tool)', () => {
    expect(app()).toContain("case '/privacy': view = <PrivacyView role={role} />; break;");
  });
});

describe('legal pages do not fabricate certifications, guarantees, or compliance claims', () => {
  const files = ['src/components/legal/TermsView.tsx', 'src/components/legal/PrivacyPolicyView.tsx'];

  it('never claims SOC 2, ISO 27001, SLSA Level, or blanket regulatory compliance', () => {
    for (const file of files) {
      const s = read(file).toLowerCase();
      expect(s).not.toMatch(/soc\s*2\s*certified/);
      expect(s).not.toMatch(/iso\s*27001\s*certified/);
      expect(s).not.toContain('slsa level');
      expect(s).not.toMatch(/compliant with (all|every) (applicable )?regulation/);
      expect(s).not.toContain('legally protected');
      // Affirmative overclaims are forbidden; correctly-hedged disclaimers
      // ("we do not guarantee...", "does not extend to guarantees...") are
      // exactly the intended, conservative language and must not trip this.
      expect(s).not.toMatch(/we guarantee|spr guarantees|is guaranteed to be (secure|compliant)/);
    }
  });

  it('marks the legal entity name, contact, and jurisdiction as explicit placeholders for legal review, not as decided facts', () => {
    for (const file of files) {
      const s = read(file);
      expect(s).toContain('[LEGAL ENTITY NAME]');
      expect(s).toContain('[LEGAL CONTACT EMAIL]');
    }
    expect(read('src/components/legal/TermsView.tsx')).toContain('LEGAL REVIEW REQUIRED');
  });

  it('Terms explicitly disclaims that trust scores/reports are not legal, financial, cybersecurity, or compliance advice', () => {
    const s = read('src/components/legal/TermsView.tsx');
    expect(s).toContain('NOT LEGAL, FINANCIAL, CYBERSECURITY, COMPLIANCE, OR OTHER');
    expect(s).toContain('it does not certify, warrant, guarantee, or attest');
  });

  it('Privacy Policy only lists third-party processors actually integrated in this codebase', () => {
    const s = read('src/components/legal/PrivacyPolicyView.tsx');
    expect(s).toContain('Firebase Authentication');
    expect(s).toContain('Stripe');
    expect(s).toContain('Railway');
    expect(s).toContain('Vercel');
    expect(s).toContain('Gemini');
    expect(s).toContain('Sentry');
  });

  it('Privacy Policy describes local storage/cookie use honestly rather than a templated cookie-consent claim', () => {
    const s = read('src/components/legal/PrivacyPolicyView.tsx');
    expect(s).toContain('does not set third-party advertising or tracking cookies');
    expect(s).toContain('local storage');
  });
});

describe('legal footer links are present on the real public entry points', () => {
  it('CoverPage, LoginView, MspLandingView, and MspPricingView all link to /terms and /privacy', () => {
    expect(read('src/App.tsx')).toContain('<LegalFooterLinks className="mt-8" />');
    expect(read('src/components/LoginView.tsx')).toContain('href="/terms"');
    expect(read('src/components/LoginView.tsx')).toContain('href="/privacy"');
    expect(read('src/components/MspLandingView.tsx')).toContain('<LegalFooterLinks');
    expect(read('src/components/MspPricingView.tsx')).toContain('<LegalFooterLinks');
  });
});

describe('PilotProgramView has been removed', () => {
  it('the file no longer exists', () => {
    expect(fs.existsSync(path.join(root, 'src/components/PilotProgramView.tsx'))).toBe(false);
  });

  it('no source file references it', () => {
    const walk = (dir: string): string[] => {
      let out: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'tmp_build_source') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out = out.concat(walk(full));
        else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
      }
      return out;
    };
    const offenders = walk(path.join(root, 'src')).filter((file) => read(path.relative(root, file)).includes('PilotProgramView'));
    expect(offenders).toEqual([]);
  });
});
