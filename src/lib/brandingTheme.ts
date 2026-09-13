/**
 * White-label theme shared by the API (validation lives in
 * src/routes/auth.ts) and the client (the White-label page edits it, App.tsx
 * applies it). Everything here is display packaging: none of it reaches
 * scoring, evidence, findings or report contents.
 *
 * The palette keys mirror the --spr-* custom properties in src/index.css one
 * for one, so a saved colour overrides exactly one token and nothing else.
 */

export type ThemeMode = 'light' | 'dark';

export const THEME_COLOR_KEYS = [
  'accent', 'accentHover', 'accentSoft', 'highlight', 'border',
  'surface', 'surfaceDeep', 'surfaceAlt', 'surfaceSunken', 'surfaceHover',
  'text', 'textMuted', 'textFaint',
  'green', 'amber', 'red', 'blue', 'gray',
] as const;
export type ThemeColorKey = typeof THEME_COLOR_KEYS[number];
export type ThemePalette = Partial<Record<ThemeColorKey, string>>;

export const THEME_COLOR_LABELS: Record<ThemeColorKey, { label: string; hint: string }> = {
  accent: { label: 'Primary action', hint: 'Primary buttons and the active navigation item.' },
  accentHover: { label: 'Primary action (hover)', hint: 'Primary buttons while hovered.' },
  accentSoft: { label: 'Primary tint', hint: 'Soft background behind selected items and badges.' },
  highlight: { label: 'Highlight', hint: 'Links, focus rings and icon accents.' },
  border: { label: 'Borders', hint: 'Every panel, input and table border.' },
  surface: { label: 'Page background', hint: 'The page itself.' },
  surfaceDeep: { label: 'Deep background', hint: 'Navigation rail and recessed areas.' },
  surfaceAlt: { label: 'Panels', hint: 'Cards and panels on top of the page.' },
  surfaceSunken: { label: 'Inputs', hint: 'Inputs, code blocks and inset areas.' },
  surfaceHover: { label: 'Hover', hint: 'Rows and items while hovered.' },
  text: { label: 'Text', hint: 'Body text.' },
  textMuted: { label: 'Secondary text', hint: 'Descriptions and labels.' },
  textFaint: { label: 'Faint text', hint: 'Hints and disabled text.' },
  green: { label: 'Success', hint: 'Passing, verified and healthy states.' },
  amber: { label: 'Warning', hint: 'Attention and pending states.' },
  red: { label: 'Danger', hint: 'Failures, critical findings and destructive actions.' },
  blue: { label: 'Information', hint: 'Informational badges and charts.' },
  gray: { label: 'Neutral', hint: 'Neutral badges and chart series.' },
};

// The values in src/index.css, so the editor can show what a token currently
// resolves to and "Reset" can put it back. Keep in step with index.css.
export const DEFAULT_PALETTES: Record<ThemeMode, Record<ThemeColorKey, string>> = {
  dark: {
    accent: '#0e639c', accentHover: '#1177bb', accentSoft: '#094771', highlight: '#3794ff', border: '#3c3c3c',
    surface: '#1e1e1e', surfaceDeep: '#181818', surfaceAlt: '#252526', surfaceSunken: '#2d2d2d', surfaceHover: '#383838',
    text: '#d4d4d4', textMuted: '#9d9d9d', textFaint: '#6f6f6f',
    green: '#89d185', amber: '#cca700', red: '#f14c4c', blue: '#3794ff', gray: '#858585',
  },
  light: {
    accent: '#0f6cbd', accentHover: '#115ea3', accentSoft: '#e0f0ff', highlight: '#0f6cbd', border: '#e1dfdd',
    surface: '#faf9f8', surfaceDeep: '#f3f2f1', surfaceAlt: '#ffffff', surfaceSunken: '#f3f2f1', surfaceHover: '#eeecea',
    text: '#242424', textMuted: '#605e5c', textFaint: '#8a8886',
    green: '#107c10', amber: '#986f0b', red: '#d13438', blue: '#0f6cbd', gray: '#605e5c',
  },
};

export const FONT_CHOICES: Array<{ id: string; label: string; stack: string }> = [
  { id: 'inter', label: 'Inter (default)', stack: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  { id: 'system', label: 'System sans-serif', stack: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
  { id: 'segoe', label: 'Segoe UI', stack: '"Segoe UI", system-ui, sans-serif' },
  { id: 'helvetica', label: 'Helvetica / Arial', stack: 'Helvetica, Arial, sans-serif' },
  { id: 'georgia', label: 'Georgia (serif)', stack: 'Georgia, "Times New Roman", serif' },
  { id: 'mono', label: 'Monospace', stack: '"Cascadia Code", Consolas, ui-monospace, SFMono-Regular, Menlo, monospace' },
];

export const RADIUS_MIN = 0;
export const RADIUS_MAX = 24;
export const DEFAULT_RADIUS = 3;

export const DEFAULT_PRODUCT_NAME = 'Software Passport Registry';
export const DEFAULT_TAGLINE = 'Software Trust OS';

export interface BrandingTheme {
  productName?: string | null;
  tagline?: string | null;
  fontId?: string | null;
  radius?: number | null;
  // When set, the workspace opens in this mode and the Settings toggle is
  // still respected afterwards; when null the viewer's own choice is used.
  defaultMode?: ThemeMode | null;
  colors?: { light?: ThemePalette; dark?: ThemePalette };
  faviconDataUrl?: string | null;
  supportEmail?: string | null;
  supportUrl?: string | null;
  footerText?: string | null;
  hideSprAttribution?: boolean;
}

export interface TenantBranding {
  companyName: string | null;
  brandColor: string | null;
  logoDataUrl: string | null;
  theme: BrandingTheme;
  updatedAt: string | null;
}

export const EMPTY_BRANDING: TenantBranding = { companyName: null, brandColor: null, logoDataUrl: null, theme: {}, updatedAt: null };

const HEX = /^#[0-9a-fA-F]{6}$/;

function cssVarName(key: ThemeColorKey): string {
  return `--spr-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/**
 * Applies a saved theme to the document root for the given mode. Only tokens
 * the tenant actually set are written; everything else keeps the stylesheet
 * value, so removing a colour in the editor returns that token to default.
 * Idempotent: it clears every token it manages before writing.
 */
export function applyBrandingTheme(theme: BrandingTheme | null | undefined, mode: ThemeMode, root: HTMLElement = document.documentElement): void {
  for (const key of THEME_COLOR_KEYS) root.style.removeProperty(cssVarName(key));
  root.style.removeProperty('--spr-radius');
  root.style.removeProperty('font-family');
  const palette = theme?.colors?.[mode];
  if (palette) {
    for (const key of THEME_COLOR_KEYS) {
      const value = palette[key];
      if (typeof value === 'string' && HEX.test(value)) root.style.setProperty(cssVarName(key), value);
    }
  }
  if (typeof theme?.radius === 'number' && theme.radius >= RADIUS_MIN && theme.radius <= RADIUS_MAX) root.style.setProperty('--spr-radius', `${theme.radius}px`);
  const font = FONT_CHOICES.find((f) => f.id === theme?.fontId);
  if (font && font.id !== 'inter') root.style.setProperty('font-family', font.stack);
  applyFavicon(theme?.faviconDataUrl ?? null);
}

const FAVICON_ATTR = 'data-spr-branding-favicon';
function applyFavicon(dataUrl: string | null): void {
  if (typeof document === 'undefined') return;
  const existing = document.head.querySelector<HTMLLinkElement>(`link[${FAVICON_ATTR}]`);
  if (!dataUrl) { existing?.remove(); return; }
  const link = existing ?? document.createElement('link');
  link.setAttribute(FAVICON_ATTR, '1');
  link.rel = 'icon';
  link.href = dataUrl;
  if (!existing) document.head.appendChild(link);
}

export function isHexColor(value: unknown): value is string { return typeof value === 'string' && HEX.test(value); }

export function parseBrandingResponse(data: any): TenantBranding {
  const theme = data && typeof data.theme === 'object' && data.theme !== null && !Array.isArray(data.theme) ? data.theme as BrandingTheme : {};
  return {
    companyName: typeof data?.companyName === 'string' ? data.companyName : null,
    brandColor: isHexColor(data?.brandColor) ? data.brandColor : null,
    logoDataUrl: typeof data?.logoDataUrl === 'string' ? data.logoDataUrl : null,
    theme,
    updatedAt: typeof data?.updatedAt === 'string' ? data.updatedAt : null,
  };
}
