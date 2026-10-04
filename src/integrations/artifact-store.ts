import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export type StoredArtifactRef = {
  provider: 'supabase-storage';
  bucket: string;
  path: string;
  sha256: string;
  bytes: number;
  contentType: string;
};

function env(name: string): string {
  return process.env[name]?.trim() ?? '';
}

function sha256(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function artifactStoreConfigured(): boolean {
  return Boolean(
    env('SPR_ARTIFACT_BROKER_URL')
    && env('SPR_ARTIFACT_BROKER_TOKEN')
    && env('SUPABASE_URL')
    && (env('SUPABASE_PUBLISHABLE_KEY') || env('VITE_SUPABASE_PUBLISHABLE_KEY')),
  );
}

export async function storeArtifact(input: {
  tenantId: string;
  subjectId: string;
  artifactType: string;
  extension: string;
  contentType: string;
  body: Uint8Array | string;
}): Promise<StoredArtifactRef> {
  if (!artifactStoreConfigured()) throw new Error('ARTIFACT_STORE_NOT_CONFIGURED');

  const brokerUrl = env('SPR_ARTIFACT_BROKER_URL');
  const brokerToken = env('SPR_ARTIFACT_BROKER_TOKEN');
  const supabaseUrl = env('SUPABASE_URL');
  const publishableKey = env('SUPABASE_PUBLISHABLE_KEY') || env('VITE_SUPABASE_PUBLISHABLE_KEY');

  const raw = typeof input.body === 'string' ? Buffer.from(input.body, 'utf8') : Buffer.from(input.body);
  const digest = sha256(raw);

  const brokerResponse = await fetch(brokerUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-spr-artifact-token': brokerToken,
    },
    body: JSON.stringify({
      tenantId: input.tenantId,
      subjectId: input.subjectId,
      artifactType: input.artifactType,
      extension: input.extension,
      contentType: input.contentType,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!brokerResponse.ok) {
    const detail = await brokerResponse.text().catch(() => '');
    throw new Error(`ARTIFACT_BROKER_${brokerResponse.status}:${detail.slice(0,120)}`);
  }

  const signed: any = await brokerResponse.json();
  if (!signed?.bucket || !signed?.path || !signed?.token) throw new Error('ARTIFACT_BROKER_INVALID_RESPONSE');

  const client = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await client.storage
    .from(String(signed.bucket))
    .uploadToSignedUrl(String(signed.path), String(signed.token), raw, {
      contentType: input.contentType,
      cacheControl: '31536000',
    });

  if (error) throw new Error(`ARTIFACT_UPLOAD_FAILED:${error.message.slice(0,160)}`);

  return {
    provider: 'supabase-storage',
    bucket: String(signed.bucket),
    path: String(signed.path),
    sha256: `sha256:${digest}`,
    bytes: raw.byteLength,
    contentType: input.contentType,
  };
}

export async function tryStoreArtifact(input: Parameters<typeof storeArtifact>[0]): Promise<StoredArtifactRef | null> {
  if (!artifactStoreConfigured()) return null;
  try {
    return await storeArtifact(input);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'artifact_store_failed',
      artifactType: input.artifactType,
      tenantId: input.tenantId,
      subjectId: input.subjectId,
      reason: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
    }));
    return null;
  }
}
