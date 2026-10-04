import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const uploadToSignedUrl = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({ uploadToSignedUrl })),
    },
  })),
}));

describe('Supabase artifact data plane', () => {
  const original = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    uploadToSignedUrl.mockReset();
    process.env.SPR_ARTIFACT_BROKER_URL = 'https://example.supabase.co/functions/v1/spr-artifact-broker';
    process.env.SPR_ARTIFACT_BROKER_TOKEN = 'x'.repeat(48);
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable';
  });

  afterEach(() => {
    process.env = { ...original };
    vi.restoreAllMocks();
  });

  it('uploads through a one-time signed token and returns only a durable pointer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      bucket: 'spr-artifacts',
      path: 'tenant/2026-10-04/scan/cyclonedx-sbom/id.json',
      token: 'signed-token',
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    uploadToSignedUrl.mockResolvedValue({ data: { path: 'ok' }, error: null });

    const { storeArtifact } = await import('../src/integrations/artifact-store.ts');
    const result = await storeArtifact({
      tenantId: 'tenant',
      subjectId: 'scan',
      artifactType: 'cyclonedx-sbom',
      extension: 'json',
      contentType: 'application/json',
      body: '{"bomFormat":"CycloneDX"}',
    });

    expect(result.provider).toBe('supabase-storage');
    expect(result.bucket).toBe('spr-artifacts');
    expect(result.path).toContain('cyclonedx-sbom');
    expect(result.sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.bytes).toBeGreaterThan(0);
    expect(uploadToSignedUrl).toHaveBeenCalledOnce();
  });

  it('fails closed when the broker rejects the machine token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"UNAUTHORIZED"}', { status: 401 })));
    const { storeArtifact } = await import('../src/integrations/artifact-store.ts');

    await expect(storeArtifact({
      tenantId: 'tenant',
      subjectId: 'scan',
      artifactType: 'artifact',
      extension: 'json',
      contentType: 'application/json',
      body: '{}',
    })).rejects.toThrow('ARTIFACT_BROKER_401');
  });

  it('lets scans continue when optional artifact storage is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const { tryStoreArtifact } = await import('../src/integrations/artifact-store.ts');

    await expect(tryStoreArtifact({
      tenantId: 'tenant',
      subjectId: 'scan',
      artifactType: 'artifact',
      extension: 'json',
      contentType: 'application/json',
      body: '{}',
    })).resolves.toBeNull();
  });

  it('does not attempt external storage when configuration is absent', async () => {
    delete process.env.SPR_ARTIFACT_BROKER_URL;
    delete process.env.SPR_ARTIFACT_BROKER_TOKEN;
    const { artifactStoreConfigured, tryStoreArtifact } = await import('../src/integrations/artifact-store.ts');
    expect(artifactStoreConfigured()).toBe(false);
    await expect(tryStoreArtifact({
      tenantId: 'tenant',
      subjectId: 'scan',
      artifactType: 'artifact',
      extension: 'json',
      contentType: 'application/json',
      body: '{}',
    })).resolves.toBeNull();
  });
});
