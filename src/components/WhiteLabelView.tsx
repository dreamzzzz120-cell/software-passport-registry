import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AlertTriangle, CheckCircle2, Eye, EyeOff, Image as ImageIcon, Palette, RotateCcw, Save, Type, Undo2, LifeBuoy, Building2 } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import type { SoftwarePassport } from '../types';
import {
  DEFAULT_PALETTES, DEFAULT_PRODUCT_NAME, DEFAULT_RADIUS, DEFAULT_TAGLINE, FONT_CHOICES, RADIUS_MAX, RADIUS_MIN,
  THEME_COLOR_KEYS, THEME_COLOR_LABELS, isHexColor, parseBrandingResponse,
  type BrandingTheme, type TenantBranding, type ThemeColorKey, type ThemeMode, type ThemePalette,
} from '../lib/brandingTheme';

interface Props {
  role: string;
  // The preview is rendered from the workspace's real passports so that the
  // page never shows an invented number, even as illustration.
  passports: SoftwarePassport[];
  branding: TenantBranding;
  theme: ThemeMode;
  onBrandingSaved: (next: TenantBranding) => void;
  onPreview: (draft: TenantBranding | null) => void;
}

const LOGO_MAX_BYTES = 220_000;
const FAVICON_MAX_BYTES = 45_000;

// --- colour helpers -------------------------------------------------------
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
function mix(hex: string, withHex: string, amount: number): string {
  const [r1, g1, b1] = hexToRgb(hex); const [r2, g2, b2] = hexToRgb(withHex);
  return rgbToHex(r1 + (r2 - r1) * amount, g1 + (g2 - g1) * amount, b1 + (b2 - b1) * amount);
}
function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a); const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function readImageFile(file: File, maxBytes: number, label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|jpg|svg\+xml|webp)$/.test(file.type)) { reject(new Error(`${label} must be a PNG, JPEG, SVG or WebP image.`)); return; }
    if (file.size > maxBytes) { reject(new Error(`${label} is too large (${Math.round(file.size / 1024)} KB). Use an image under ${Math.round(maxBytes / 1024)} KB.`)); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${label.toLowerCase()}.`));
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error(`Could not read ${label.toLowerCase()}.`));
    reader.readAsDataURL(file);
  });
}

function cloneBranding(b: TenantBranding): TenantBranding {
  return { ...b, theme: { ...b.theme, colors: { light: { ...(b.theme.colors?.light ?? {}) }, dark: { ...(b.theme.colors?.dark ?? {}) } } } };
}

function stripEmpty(theme: BrandingTheme): BrandingTheme {
  const out: BrandingTheme = {};
  const str = (v: string | null | undefined) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  if (str(theme.productName)) out.productName = str(theme.productName);
  if (str(theme.tagline)) out.tagline = str(theme.tagline);
  if (theme.fontId && theme.fontId !== 'inter') out.fontId = theme.fontId;
  if (typeof theme.radius === 'number' && theme.radius !== DEFAULT_RADIUS) out.radius = theme.radius;
  if (theme.defaultMode) out.defaultMode = theme.defaultMode;
  const colors: BrandingTheme['colors'] = {};
  for (const mode of ['light', 'dark'] as ThemeMode[]) {
    const palette: ThemePalette = {};
    for (const key of THEME_COLOR_KEYS) { const v = theme.colors?.[mode]?.[key]; if (isHexColor(v) && v.toLowerCase() !== DEFAULT_PALETTES[mode][key]) palette[key] = v.toLowerCase(); }
    if (Object.keys(palette).length) colors[mode] = palette;
  }
  if (Object.keys(colors).length) out.colors = colors;
  if (theme.faviconDataUrl) out.faviconDataUrl = theme.faviconDataUrl;
  if (str(theme.supportEmail)) out.supportEmail = str(theme.supportEmail);
  if (str(theme.supportUrl)) out.supportUrl = str(theme.supportUrl);
  if (str(theme.footerText)) out.footerText = str(theme.footerText);
  if (theme.hideSprAttribution) out.hideSprAttribution = true;
  return out;
}

function previewStyle(theme: BrandingTheme, mode: ThemeMode): CSSProperties {
  const style: Record<string, string> = {};
  for (const key of THEME_COLOR_KEYS) {
    const v = theme.colors?.[mode]?.[key];
    style[`--spr-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`] = isHexColor(v) ? v : DEFAULT_PALETTES[mode][key];
  }
  style['--spr-radius'] = `${typeof theme.radius === 'number' ? theme.radius : DEFAULT_RADIUS}px`;
  const font = FONT_CHOICES.find((f) => f.id === theme.fontId) ?? FONT_CHOICES[0];
  style.fontFamily = font.stack;
  style.colorScheme = mode;
  return style as CSSProperties;
}

export default function WhiteLabelView({ role, passports, branding, theme: activeMode, onBrandingSaved, onPreview }: Props) {
  const canEdit = role === 'Owner' || role === 'Admin';
  const [draft, setDraft] = useState<TenantBranding>(() => cloneBranding(branding));
  const [mode, setMode] = useState<ThemeMode>(activeMode);
  const [livePreview, setLivePreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [section, setSection] = useState<'identity' | 'colors' | 'type' | 'support'>('identity');
  const logoInput = useRef<HTMLInputElement>(null);
  const faviconInput = useRef<HTMLInputElement>(null);

  // A fresh saved value from the server (initial load finishing after mount)
  // replaces an untouched draft; edits in progress are never overwritten.
  const dirty = useMemo(() => JSON.stringify({ ...draft, theme: stripEmpty(draft.theme), updatedAt: null }) !== JSON.stringify({ ...branding, theme: stripEmpty(branding.theme), updatedAt: null }), [draft, branding]);
  useEffect(() => { if (!dirty) setDraft(cloneBranding(branding)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [branding.updatedAt]);

  // Live preview pushes the draft into the real shell; leaving the page or
  // switching it off restores whatever is saved.
  useEffect(() => { onPreview(livePreview ? { ...draft, theme: stripEmpty(draft.theme) } : null); }, [livePreview, draft, onPreview]);
  useEffect(() => () => onPreview(null), [onPreview]);

  const update = (patch: Partial<TenantBranding>) => { setSuccess(null); setDraft((d) => ({ ...d, ...patch })); };
  const updateTheme = (patch: Partial<BrandingTheme>) => { setSuccess(null); setDraft((d) => ({ ...d, theme: { ...d.theme, ...patch } })); };
  const setColor = (m: ThemeMode, key: ThemeColorKey, value: string | null) => {
    setSuccess(null);
    setDraft((d) => {
      const colors = { light: { ...(d.theme.colors?.light ?? {}) }, dark: { ...(d.theme.colors?.dark ?? {}) } };
      if (value === null) delete colors[m][key]; else colors[m][key] = value;
      return { ...d, theme: { ...d.theme, colors } };
    });
  };
  const paletteFor = (m: ThemeMode): Record<ThemeColorKey, string> => {
    const out = { ...DEFAULT_PALETTES[m] };
    for (const key of THEME_COLOR_KEYS) { const v = draft.theme.colors?.[m]?.[key]; if (isHexColor(v)) out[key] = v; }
    return out;
  };

  // "Brand colour" is the one-field path: it derives the primary action,
  // hover, tint and highlight tokens for both modes from a single hex.
  const applyBrandColor = (hex: string) => {
    if (!isHexColor(hex)) return;
    setSuccess(null);
    setDraft((d) => {
      const colors = { light: { ...(d.theme.colors?.light ?? {}) }, dark: { ...(d.theme.colors?.dark ?? {}) } };
      colors.light.accent = hex; colors.light.accentHover = mix(hex, '#000000', 0.15); colors.light.accentSoft = mix(hex, '#ffffff', 0.85); colors.light.highlight = hex; colors.light.blue = hex;
      colors.dark.accent = mix(hex, '#000000', 0.1); colors.dark.accentHover = hex; colors.dark.accentSoft = mix(hex, '#000000', 0.55); colors.dark.highlight = mix(hex, '#ffffff', 0.25); colors.dark.blue = mix(hex, '#ffffff', 0.25);
      return { ...d, brandColor: hex, theme: { ...d.theme, colors } };
    });
  };

  const handleFile = async (kind: 'logo' | 'favicon', file: File | null) => {
    if (!file) return;
    setError(null);
    try {
      const dataUrl = await readImageFile(file, kind === 'logo' ? LOGO_MAX_BYTES : FAVICON_MAX_BYTES, kind === 'logo' ? 'Logo' : 'Favicon');
      if (kind === 'logo') update({ logoDataUrl: dataUrl }); else updateTheme({ faviconDataUrl: dataUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the image.');
    }
  };

  const save = async () => {
    if (!canEdit) return;
    setSaving(true); setError(null); setSuccess(null);
    try {
      const body = {
        companyName: draft.companyName?.trim() || null,
        brandColor: isHexColor(draft.brandColor) ? draft.brandColor : null,
        logoDataUrl: draft.logoDataUrl || null,
        theme: stripEmpty(draft.theme),
      };
      const res = await apiFetch('/api/organization/branding', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = data?.details?.fieldErrors ? Object.entries(data.details.fieldErrors).map(([k, v]) => `${k}: ${(v as string[]).join(', ')}`).join('; ') : '';
        throw new Error(detail || data?.error || `Save failed (${res.status})`);
      }
      const saved = parseBrandingResponse(data);
      onBrandingSaved(saved);
      setDraft(cloneBranding(saved));
      setSuccess(`Saved ${saved.updatedAt ? new Date(saved.updatedAt).toLocaleString() : 'now'}. The workspace, PDF report exports and the public passport API use it from here on.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const discard = () => { setDraft(cloneBranding(branding)); setError(null); setSuccess(null); };
  const resetAll = () => { setSuccess(null); setDraft({ companyName: draft.companyName, brandColor: null, logoDataUrl: draft.logoDataUrl, theme: {}, updatedAt: draft.updatedAt }); };

  const palette = paletteFor(mode);
  const contrastWarnings = useMemo(() => {
    const p = paletteFor(mode);
    const checks: Array<[string, string, string]> = [['Text on page', p.text, p.surface], ['Text on panels', p.text, p.surfaceAlt], ['Secondary text on page', p.textMuted, p.surface], ['White on primary action', '#ffffff', p.accent]];
    return checks.filter(([, fg, bg]) => contrastRatio(fg, bg) < 4.5).map(([label, fg, bg]) => `${label}: ${contrastRatio(fg, bg).toFixed(1)}:1 (WCAG AA needs 4.5:1)`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.theme.colors, mode]);

  // Real workspace figures for the preview: counts over the loaded passports
  // and the evidence rows of the most recently scanned one.
  const previewData = useMemo(() => {
    const openFindings = passports.reduce((n, p) => n + p.vulnerabilities.filter((v: any) => !['resolved', 'closed', 'verified'].includes(String(v?.status ?? '').toLowerCase())).length, 0);
    const evidenceCount = passports.reduce((n, p) => n + p.evidence.length, 0);
    const featured = [...passports].sort((a, b) => (b.evidence[0]?.timestamp ?? '').localeCompare(a.evidence[0]?.timestamp ?? ''))[0] ?? null;
    return { passportCount: passports.length, openFindings, evidenceCount, featured, rows: featured ? featured.evidence.slice(0, 3) : [] };
  }, [passports]);
  const statusColor = (status: string) => {
    const s = status.toLowerCase();
    if (s === 'verified') return palette.green;
    if (s === 'failed' || s === 'rejected') return palette.red;
    if (s === 'observed') return palette.blue;
    return palette.amber;
  };
  const productName = draft.theme.productName?.trim() || DEFAULT_PRODUCT_NAME;
  const tagline = draft.theme.tagline?.trim() || DEFAULT_TAGLINE;
  const inputCls = 'w-full rounded-[var(--spr-radius)] border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-[13px] text-[var(--spr-text)] focus:border-[var(--spr-highlight)] focus:outline-none disabled:opacity-50';
  const labelCls = 'text-[11px] font-semibold uppercase tracking-[.06em] text-[var(--spr-text-muted)]';

  const SectionTab = ({ id, icon: Icon, label }: { id: typeof section; icon: typeof Palette; label: string }) => (
    <button type="button" onClick={() => setSection(id)} data-active={section === id} className="spr-nav-item flex items-center gap-2 px-3 py-1.5 text-[13px]" style={section === id ? undefined : { color: 'var(--spr-text)' }}>
      <Icon className="h-4 w-4" strokeWidth={1.75} /> {label}
    </button>
  );

  return (
    <div className="space-y-5" id="white-label-view">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--spr-text)]">White-label</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-[var(--spr-text-muted)]">
            Restyle the whole workspace for your team and clients: name, logo, favicon, every colour in light and dark mode, typography, corners, and support details. This changes only how the product looks. It never changes a score, a finding, or which evidence is shown.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setLivePreview((v) => !v)} className="spr-btn spr-btn-secondary inline-flex items-center gap-1.5" title="Apply the unsaved draft to this window so you can see it on every page. Nothing is saved until you click Save.">
            {livePreview ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} {livePreview ? 'Stop live preview' : 'Preview live in app'}
          </button>
          <button type="button" onClick={discard} disabled={!dirty} className="spr-btn spr-btn-secondary inline-flex items-center gap-1.5 disabled:opacity-40"><Undo2 className="h-4 w-4" /> Discard changes</button>
          <button type="button" onClick={save} disabled={!canEdit || !dirty || saving} className="spr-btn spr-btn-primary inline-flex items-center gap-1.5 disabled:opacity-40" title={!canEdit ? `Your ${role} role cannot change branding. Owner or Admin is required.` : undefined}>
            <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {!canEdit && <div className="rounded-[var(--spr-radius)] border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-3 text-[12px] text-[var(--spr-text-muted)]">You can view the current branding. Changing it requires the Owner or Admin role.</div>}
      {error && <div className="flex gap-2 rounded-[var(--spr-radius)] border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-3 text-[12px] text-[var(--spr-red)]"><AlertTriangle className="h-4 w-4 shrink-0" /><p>{error}</p></div>}
      {success && <div className="flex gap-2 rounded-[var(--spr-radius)] border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-3 text-[12px] text-[var(--spr-green)]"><CheckCircle2 className="h-4 w-4 shrink-0" /><p>{success}</p></div>}
      {livePreview && <div className="rounded-[var(--spr-radius)] border border-[var(--spr-amber)]/50 bg-[var(--spr-surface-sunken)] p-3 text-[12px] text-[var(--spr-amber)]">Live preview is on: this window shows the unsaved draft. Other people and other tabs still see the saved branding until you click Save.</div>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Editor */}
        <div className="spr-panel p-4">
          <div className="mb-4 flex flex-wrap gap-1 border-b border-[var(--spr-border)] pb-3">
            <SectionTab id="identity" icon={Building2} label="Identity" />
            <SectionTab id="colors" icon={Palette} label="Colours" />
            <SectionTab id="type" icon={Type} label="Typography & shape" />
            <SectionTab id="support" icon={LifeBuoy} label="Support & footer" />
          </div>

          {section === 'identity' && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className={labelCls}>Company / MSP name</label>
                  <input className={inputCls} disabled={!canEdit} value={draft.companyName ?? ''} onChange={(e) => update({ companyName: e.target.value })} placeholder="Shown on reports and public passports" maxLength={200} />
                </div>
                <div className="space-y-1">
                  <label className={labelCls}>Product name in the sidebar</label>
                  <input className={inputCls} disabled={!canEdit} value={draft.theme.productName ?? ''} onChange={(e) => updateTheme({ productName: e.target.value })} placeholder={DEFAULT_PRODUCT_NAME} maxLength={80} />
                </div>
              </div>
              <div className="space-y-1">
                <label className={labelCls}>Tagline</label>
                <input className={inputCls} disabled={!canEdit} value={draft.theme.tagline ?? ''} onChange={(e) => updateTheme({ tagline: e.target.value })} placeholder={DEFAULT_TAGLINE} maxLength={120} />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className={labelCls}>Logo</label>
                  <div className="flex items-center gap-3 rounded-[var(--spr-radius)] border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-3">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[var(--spr-radius)] border border-[var(--spr-border)] bg-white">
                      {draft.logoDataUrl ? <img src={draft.logoDataUrl} alt="Logo preview" className="max-h-full max-w-full object-contain" /> : <img src="/brand/spr-icon.png" alt="Default SPR logo" className="max-h-full max-w-full object-contain opacity-50" />}
                    </div>
                    <div className="min-w-0 flex-1 space-y-1.5 text-[12px] text-[var(--spr-text-muted)]">
                      <p>{draft.logoDataUrl ? `Uploaded, ${Math.round(draft.logoDataUrl.length * 0.75 / 1024)} KB.` : 'No logo uploaded; the default SPR mark is shown.'}</p>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={!canEdit} onClick={() => logoInput.current?.click()} className="spr-btn spr-btn-secondary !px-2.5 !py-1 !text-[11px] inline-flex items-center gap-1 disabled:opacity-40"><ImageIcon className="h-3.5 w-3.5" /> {draft.logoDataUrl ? 'Replace' : 'Upload'}</button>
                        {draft.logoDataUrl && <button type="button" disabled={!canEdit} onClick={() => update({ logoDataUrl: null })} className="text-[11px] text-[var(--spr-red)] hover:underline disabled:opacity-40">Remove</button>}
                      </div>
                      <p className="text-[11px] text-[var(--spr-text-faint)]">PNG, JPEG, SVG or WebP under {Math.round(LOGO_MAX_BYTES / 1024)} KB. Square or wide both work.</p>
                    </div>
                    <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden" onChange={(e) => { void handleFile('logo', e.target.files?.[0] ?? null); e.target.value = ''; }} />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className={labelCls}>Browser tab icon (favicon)</label>
                  <div className="flex items-center gap-3 rounded-[var(--spr-radius)] border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-3">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[var(--spr-radius)] border border-[var(--spr-border)] bg-white">
                      {draft.theme.faviconDataUrl ? <img src={draft.theme.faviconDataUrl} alt="Favicon preview" className="h-8 w-8 object-contain" /> : <span className="text-[11px] text-[var(--spr-text-faint)]">default</span>}
                    </div>
                    <div className="min-w-0 flex-1 space-y-1.5 text-[12px] text-[var(--spr-text-muted)]">
                      <p>{draft.theme.faviconDataUrl ? 'Uploaded.' : 'Not set; the SPR favicon is shown.'}</p>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={!canEdit} onClick={() => faviconInput.current?.click()} className="spr-btn spr-btn-secondary !px-2.5 !py-1 !text-[11px] inline-flex items-center gap-1 disabled:opacity-40"><ImageIcon className="h-3.5 w-3.5" /> {draft.theme.faviconDataUrl ? 'Replace' : 'Upload'}</button>
                        {draft.theme.faviconDataUrl && <button type="button" disabled={!canEdit} onClick={() => updateTheme({ faviconDataUrl: null })} className="text-[11px] text-[var(--spr-red)] hover:underline disabled:opacity-40">Remove</button>}
                      </div>
                      <p className="text-[11px] text-[var(--spr-text-faint)]">Square PNG or SVG under {Math.round(FAVICON_MAX_BYTES / 1024)} KB, 32×32 or larger.</p>
                    </div>
                    <input ref={faviconInput} type="file" accept="image/png,image/svg+xml,image/webp" className="hidden" onChange={(e) => { void handleFile('favicon', e.target.files?.[0] ?? null); e.target.value = ''; }} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {section === 'colors' && (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 rounded-[var(--spr-radius)] border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[13px] font-semibold text-[var(--spr-text)]">Brand colour</p>
                  <p className="text-[11px] text-[var(--spr-text-muted)]">One colour sets the primary action, hover, tint and highlight tokens for both modes. Fine-tune any token below.</p>
                </div>
                <div className="flex items-center gap-2">
                  <input type="color" disabled={!canEdit} value={isHexColor(draft.brandColor) ? draft.brandColor : DEFAULT_PALETTES.light.accent} onChange={(e) => applyBrandColor(e.target.value)} className="h-9 w-14 cursor-pointer rounded-[var(--spr-radius)] border border-[var(--spr-border)] bg-transparent disabled:opacity-50" />
                  <input className={`${inputCls} !w-28 font-mono`} disabled={!canEdit} value={draft.brandColor ?? ''} placeholder="#rrggbb" maxLength={7} onChange={(e) => { const v = e.target.value; update({ brandColor: v }); if (isHexColor(v)) applyBrandColor(v); }} />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="inline-flex rounded-[var(--spr-radius)] border border-[var(--spr-border)] p-0.5">
                  {(['light', 'dark'] as ThemeMode[]).map((m) => (
                    <button key={m} type="button" onClick={() => setMode(m)} className={`rounded-[var(--spr-radius)] px-3 py-1 text-[12px] font-semibold ${mode === m ? 'bg-[var(--spr-accent)] text-white' : 'text-[var(--spr-text-muted)]'}`}>{m === 'light' ? 'Light mode' : 'Dark mode'}</button>
                  ))}
                </div>
                <button type="button" disabled={!canEdit} onClick={() => { for (const key of THEME_COLOR_KEYS) setColor(mode, key, null); }} className="inline-flex items-center gap-1 text-[11px] text-[var(--spr-text-muted)] hover:text-[var(--spr-text)] disabled:opacity-40"><RotateCcw className="h-3.5 w-3.5" /> Reset {mode} palette</button>
              </div>

              {contrastWarnings.length > 0 && (
                <div className="rounded-[var(--spr-radius)] border border-[var(--spr-amber)]/50 bg-[var(--spr-surface-sunken)] p-3 text-[12px] text-[var(--spr-amber)]">
                  <p className="font-semibold">Low contrast in {mode} mode</p>
                  <ul className="mt-1 list-disc pl-4">{contrastWarnings.map((w) => <li key={w}>{w}</li>)}</ul>
                </div>
              )}

              <div className="grid gap-2 sm:grid-cols-2">
                {THEME_COLOR_KEYS.map((key) => {
                  const custom = draft.theme.colors?.[mode]?.[key];
                  const value = isHexColor(custom) ? custom : DEFAULT_PALETTES[mode][key];
                  const overridden = isHexColor(custom) && custom.toLowerCase() !== DEFAULT_PALETTES[mode][key];
                  return (
                    <div key={key} className="flex items-center gap-2 rounded-[var(--spr-radius)] border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-2">
                      <input type="color" disabled={!canEdit} value={value} onChange={(e) => setColor(mode, key, e.target.value)} className="h-8 w-10 shrink-0 cursor-pointer rounded-[var(--spr-radius)] border border-[var(--spr-border)] bg-transparent disabled:opacity-50" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-semibold text-[var(--spr-text)]">{THEME_COLOR_LABELS[key].label}</p>
                        <p className="truncate text-[11px] text-[var(--spr-text-faint)]">{THEME_COLOR_LABELS[key].hint}</p>
                      </div>
                      <input className="w-20 rounded-[var(--spr-radius)] border border-[var(--spr-border)] bg-[var(--spr-surface)] px-1.5 py-1 font-mono text-[11px] text-[var(--spr-text)] disabled:opacity-50" disabled={!canEdit} value={custom ?? value} maxLength={7} onChange={(e) => setColor(mode, key, e.target.value)} onBlur={(e) => { if (!isHexColor(e.target.value)) setColor(mode, key, null); }} />
                      <button type="button" disabled={!canEdit || !overridden} title="Reset to default" onClick={() => setColor(mode, key, null)} className="shrink-0 text-[var(--spr-text-faint)] hover:text-[var(--spr-text)] disabled:opacity-30"><RotateCcw className="h-3.5 w-3.5" /></button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {section === 'type' && (
            <div className="space-y-5">
              <div className="space-y-1">
                <label className={labelCls}>Font</label>
                <select className={inputCls} disabled={!canEdit} value={draft.theme.fontId ?? 'inter'} onChange={(e) => updateTheme({ fontId: e.target.value })}>
                  {FONT_CHOICES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
                <p className="text-[11px] text-[var(--spr-text-faint)]">Fonts are system-installed stacks; no third-party font files are loaded, so nothing leaves the browser.</p>
              </div>
              <div className="space-y-1">
                <label className={labelCls}>Corner radius: {draft.theme.radius ?? DEFAULT_RADIUS}px</label>
                <input type="range" min={RADIUS_MIN} max={RADIUS_MAX} step={1} disabled={!canEdit} value={draft.theme.radius ?? DEFAULT_RADIUS} onChange={(e) => updateTheme({ radius: Number(e.target.value) })} className="w-full" />
                <div className="flex justify-between text-[11px] text-[var(--spr-text-faint)]"><span>Square</span><span>Default {DEFAULT_RADIUS}px</span><span>Round</span></div>
              </div>
              <div className="space-y-1">
                <label className={labelCls}>Default appearance for new sessions</label>
                <div className="grid grid-cols-3 gap-2">
                  {([['', 'Viewer’s choice'], ['light', 'Light'], ['dark', 'Dark']] as Array<[string, string]>).map(([value, label]) => (
                    <button key={value} type="button" disabled={!canEdit} onClick={() => updateTheme({ defaultMode: (value || null) as ThemeMode | null })} className={`rounded-[var(--spr-radius)] border px-3 py-2 text-[12px] font-semibold disabled:opacity-50 ${(draft.theme.defaultMode ?? '') === value ? 'border-[var(--spr-highlight)] bg-[var(--spr-accent-soft)] text-[var(--spr-text)]' : 'border-[var(--spr-border)] text-[var(--spr-text-muted)]'}`}>{label}</button>
                  ))}
                </div>
                <p className="text-[11px] text-[var(--spr-text-faint)]">Applies the first time someone opens the workspace. Their own Settings toggle wins after that.</p>
              </div>
            </div>
          )}

          {section === 'support' && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className={labelCls}>Support email</label>
                  <input type="email" className={inputCls} disabled={!canEdit} value={draft.theme.supportEmail ?? ''} onChange={(e) => updateTheme({ supportEmail: e.target.value })} placeholder="support@your-msp.example" maxLength={200} />
                </div>
                <div className="space-y-1">
                  <label className={labelCls}>Support URL (https)</label>
                  <input type="url" className={inputCls} disabled={!canEdit} value={draft.theme.supportUrl ?? ''} onChange={(e) => updateTheme({ supportUrl: e.target.value })} placeholder="https://help.your-msp.example" maxLength={500} />
                </div>
              </div>
              <div className="space-y-1">
                <label className={labelCls}>Footer text</label>
                <input className={inputCls} disabled={!canEdit} value={draft.theme.footerText ?? ''} onChange={(e) => updateTheme({ footerText: e.target.value })} placeholder="© Your MSP. Managed security services." maxLength={300} />
                <p className="text-[11px] text-[var(--spr-text-faint)]">Shown at the bottom of the sidebar and on white-label reports.</p>
              </div>
              <label className="flex items-start gap-2 rounded-[var(--spr-radius)] border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-3 text-[12px] text-[var(--spr-text)]">
                <input type="checkbox" disabled={!canEdit} checked={Boolean(draft.theme.hideSprAttribution)} onChange={(e) => updateTheme({ hideSprAttribution: e.target.checked })} className="mt-0.5" />
                <span>Hide the “Powered by Software Passport Registry” line in the sidebar and report footers.</span>
              </label>
              <div className="rounded-[var(--spr-radius)] border border-dashed border-[var(--spr-border)] p-3 text-[12px] text-[var(--spr-text-muted)]">
                <p className="font-semibold text-[var(--spr-text)]">Not available</p>
                <p className="mt-1">Custom domains (serving the workspace from your own hostname) are not implemented yet.</p>
              </div>
              <div className="rounded-[var(--spr-radius)] border border-[var(--spr-border)] p-3 text-[12px] text-[var(--spr-text-muted)]">
                <p className="font-semibold text-[var(--spr-text)]">Branded email</p>
                <p className="mt-1">Verification, password-reset and invitation emails to members of this workspace use the product name, brand colour, logo, support address and footer saved here, and are sent from SPR’s own mail domain with this workspace’s product name as the sender name.</p>
              </div>
            </div>
          )}

          <div className="mt-5 flex items-center justify-between border-t border-[var(--spr-border)] pt-3 text-[11px] text-[var(--spr-text-faint)]">
            <span>{branding.updatedAt ? `Last saved ${new Date(branding.updatedAt).toLocaleString()}` : 'Never saved — the workspace is using SPR defaults.'}</span>
            <button type="button" disabled={!canEdit} onClick={resetAll} className="inline-flex items-center gap-1 hover:text-[var(--spr-text)] disabled:opacity-40"><RotateCcw className="h-3.5 w-3.5" /> Reset theme to SPR defaults</button>
          </div>
        </div>

        {/* Preview */}
        <div className="xl:sticky xl:top-16 xl:self-start">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[.06em] text-[var(--spr-text-muted)]">Preview · {mode} mode</p>
            <div className="inline-flex rounded-[var(--spr-radius)] border border-[var(--spr-border)] p-0.5">
              {(['light', 'dark'] as ThemeMode[]).map((m) => (
                <button key={m} type="button" onClick={() => setMode(m)} className={`rounded-[var(--spr-radius)] px-2.5 py-0.5 text-[11px] font-semibold ${mode === m ? 'bg-[var(--spr-accent)] text-white' : 'text-[var(--spr-text-muted)]'}`}>{m}</button>
              ))}
            </div>
          </div>
          <div style={previewStyle(draft.theme, mode)} className="overflow-hidden rounded-[var(--spr-radius)] border border-[var(--spr-border)] bg-[var(--spr-surface)] text-[var(--spr-text)]" data-theme={mode}>
            <div className="flex min-h-[420px]">
              <aside className="hidden w-[190px] shrink-0 flex-col border-r border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-2 sm:flex">
                <div className="mb-2 flex items-center gap-2 rounded-[var(--spr-radius)] border border-[var(--spr-border)] p-1.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-[var(--spr-radius)] border border-[var(--spr-border)] bg-white">
                    <img src={draft.logoDataUrl || '/brand/spr-icon.png'} alt="" className="max-h-full max-w-full object-contain" />
                  </div>
                  <div className="min-w-0"><p className="truncate text-[11px] font-semibold leading-tight">{productName}</p><p className="truncate text-[10px] leading-tight text-[var(--spr-text-faint)]">{tagline}</p></div>
                </div>
                {['Overview', 'Passports', 'Scans', 'Alerts', 'Reports'].map((item, i) => (
                  <div key={item} className="rounded-[var(--spr-radius)] px-2 py-1 text-[11px]" style={i === 1 ? { background: palette.accentSoft, color: palette.highlight, fontWeight: 600 } : undefined}>{item}</div>
                ))}
                <div className="mt-auto border-t border-[var(--spr-border)] pt-2 text-[9px] leading-snug text-[var(--spr-text-faint)]">
                  {draft.theme.footerText?.trim() && <p className="truncate">{draft.theme.footerText}</p>}
                  {(draft.theme.supportEmail?.trim() || draft.theme.supportUrl?.trim()) && <p className="truncate" style={{ color: palette.highlight }}>{draft.theme.supportEmail?.trim() || draft.theme.supportUrl?.trim()}</p>}
                  {!draft.theme.hideSprAttribution && <p>Powered by Software Passport Registry</p>}
                </div>
              </aside>
              <div className="min-w-0 flex-1">
                <div className="flex h-9 items-center gap-2 border-b border-[var(--spr-border)] bg-[var(--spr-surface)] px-3 text-[10px] text-[var(--spr-text-faint)]">
                  <span>Workspace</span><span>/</span><span className="font-medium text-[var(--spr-text)]">Passports</span>
                  <span className="ml-auto rounded-[var(--spr-radius)] border border-[var(--spr-border)] px-1.5 py-0.5"><span className="mr-1 inline-block h-1.5 w-1.5 rounded-full" style={{ background: palette.green }} />Live</span>
                </div>
                <div className="space-y-3 p-3">
                  <div className="grid grid-cols-3 overflow-hidden rounded-[var(--spr-radius)] border border-[var(--spr-border)]">
                    {[['Passports', String(previewData.passportCount)], ['Open findings', String(previewData.openFindings)], ['Evidence items', String(previewData.evidenceCount)]].map(([k, v], i) => (
                      <div key={k} className={`bg-[var(--spr-surface-alt)] p-2 ${i ? 'border-l border-[var(--spr-border)]' : ''}`}><p className="text-[9px] uppercase tracking-wide text-[var(--spr-text-faint)]">{k}</p><p className="text-[15px] font-semibold">{v}</p></div>
                    ))}
                  </div>
                  <div className="rounded-[var(--spr-radius)] border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-3">
                    <div className="flex items-center justify-between gap-2"><p className="truncate text-[12px] font-semibold">{previewData.featured ? previewData.featured.name : 'No passports yet'}</p>{previewData.featured && <span className="shrink-0 rounded-[var(--spr-radius)] px-1.5 py-0.5 text-[9px] font-semibold uppercase text-white" style={{ background: previewData.featured.verificationStatus === 'verified' ? palette.green : previewData.featured.verificationStatus === 'partial' ? palette.amber : palette.gray }}>{previewData.featured.verificationStatus}</span>}</div>
                    <p className="mt-1 text-[10px] text-[var(--spr-text-muted)]">{previewData.featured ? `Version ${previewData.featured.version.slice(0, 12)} · ${previewData.featured.evidence.length} evidence items` : 'Register or scan a passport and it appears here.'}</p>
                    <div className="mt-2 overflow-hidden rounded-[var(--spr-radius)] border border-[var(--spr-border)] text-[10px]">
                      {previewData.rows.length === 0 && <div className="px-2 py-1 text-[var(--spr-text-faint)]">No evidence recorded.</div>}
                      {previewData.rows.map((row, i) => (
                        <div key={row.id} className={`flex items-center justify-between gap-2 px-2 py-1 ${i ? 'border-t border-[var(--spr-border)]' : ''} ${i === 1 ? 'bg-[var(--spr-surface-hover)]' : ''}`}><span className="truncate">{row.name}</span><span className="shrink-0" style={{ color: statusColor(String(row.status)) }}>{String(row.status)}</span></div>
                      ))}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <span className="rounded-[var(--spr-radius)] px-2.5 py-1 text-[10px] font-semibold text-white" style={{ background: palette.accent }}>Primary action</span>
                      <span className="rounded-[var(--spr-radius)] border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2.5 py-1 text-[10px] font-semibold">Secondary</span>
                      <span className="self-center text-[10px]" style={{ color: palette.highlight }}>Link</span>
                    </div>
                  </div>
                  {previewData.featured?.fileHash && <div className="truncate rounded-[var(--spr-radius)] border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-2 font-mono text-[9px] text-[var(--spr-text-muted)]">{previewData.featured.fileHash}</div>}
                </div>
              </div>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-[var(--spr-text-faint)]">The preview is rendered from this workspace's real passports. Use “Preview live in app” to see the draft on every page.</p>
        </div>
      </div>
    </div>
  );
}
