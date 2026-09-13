import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Exercise verifyOutreachSender against a fake pool and a fake provider send:
// it must send exactly once per (from, to), record what the provider said,
// refuse to run when outreach is off, and never throw.
const sends: Array<{ to: string; subject: string; options: unknown }> = [];
let providerFails = false;
vi.mock('../src/lib/branded-email.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/branded-email.ts')>();
  return { ...actual, sendBrandedEmail: async (to: string, subject: string, _brand: unknown, _content: unknown, options: unknown) => { sends.push({ to, subject, options }); if (providerFails) throw new Error('EMAIL_PROVIDER_422:domain not verified'); return 'msg_123'; } };
});

const rows: any[] = [];
let locked = true;
function fakePool() {
  const client = {
    async query(text: string, params: unknown[] = []) {
      if (/pg_try_advisory_lock/.test(text)) return { rows: [{ locked }] };
      if (/pg_advisory_unlock/.test(text)) return { rows: [] };
      if (/SELECT id, sent_at FROM distribution_sender_verifications/.test(text)) return { rows: rows.filter((r) => r.status === 'sent' && r.from.toLowerCase() === String(params[0]).toLowerCase() && r.to === params[1]) };
      if (/INSERT INTO distribution_sender_verifications/.test(text)) { rows.push({ id: params[0], from: params[1], to: params[2], status: text.includes("'sent'") ? 'sent' : 'failed', providerMessageId: params[3], sent_at: new Date().toISOString() }); return { rows: [] }; }
      throw new Error('unhandled ' + text);
    },
    release() {},
  };
  return { connect: async () => client };
}

const env = { ...process.env };
beforeEach(() => { sends.length = 0; rows.length = 0; locked = true; providerFails = false; process.env.DISTRIBUTION_AUTONOMOUS_OUTREACH = 'true'; process.env.RESEND_API_KEY = 'x'; process.env.EMAIL_FROM = 'noreply@softwarepassportregistry.com'; process.env.DISTRIBUTION_OUTREACH_FROM = 'Software Passport Registry <ceo@softwarepassportregistry.com>'; process.env.DISTRIBUTION_OUTREACH_VERIFY_TO = 'Founder@Example.test'; process.env.SPR_PUBLIC_PASSPORT_SECRET = 'test-secret-with-at-least-32-characters!!'; });
afterEach(() => { for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k]; Object.assign(process.env, env); });

describe('outreach sender verification', () => {
  it('sends one real message from the outreach address with Reply-To matched, and records the provider id', async () => {
    const { verifyOutreachSender } = await import('../src/lib/distribution-outreach.ts');
    const first = await verifyOutreachSender(fakePool());
    expect(first).toEqual({ action: 'sent', providerMessageId: 'msg_123' });
    expect(sends).toEqual([{ to: 'founder@example.test', subject: 'SPR outreach sender verification', options: { from: 'Software Passport Registry <ceo@softwarepassportregistry.com>', replyTo: 'ceo@softwarepassportregistry.com' } }]);
    expect(rows[0]).toMatchObject({ status: 'sent', providerMessageId: 'msg_123', to: 'founder@example.test' });
    const second = await verifyOutreachSender(fakePool());
    expect(second.action).toBe('skipped');
    expect(second.reason).toMatch(/already verified/);
    expect(sends.length).toBe(1);
  });

  it('records a provider failure as failed, with the provider error, and does not throw', async () => {
    const { verifyOutreachSender } = await import('../src/lib/distribution-outreach.ts');
    providerFails = true;
    const result = await verifyOutreachSender(fakePool());
    expect(result).toEqual({ action: 'failed', reason: 'EMAIL_PROVIDER_422:domain not verified' });
    expect(rows[0].status).toBe('failed');
  });

  it('does nothing when outreach is off, when unconfigured, or when another consumer holds the lock', async () => {
    const { verifyOutreachSender } = await import('../src/lib/distribution-outreach.ts');
    process.env.DISTRIBUTION_AUTONOMOUS_OUTREACH = 'false';
    expect((await verifyOutreachSender(fakePool())).action).toBe('skipped');
    process.env.DISTRIBUTION_AUTONOMOUS_OUTREACH = 'true'; delete process.env.DISTRIBUTION_OUTREACH_VERIFY_TO;
    expect((await verifyOutreachSender(fakePool())).action).toBe('skipped');
    process.env.DISTRIBUTION_OUTREACH_VERIFY_TO = 'founder@example.test'; locked = false;
    expect((await verifyOutreachSender(fakePool())).reason).toMatch(/another worker consumer/);
    expect(sends.length).toBe(0);
  });
});
