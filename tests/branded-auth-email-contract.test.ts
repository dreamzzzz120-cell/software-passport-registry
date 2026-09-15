import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderBrandedEmail, SPR_DEFAULT_BRAND, type EmailBrand } from '../src/lib/branded-email.ts';
const root = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const tenantBrand: EmailBrand = { tenantId: 'tenant-acme', productName: 'Acme Trust Portal', companyName: 'Acme MSP Ltd.', brandColor: '#aa3311', logoUrl: 'https://www.softwarepassportregistry.com/api/public/branding/logo/tenant-acme/abc', supportEmail: 'help@acme.example', supportUrl: 'https://acme.example', footerText: '© Acme MSP', hideSprAttribution: true };

describe('branded email rendering', () => {
  it('uses the tenant product name, colour, logo, support address, footer and attribution setting', () => { const { html, text } = renderBrandedEmail(tenantBrand, { heading: 'Reset your password', intro: ['Hello.'], cta: { label: 'Reset', url: 'https://example.test/reset?oobCode=x' } }); expect(html).toContain('Acme Trust Portal'); expect(html).toContain('#aa3311'); expect(html).toContain(tenantBrand.logoUrl!); expect(html).toContain('help@acme.example'); expect(html).toContain('© Acme MSP'); expect(html).not.toContain('Sent by Software Passport Registry'); expect(text).toContain('Reset: https://example.test/reset?oobCode=x'); });
  it('keeps SPR attribution unless the tenant hid it, and escapes untrusted strings', () => { const { html } = renderBrandedEmail({ ...tenantBrand, hideSprAttribution: false, productName: '<script>x</script>' }, { heading: 'Hi & bye', intro: [] }); expect(html).toContain('Sent by Software Passport Registry on behalf of Acme MSP Ltd.'); expect(html).not.toContain('<script>x</script>'); expect(html).toContain('&lt;script&gt;'); expect(html).toContain('Hi &amp; bye'); });
  it('falls back to SPR branding for accounts with no workspace', () => { const { html } = renderBrandedEmail(SPR_DEFAULT_BRAND, { heading: 'Confirm', intro: ['x'] }); expect(html).toContain('Software Passport Registry'); expect(html).toContain('/brand/spr-icon.png'); });
});

describe('auth email routes', () => {
  const auth = read('src/routes/auth.ts');
  it('verification, password reset and invitations all go through the branded sender', () => { expect(auth).toContain("router.post('/auth/send-verification'"); expect(auth).toContain("router.post('/auth/send-password-reset', rateLimiter"); expect(auth).toContain('loadEmailBrand(await tenantIdForUid(decoded.uid))'); expect(auth).toContain('loadEmailBrand(await tenantIdForEmail(email))'); expect(auth).toContain("cta: { label: 'Set your password and join', url: inviteLink }"); expect(auth).not.toContain('sendEmailDirect('); });
  it('password reset never reveals whether an account exists', () => { const route = auth.slice(auth.indexOf("router.post('/auth/send-password-reset'"), auth.indexOf('return router;')); expect(route).toContain("return res.json({ accepted: true, via: 'provider' });"); expect(route).not.toContain('USER_NOT_FOUND'); });
  it('the invite response and UI only claim an email was sent when the provider accepted it', () => { expect(auth).toContain('inviteLink, emailed, emailError'); const settings = read('src/components/SettingsView.tsx'); expect(settings).toContain('invited.emailed === true'); expect(settings).not.toContain('Successfully sent security invitation'); });
  it('the client uses Supabase for password reset', () => { const login = read('src/components/LoginView.tsx'); expect(login).toContain('supabase.auth.resetPasswordForEmail'); expect(login).not.toContain('sendPasswordResetEmail(auth'); expect(login).not.toContain('firebase/auth'); });
  it('the queued path stores html and the worker sends it', () => { expect(read('migrations/0085_notification_outbox_html.sql')).toContain('ADD COLUMN IF NOT EXISTS html text'); const worker = read('src/workers/notification-worker.ts'); expect(worker).toContain('if(html)payload.html=html;'); expect(worker).toContain('row.html||null'); });
});
