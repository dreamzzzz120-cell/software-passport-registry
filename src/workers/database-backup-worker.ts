import { createHash, createHmac, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

function env(name: string): string {
  return process.env[name]?.trim() ?? '';
}

function configured(): boolean {
  return Boolean(
    env('DATABASE_URL') &&
    env('SPR_DB_BACKUP_S3_ENDPOINT') &&
    env('SPR_DB_BACKUP_S3_BUCKET') &&
    env('SPR_DB_BACKUP_S3_REGION') &&
    env('SPR_DB_BACKUP_S3_ACCESS_KEY_ID') &&
    env('SPR_DB_BACKUP_S3_SECRET_ACCESS_KEY'),
  );
}

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: Uint8Array | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function signingKey(secret: string, date: string, region: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 's3');
  return hmac(kService, 'aws4_request');
}

function encodePath(path: string): string {
  return path.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

async function putObject(body: Buffer, key: string): Promise<void> {
  const endpoint = new URL(env('SPR_DB_BACKUP_S3_ENDPOINT'));
  const bucket = env('SPR_DB_BACKUP_S3_BUCKET');
  const region = env('SPR_DB_BACKUP_S3_REGION');
  const accessKey = env('SPR_DB_BACKUP_S3_ACCESS_KEY_ID');
  const secretKey = env('SPR_DB_BACKUP_S3_SECRET_ACCESS_KEY');

  const host = `${bucket}.${endpoint.host}`;
  const canonicalUri = `/${encodePath(key)}`;
  const url = `${endpoint.protocol}//${host}${canonicalUri}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const shortDate = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    'PUT',
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${shortDate}/${region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256(canonicalRequest),
  ].join('\n');
  const signature = createHmac('sha256', signingKey(secretKey, shortDate, region))
    .update(stringToSign)
    .digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      authorization,
      'content-type': 'application/octet-stream',
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    },
    body,
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`DB_BACKUP_UPLOAD_FAILED:${response.status}:${detail.slice(0, 180)}`);
  }
}

export async function runDatabaseBackupOnce(): Promise<void> {
  if (!configured()) {
    console.info('[DBBackup] not configured; skipping');
    return;
  }

  const id = randomUUID();
  const file = `/tmp/spr-db-backup-${id}.dump`;
  const startedAt = new Date();

  try {
    await execFileAsync('pg_dump', [
      '--format=custom',
      '--compress=9',
      '--no-owner',
      '--no-acl',
      '--file',
      file,
      env('DATABASE_URL'),
    ], {
      timeout: 10 * 60 * 1000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, PGPASSWORD: '' },
    });

    const body = await readFile(file);
    if (body.byteLength === 0) throw new Error('DB_BACKUP_EMPTY');

    const date = startedAt.toISOString().slice(0, 10);
    const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
    const key = `postgres/${date}/spr-${stamp}.dump`;
    await putObject(body, key);

    console.info('[DBBackup] completed', JSON.stringify({
      key,
      bytes: body.byteLength,
      sha256: `sha256:${sha256(body)}`,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
    }));
  } finally {
    await unlink(file).catch(() => undefined);
  }
}

export async function runDatabaseBackupLoop(): Promise<void> {
  const interval = Math.max(
    60 * 60 * 1000,
    Number.parseInt(env('SPR_DB_BACKUP_INTERVAL_MS') || String(DEFAULT_INTERVAL_MS), 10) || DEFAULT_INTERVAL_MS,
  );

  await runDatabaseBackupOnce();
  await new Promise(resolve => setTimeout(resolve, interval));
}
