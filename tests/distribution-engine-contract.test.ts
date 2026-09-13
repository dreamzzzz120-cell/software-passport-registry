import { describe, expect, it } from 'vitest';
import { calculateBackoff, enqueueResearchUrl } from '../src/lib/distribution-engine.ts';

describe('distribution engine contracts', () => {
  it('uses bounded exponential backoff', () => {
    expect(calculateBackoff(1)).toBe(1000);
    expect(calculateBackoff(2)).toBe(2000);
    expect(calculateBackoff(10)).toBe(60000);
  });

  it('rejects non-http research targets before queueing', async () => {
    const pool = { query: async () => { throw new Error('queue should not be touched'); } } as any;
    await expect(enqueueResearchUrl(pool, 'file:///etc/passwd')).rejects.toThrow('DISTRIBUTION_URL_SCHEME_NOT_ALLOWED');
  });

  it('rejects loopback research targets before queueing', async () => {
    const pool = { query: async () => { throw new Error('queue should not be touched'); } } as any;
    await expect(enqueueResearchUrl(pool, 'http://127.0.0.1:8080/health')).rejects.toThrow('DISTRIBUTION_PRIVATE_TARGET_BLOCKED');
  });
});

describe('outreach sender address', () => {
  it('outreach mail uses DISTRIBUTION_OUTREACH_FROM with a matching Reply-To, and transactional mail keeps EMAIL_FROM', async () => {
    const { outreachSender } = await import('../src/lib/distribution-outreach.ts');
    const previous = process.env.DISTRIBUTION_OUTREACH_FROM;
    process.env.DISTRIBUTION_OUTREACH_FROM = 'Software Passport Registry <ceo@softwarepassportregistry.com>';
    try {
      expect(outreachSender()).toEqual({ from: 'Software Passport Registry <ceo@softwarepassportregistry.com>', replyTo: 'ceo@softwarepassportregistry.com' });
      delete process.env.DISTRIBUTION_OUTREACH_FROM;
      expect(outreachSender()).toEqual({ from: undefined, replyTo: undefined });
    } finally { if (previous === undefined) delete process.env.DISTRIBUTION_OUTREACH_FROM; else process.env.DISTRIBUTION_OUTREACH_FROM = previous; }
    const fs = await import('node:fs');
    const outreach = fs.readFileSync('src/lib/distribution-outreach.ts', 'utf8');
    // Every outreach send passes the outreach sender: the two contact sends
    // pass outreachSender() directly; the verification send spreads its fields.
    const sendCalls = (outreach.match(/sendBrandedEmail\(/g) ?? []).length;
    const withSender = (outreach.match(/, outreachSender\(\)\)/g) ?? []).length + (outreach.match(/\}, \{ from, replyTo \}\)/g) ?? []).length;
    expect(sendCalls).toBe(withSender);
    const auth = fs.readFileSync('src/routes/auth.ts', 'utf8');
    expect(auth).not.toContain('outreachSender');
  });
});
