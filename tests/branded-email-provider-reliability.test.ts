import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendBrandedEmail, SPR_DEFAULT_BRAND } from '../src/lib/branded-email.ts';
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('email provider acceptance', () => {
  it('sends the stable idempotency key and a bounded request signal', async () => {
    vi.stubEnv('RESEND_API_KEY','test'); vi.stubEnv('EMAIL_FROM','sender@example.test');
    const fetch=vi.fn(async(_url: string, _options: RequestInit)=> new Response(JSON.stringify({id:'accepted'}),{status:200})); vi.stubGlobal('fetch',fetch);
    expect(await sendBrandedEmail('to@example.test','subject',SPR_DEFAULT_BRAND,{heading:'test',intro:[]},{idempotencyKey:'logical-send-1'})).toBe('accepted');
    expect(fetch.mock.calls[0][1]).toMatchObject({headers:{'Idempotency-Key':'logical-send-1'},signal:expect.any(AbortSignal)});
  });
  it('never treats a success without a provider ID as proof of acceptance', async () => {
    vi.stubEnv('RESEND_API_KEY','test'); vi.stubEnv('EMAIL_FROM','sender@example.test');
    vi.stubGlobal('fetch',vi.fn(async()=> new Response('{}',{status:200})));
    await expect(sendBrandedEmail('to@example.test','subject',SPR_DEFAULT_BRAND,{heading:'test',intro:[]})).rejects.toThrow('ACCEPTANCE_UNKNOWN');
  });
});
