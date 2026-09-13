import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PALETTES, FONT_CHOICES, THEME_COLOR_KEYS, applyBrandingTheme, parseBrandingResponse,
} from '../src/lib/brandingTheme.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

// A minimal stand-in for document.documentElement: applyBrandingTheme only
// needs style.setProperty / removeProperty, and the favicon helper is a no-op
// when there is no document.
function fakeRoot() {
  const props = new Map<string, string>();
  return {
    props,
    style: {
      setProperty: (k: string, v: string) => { props.set(k, v); },
      removeProperty: (k: string) => { props.delete(k); },
    },
  } as unknown as HTMLElement & { props: Map<string, string> };
}

describe('white-label theme application', () => {
  it('writes only the tokens the tenant set, as --spr-* custom properties for the active mode', () => {
    const root = fakeRoot();
    applyBrandingTheme({ colors: { light: { accent: '#123456', textMuted: '#654321' }, dark: { accent: '#abcdef' } }, radius: 8, fontId: 'georgia' }, 'light', root);
    expect(root.props.get('--spr-accent')).toBe('#123456');
    expect(root.props.get('--spr-text-muted')).toBe('#654321');
    expect(root.props.get('--spr-radius')).toBe('8px');
    expect(root.props.get('font-family')).toBe(FONT_CHOICES.find((f) => f.id === 'georgia')!.stack);
    // Dark-only override must not leak into light mode; unset tokens stay
    // with the stylesheet.
    expect(root.props.has('--spr-surface')).toBe(false);
    expect(root.props.size).toBe(4);
  });

  it('clears everything it manages when the theme is removed or the mode changes', () => {
    const root = fakeRoot();
    applyBrandingTheme({ colors: { light: { accent: '#123456' } }, radius: 12 }, 'light', root);
    applyBrandingTheme({ colors: { light: { accent: '#123456' } }, radius: 12 }, 'dark', root);
    expect(root.props.has('--spr-accent')).toBe(false);
    expect(root.props.get('--spr-radius')).toBe('12px');
    applyBrandingTheme(null, 'dark', root);
    expect(root.props.size).toBe(0);
  });

  it('ignores values that are not #rrggbb, out-of-range radii and unknown fonts', () => {
    const root = fakeRoot();
    applyBrandingTheme({ colors: { light: { accent: 'red', border: '#fff', text: 'url(javascript:1)' as any } }, radius: 99, fontId: 'comic' }, 'light', root);
    expect(root.props.size).toBe(0);
  });

  it('the default palettes mirror src/index.css token for token', () => {
    const css = read('src/index.css');
    const darkBlock = css.slice(css.indexOf(':root[data-theme="dark"]'), css.indexOf(':root[data-theme="light"]'));
    const lightBlock = css.slice(css.indexOf(':root[data-theme="light"]'), css.indexOf('body {'));
    for (const key of THEME_COLOR_KEYS) {
      const varName = `--spr-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
      expect(darkBlock).toContain(`${varName}: ${DEFAULT_PALETTES.dark[key]};`);
      expect(lightBlock).toContain(`${varName}: ${DEFAULT_PALETTES.light[key]};`);
    }
  });

  it('parses an API response defensively', () => {
    expect(parseBrandingResponse(null).theme).toEqual({});
    expect(parseBrandingResponse({ brandColor: 'blue', theme: [] }).brandColor).toBeNull();
    expect(parseBrandingResponse({ brandColor: '#0f6cbd', theme: { radius: 4 }, updatedAt: 'x' })).toEqual({ companyName: null, brandColor: '#0f6cbd', logoDataUrl: null, theme: { radius: 4 }, updatedAt: 'x' });
  });
});

describe('white-label API contract', () => {
  const auth = read('src/routes/auth.ts');
  it('validates the theme document strictly: hex colours, allow-listed fonts, bounded radius, https support URL, small favicon', () => {
    expect(auth).toContain('const themeSchema = z.object({');
    expect(auth).toContain("fontId: z.enum(FONT_CHOICES.map((font) => font.id)");
    expect(auth).toContain('radius: z.number().int().min(RADIUS_MIN).max(RADIUS_MAX)');
    expect(auth).toContain("'supportUrl must be https'");
    expect(auth).toContain('faviconDataUrl: imageDataUrl(60_000)');
    expect(auth).toMatch(/const themeSchema = z\.object\(\{[\s\S]*?\}\)\.strict\(\);/);
  });
  it('persists and returns the theme column on both branding routes', () => {
    expect(auth).toContain('theme = EXCLUDED.theme');
    expect(auth).toContain('logo_data_url AS "logoDataUrl", theme, updated_at AS "updatedAt"');
  });
  it('migration 0081 adds a JSON-object-constrained theme column', () => {
    const migration = read('migrations/0081_tenant_branding_theme.sql');
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS theme jsonb NOT NULL DEFAULT '{}'::jsonb");
    expect(migration).toContain("CHECK (jsonb_typeof(theme) = 'object')");
  });
});

describe('white-label surfaces', () => {
  it('is its own routed page in the left rail, not a Settings sub-panel', () => {
    const app = read('src/App.tsx');
    expect(app).toContain("case '/white-label': view = <WhiteLabelView");
    const shell = read('src/components/CommandCenter.tsx');
    expect(shell).toContain("path: '/white-label'");
    const settings = read('src/components/SettingsView.tsx');
    expect(settings).not.toContain('handleSaveBranding');
    expect(settings).not.toContain("apiFetch('/api/organization/branding'");
  });

  it('the shell renders the tenant logo, product name, tagline, footer and attribution from branding', () => {
    const shell = read('src/components/CommandCenter.tsx');
    expect(shell).toContain("const logoSrc = branding.logoDataUrl || '/brand/spr-icon.png'");
    expect(shell).toContain('branding.theme.productName?.trim() || DEFAULT_PRODUCT_NAME');
    expect(shell).toContain('{showAttribution && <p>Powered by Software Passport Registry</p>}');
    expect(shell).not.toContain('<img src="/brand/spr-icon.png"');
  });

  it('the page preview is rendered from real passports, never from invented sample figures', () => {
    const view = read('src/components/WhiteLabelView.tsx');
    expect(view).toContain('passports: SoftwarePassport[]');
    expect(view).toContain('previewData.passportCount');
    expect(view).not.toMatch(/\['Passports', '\d+'\]/);
    expect(view).not.toContain('Sample passport');
  });

  it('the white-label PDF footer honours footer text and the attribution switch', () => {
    const pdf = read('src/utils/pdfGenerator.ts');
    expect(pdf).toContain("if (showSprAttribution) doc.text('Generated with Software Passport Registry'");
    expect(pdf).toContain('if (footerText) doc.text(footerText.slice(0, 160)');
    expect(pdf).not.toContain('HYBRID ATTESTATION REGISTRY');
    expect(pdf).not.toContain('Software Trust Ledger');
    const reports = read('src/components/ReportsView.tsx');
    expect(reports).toContain('brandFooterText, showSprAttribution);');
  });

  it('the public passport response carries the tenant identity but never the logo bytes', () => {
    const route = read('src/routes/public-connect.ts');
    expect(route).toContain('SELECT company_name AS "companyName", brand_color AS "brandColor", theme FROM tenant_branding');
    expect(route).not.toContain('logo_data_url AS "logoDataUrl", theme FROM tenant_branding');
    expect(route).toContain('    branding,\n');
  });
});

describe('settings page carries no placeholder controls', () => {
  const settings = read('src/components/SettingsView.tsx');
  it('has no save button that saves nothing', () => {
    expect(settings).not.toContain('Save Platform Settings');
    expect(settings).not.toContain('handleSaveSettings');
    expect(settings).not.toContain('Not saved to a server');
  });
  it('has no "not yet implemented" configuration cards standing in for features', () => {
    expect(settings).not.toContain('Audit Trust SLA Target Threshold');
    expect(settings).not.toContain('Automated Daily Recalculation Scans');
    expect(settings).not.toContain('Enterprise SAML / SSO Integration');
  });
});
