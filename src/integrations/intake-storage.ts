function env(name: string): string {
  return process.env[name]?.trim() ?? '';
}

function brokerConfig() {
  const url = env('SPR_ARTIFACT_BROKER_URL');
  const token = env('SPR_ARTIFACT_BROKER_TOKEN');
  if (!url || !token) throw Object.assign(new Error('INTAKE_BROKER_NOT_CONFIGURED'), { status: 503 });
  return { url, token };
}

async function brokerRequest(body: Record<string, unknown>) {
  const { url, token } = brokerConfig();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-spr-artifact-token': token,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw Object.assign(new Error(`INTAKE_BROKER_${response.status}:${detail.slice(0, 160)}`), { status: response.status >= 500 ? 503 : 502 });
  }
  return response.json() as Promise<any>;
}

export function intakeBrokerConfigured(): boolean {
  return Boolean(env('SPR_ARTIFACT_BROKER_URL') && env('SPR_ARTIFACT_BROKER_TOKEN'));
}

export async function createIntakeSignedUpload(input: {
  sessionId: string;
  itemId: string;
  fileName: string;
  contentType: string;
}) {
  const signed = await brokerRequest({ action: 'intake-upload', ...input });
  if (!signed?.bucket || !signed?.path || !signed?.token || !signed?.signedUrl) throw new Error('INTAKE_BROKER_INVALID_UPLOAD_RESPONSE');
  return {
    bucket: String(signed.bucket),
    path: String(signed.path),
    token: String(signed.token),
    signedUrl: String(signed.signedUrl),
  };
}

export async function downloadIntakeObject(input: { bucket: string; path: string }): Promise<Buffer> {
  const signed = await brokerRequest({ action: 'intake-download', bucket: input.bucket, path: input.path });
  if (!signed?.signedUrl) throw new Error('INTAKE_BROKER_INVALID_DOWNLOAD_RESPONSE');
  const response = await fetch(String(signed.signedUrl), { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`INTAKE_DOWNLOAD_${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteIntakeObject(input: { bucket: string; path: string }): Promise<void> {
  const result = await brokerRequest({ action: 'intake-delete', bucket: input.bucket, path: input.path });
  if (result?.deleted !== true) throw new Error('INTAKE_BROKER_DELETE_FAILED');
}
