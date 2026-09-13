/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Branded transactional email.
 *
 * Verification, password-reset and invitation mail used to leave either from
 * Firebase's shared sender (unbranded, no delivery record) or as plain text
 * from our own domain. Both are replaced by one renderer that takes the
 * tenant's saved white-label theme -- product name, brand colour, logo,
 * support address, footer, attribution setting -- and produces an HTML +
 * plain-text pair sent through the configured provider.
 *
 * The logo is referenced by a public, signed URL rather than inlined: most
 * mail clients strip data: images, so an inlined logo would look "sent"
 * and render as a broken box. See /api/public/branding/logo in
 * src/routes/public-pages.ts.
 *
 * Nothing here decides WHETHER mail is sent; callers still check
 * isEmailProviderConfigured() and fall back to Firebase when it is not.
 */

import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { config } from '../config.ts';
import { DEFAULT_PRODUCT_NAME, type BrandingTheme } from './brandingTheme.ts';

const PUBLIC_ORIGIN = 'https://www.softwarepassportregistry.com';

export interface EmailBrand {
  tenantId: string | null;
  productName: string;
  companyName: string | null;
  brandColor: string;
  logoUrl: string | null;
  supportEmail: string | null;
  supportUrl: string | null;
  footerText: string | null;
  hideSprAttribution: boolean;
}

export const SPR_DEFAULT_BRAND: EmailBrand = {
  tenantId: null,
  productName: DEFAULT_PRODUCT_NAME,
  companyName: 'Software Passport Registry Ltd.',
  brandColor: '#0f6cbd',
  logoUrl: `${PUBLIC_ORIGIN}/brand/spr-icon.png`,
  supportEmail: 'contact@softwarepassportregistry.com',
  supportUrl: PUBLIC_ORIGIN,
  footerText: null,
  hideSprAttribution: false,
};

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Opaque, unguessable token that lets the public logo route serve one tenant's logo. */
export function brandingLogoToken(tenantId: string): string | null {
  const master = config.publicPassport.secret;
  if (!master) return null;
  const key = crypto.hkdfSync('sha256', master, 'spr-branding-logo', 'spr-public-logo-v1', 32);
  return crypto.createHmac('sha256', Buffer.from(key)).update(tenantId).digest('hex').slice(0, 40);
}

export function brandingLogoUrl(tenantId: string): string | null {
  const token = brandingLogoToken(tenantId);
  return token ? `${PUBLIC_ORIGIN}/api/public/branding/logo/${encodeURIComponent(tenantId)}/${token}` : null;
}

/**
 * Reads the tenant's saved branding on the owner connection (it is display
 * packaging, not evidence, and the caller has already established which
 * tenant the recipient belongs to). Returns SPR's own brand when the tenant
 * has saved nothing.
 */
export async function loadEmailBrand(tenantId: string | null | undefined): Promise<EmailBrand> {
  if (!tenantId) return SPR_DEFAULT_BRAND;
  const row = (await db.execute(sql`
    SELECT company_name AS "companyName", brand_color AS "brandColor", logo_data_url AS "logoDataUrl", theme
    FROM tenant_branding WHERE tenant_id = ${tenantId} LIMIT 1
  `) as any).rows?.[0];
  if (!row) return SPR_DEFAULT_BRAND;
  const theme: BrandingTheme = (row.theme && typeof row.theme === 'object') ? row.theme : {};
  const productName = (typeof theme.productName === 'string' && theme.productName.trim()) || (typeof row.companyName === 'string' && row.companyName.trim()) || DEFAULT_PRODUCT_NAME;
  const brandColor = typeof row.brandColor === 'string' && HEX.test(row.brandColor) ? row.brandColor : (theme.colors?.light?.accent && HEX.test(theme.colors.light.accent) ? theme.colors.light.accent : SPR_DEFAULT_BRAND.brandColor);
  return {
    tenantId,
    productName,
    companyName: typeof row.companyName === 'string' && row.companyName.trim() ? row.companyName.trim() : null,
    brandColor,
    logoUrl: typeof row.logoDataUrl === 'string' && row.logoDataUrl.startsWith('data:image/') ? brandingLogoUrl(tenantId) : null,
    supportEmail: typeof theme.supportEmail === 'string' && theme.supportEmail.trim() ? theme.supportEmail.trim() : null,
    supportUrl: typeof theme.supportUrl === 'string' && theme.supportUrl.trim() ? theme.supportUrl.trim() : null,
    footerText: typeof theme.footerText === 'string' && theme.footerText.trim() ? theme.footerText.trim() : null,
    hideSprAttribution: theme.hideSprAttribution === true,
  };
}

/** Finds the tenant a Firebase account belongs to, if it has been provisioned. */
export async function tenantIdForUid(uid: string): Promise<string | null> {
  const row = (await db.execute(sql`SELECT tenant_id AS "tenantId" FROM users WHERE uid = ${uid} LIMIT 1`) as any).rows?.[0];
  return typeof row?.tenantId === 'string' ? row.tenantId : null;
}

export async function tenantIdForEmail(email: string): Promise<string | null> {
  const row = (await db.execute(sql`SELECT tenant_id AS "tenantId" FROM users WHERE lower(btrim(email)) = ${email.trim().toLowerCase()} ORDER BY created_at ASC LIMIT 1`) as any).rows?.[0];
  return typeof row?.tenantId === 'string' ? row.tenantId : null;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export interface BrandedEmailContent {
  heading: string;
  /** Paragraphs shown before the button. */
  intro: string[];
  cta?: { label: string; url: string };
  /** Paragraphs shown after the button. */
  outro?: string[];
}

export function renderBrandedEmail(brand: EmailBrand, content: BrandedEmailContent): { html: string; text: string } {
  const color = HEX.test(brand.brandColor) ? brand.brandColor : SPR_DEFAULT_BRAND.brandColor;
  const support = brand.supportEmail ? `Questions? Email <a href="mailto:${escapeHtml(brand.supportEmail)}" style="color:${color}">${escapeHtml(brand.supportEmail)}</a>.` : '';
  const sender = brand.companyName ?? brand.productName;
  const attribution = brand.hideSprAttribution ? '' : `<p style="margin:8px 0 0;font-size:11px;color:#8a8886">Sent by Software Passport Registry on behalf of ${escapeHtml(sender)}.</p>`;
  const footer = brand.footerText ? `<p style="margin:0;font-size:12px;color:#605e5c">${escapeHtml(brand.footerText)}</p>` : '';
  const logo = brand.logoUrl ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.productName)}" width="48" height="48" style="display:block;width:48px;height:48px;object-fit:contain;border-radius:6px">` : '';
  const paragraphs = (items: string[]) => items.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:24px;color:#242424">${escapeHtml(p)}</p>`).join('');
  const button = content.cta ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 20px"><tr><td style="background:${color};border-radius:4px"><a href="${escapeHtml(content.cta.url)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none">${escapeHtml(content.cta.label)}</a></td></tr></table><p style="margin:0 0 14px;font-size:12px;line-height:18px;color:#605e5c">If the button does not work, copy this link into your browser:<br><a href="${escapeHtml(content.cta.url)}" style="color:${color};word-break:break-all">${escapeHtml(content.cta.url)}</a></p>` : '';

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(content.heading)}</title></head>
<body style="margin:0;padding:0;background:#f3f2f1;font-family:Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f2f1"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e1dfdd;border-radius:8px">
<tr><td style="padding:24px 28px 0;border-top:4px solid ${color};border-radius:8px 8px 0 0"><table role="presentation" cellspacing="0" cellpadding="0"><tr>${logo ? `<td style="padding-right:12px">${logo}</td>` : ''}<td style="font-size:16px;font-weight:700;color:#242424">${escapeHtml(brand.productName)}</td></tr></table></td></tr>
<tr><td style="padding:20px 28px 8px"><h1 style="margin:0 0 16px;font-size:22px;line-height:30px;color:#242424">${escapeHtml(content.heading)}</h1>${paragraphs(content.intro)}${button}${paragraphs(content.outro ?? [])}${support ? `<p style="margin:0 0 6px;font-size:13px;color:#605e5c">${support}</p>` : ''}</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid #e1dfdd">${footer}${attribution}</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    content.heading,
    '',
    ...content.intro,
    ...(content.cta ? ['', `${content.cta.label}: ${content.cta.url}`] : []),
    ...(content.outro?.length ? ['', ...content.outro] : []),
    ...(brand.supportEmail ? ['', `Questions? Email ${brand.supportEmail}.`] : []),
    ...(brand.footerText ? ['', brand.footerText] : []),
    ...(brand.hideSprAttribution ? [] : ['', `Sent by Software Passport Registry on behalf of ${sender}.`]),
  ].join('\n');

  return { html, text };
}

export async function sendBrandedEmail(destination: string, subject: string, brand: EmailBrand, content: BrandedEmailContent): Promise<string> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!apiKey || !from) throw new Error('EMAIL_PROVIDER_NOT_CONFIGURED');
  const { html, text } = renderBrandedEmail(brand, content);
  // Display name carries the tenant's product name; the address stays ours so
  // SPF/DKIM alignment with our domain is preserved.
  const fromAddress = from.includes('<') ? from : `${brand.productName.replace(/[<>"]/g, '')} <${from}>`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: fromAddress, to: [destination], subject, html, text, ...(brand.supportEmail ? { reply_to: brand.supportEmail } : {}) }),
  });
  const result = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!response.ok) throw new Error(`EMAIL_PROVIDER_${response.status}:${result?.message ?? 'unknown'}`);
  return result?.id ?? '';
}
