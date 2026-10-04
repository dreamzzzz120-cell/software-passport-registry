import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('intake broker storage client', () => {
  const original = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env.SPR_ARTIFACT_BROKER_URL = 'https://example.supabase.co/functions/v1/spr-artifact-broker';
    process.env.SPR_ARTIFACT_BROKER_TOKEN = 'x'.repeat(48);
  });

  afterEach(() => {
    process.env = { ...original };
    vi.restoreAllMocks();
  });

  it('requests a signed intake upload without a Supabase service key', async () => {
    const fetchMock: any = vi.fn(async (..._args: any[]) => new Response(JSON.stringify({
      bucket: 'spr-intake',
      path: 'intake_' + 'a'.repeat(32) + '/item_' + 'b'.repeat(32) + '/package.json',
      token: 'signed-token',
      signedUrl: 'https://storage.example/upload',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const { createIntakeSignedUpload } = await import('../src/integrations/intake-storage.ts');
    const result = await createIntakeSignedUpload({
      sessionId: 'intake_' + 'a'.repeat(32),
      itemId: 'item_' + 'b'.repeat(32),
      fileName: 'package.json',
      contentType: 'application/json',
    });

    expect(result.bucket).toBe('spr-intake');
    expect(result.signedUrl).toContain('https://');
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.action).toBe('intake-upload');
    expect(body.sessionId).toMatch(/^intake_[a-f0-9]{32}$/);
  });

  it('downloads bytes only through a short-lived broker URL', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: any) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/functions/v1/')) {
        return new Response(JSON.stringify({ signedUrl: 'https://storage.example/object?token=short' }), { status: 200 });
      }
      return new Response(Buffer.from('observed-bytes'), { status: 200 });
    }));

    const { downloadIntakeObject } = await import('../src/integrations/intake-storage.ts');
    const bytes = await downloadIntakeObject({
      bucket: 'spr-intake',
      path: 'intake_' + 'a'.repeat(32) + '/item_' + 'b'.repeat(32) + '/package.json',
    });
    expect(bytes.toString()).toBe('observed-bytes');
    expect(calls).toHaveLength(2);
  });

  it('fails closed when the broker is not configured', async () => {
    delete process.env.SPR_ARTIFACT_BROKER_URL;
    const { downloadIntakeObject } = await import('../src/integrations/intake-storage.ts');
    await expect(downloadIntakeObject({ bucket: 'spr-intake', path: 'x' })).rejects.toThrow('INTAKE_BROKER_NOT_CONFIGURED');
  });
});
