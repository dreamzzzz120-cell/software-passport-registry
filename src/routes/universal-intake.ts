import crypto from 'node:crypto';
import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { db } from '../db/index.ts';
import { AuthenticatedRequest, requireAuth } from '../middleware/security.ts';

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_TOTAL_SIZE = 500 * 1024 * 1024;
const MAX_FILES_PER_SESSION = 100;
const MAX_FILENAME_LENGTH = 180;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const BUCKET = process.env.SPR_INTAKE_BUCKET?.trim() || 'spr-intake';

const ALLOWED_EXTENSIONS = new Set([
  'json', 'xml', 'spdx', 'yaml', 'yml', 'toml', 'lock',
  'js', 'jsx', 'ts', 'tsx', 'py', 'go', 'rs', 'java', 'cs', 'cpp', 'c', 'rb', 'php',
  'md', 'txt', 'pdf', 'doc', 'docx',
  'zip', 'tar', 'gz', 'tgz',
]);
const ALLOWED_MIME_TYPES = new Set([
  'application/json', 'application/xml', 'text/xml', 'application/spdx+json',
  'text/plain', 'text/markdown', 'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip', 'application/gzip', 'application/x-gzip', 'application/x-tar',
  'application/octet-stream', 'text/yaml', 'application/x-yaml',
]);

const fileSchema = z.object({
  name: z.string().trim().min(1).max(500),
  size: z.number().int().nonnegative().max(MAX_FILE_SIZE),
  contentType: z.string().trim().max(200).default('application/octet-stream'),
  kind: z.enum(['software', 'document', 'sbom', 'archive', 'unknown']).default('unknown'),
}).strict();

function id(prefix: string) { return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`; }
function extensionOf(name: string) {
  const base = name.split(/[\\/]/).pop() || '';
  const match = /\.([A-Za-z0-9]{1,12})$/.exec(base);
  return match?.[1]?.toLowerCase() || '';
}
function validateFilePolicy(file: { name: string; size: number; contentType: string; kind: string }) {
  if (file.size > MAX_FILE_SIZE) return 'File exceeds the 50 MB intake limit.';
  const normalized = file.name.normalize('NFKC');
  if (normalized !== file.name || /[\0\\/]/.test(file.name)) return 'Filename contains unsupported characters.';
  if (file.name.length > MAX_FILENAME_LENGTH) return 'Filename is too long.';
  const ext = extensionOf(file.name);
  if (!ext || !ALLOWED_EXTENSIONS.has(ext)) return 'File type is not supported for SPR intake.';
  if (file.contentType && !ALLOWED_MIME_TYPES.has(file.contentType.toLowerCase())) return 'File content type is not supported for SPR intake.';
  if (file.kind === 'archive' && !['zip', 'tar', 'gz', 'tgz'].includes(ext)) return 'Archive type does not match its filename.';
  if (file.kind === 'sbom' && !['json', 'xml', 'spdx'].includes(ext)) return 'SBOM type does not match its filename.';
  return null;
}
function safeName(value: string) {
  const normalized = value.normalize('NFKC').replace(/[\\/\0]/g, '_').replace(/[^A-Za-z0-9._()\- ]/g, '_').trim();
  return (normalized || 'file').slice(0, MAX_FILENAME_LENGTH);
}
function supabaseAdmin() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    const missing = [!url && 'SUPABASE_URL', !key && 'SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)'].filter(Boolean).join(' and ');
    console.error(`[Intake] Storage unavailable: ${missing} is not set.`);
    throw Object.assign(new Error(`Universal intake storage is not configured: ${missing} is not set.`), { status: 503 });
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function ensureBucket() {
  const client = supabaseAdmin();
  const { data, error } = await client.storage.getBucket(BUCKET);
  if (!data && error) {
    const created = await client.storage.createBucket(BUCKET, { public: false, fileSizeLimit: MAX_FILE_SIZE });
    if (created.error && !/already exists/i.test(created.error.message)) throw created.error;
    return client;
  }
  const currentLimit = (data as { file_size_limit?: number | null } | null)?.file_size_limit ?? null;
  if (data && currentLimit !== MAX_FILE_SIZE) {
    try {
      const updated = await client.storage.updateBucket(BUCKET, { public: false, fileSizeLimit: MAX_FILE_SIZE });
      if (updated.error) console.error(`[Intake] Could not reconcile bucket size limit: ${updated.error.message}`);
    } catch (err) { console.error(`[Intake] updateBucket threw while reconciling: ${err instanceof Error ? err.message : String(err)}`); }
  }
  return client;
}
async function loadSession(sessionId: string) {
  const result = await db.execute(sql`SELECT id, tenant_id AS "tenantId", status, expires_at AS "expiresAt" FROM intake_sessions WHERE id=${sessionId} LIMIT 1`);
  const row = (result as any).rows?.[0];
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() <= Date.now() || row.status !== 'OPEN') return null;
  return row;
}

export function createUniversalIntakeRouter() {
  const router = Router();

  router.post('/intake/session', async (_req, res, next) => {
    try {
      const sessionId = id('intake');
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
      await db.execute(sql`INSERT INTO intake_sessions (id,status,expires_at,created_at) VALUES (${sessionId},'OPEN',${expiresAt},NOW())`);
      return res.status(201).json({ sessionId, expiresAt });
    } catch (error) { return next(error); }
  });

  router.post('/intake/upload-url', async (req, res, next) => {
    try {
      const sessionId = z.string().regex(/^intake_[a-f0-9]{32}$/).safeParse(req.body?.sessionId);
      const file = fileSchema.safeParse(req.body?.file);
      if (!sessionId.success || !file.success) return res.status(400).json({ error: 'Invalid intake upload request.' });
      const policyError = validateFilePolicy(file.data);
      if (policyError) return res.status(415).json({ error: policyError });
      const session = await loadSession(sessionId.data);
      if (!session) return res.status(410).json({ error: 'Intake session expired or closed.' });
      const countResult = await db.execute(sql`SELECT COUNT(*)::int AS count, COALESCE(SUM(size),0)::bigint AS total_size FROM intake_items WHERE session_id=${session.id}`);
      const row = (countResult as any).rows?.[0] || {};
      const count = Number(row.count || 0);
      const totalSize = Number(row.total_size || 0);
      if (count >= MAX_FILES_PER_SESSION) return res.status(413).json({ error: 'The intake has reached its 100-file limit.' });
      if (totalSize + file.data.size > MAX_TOTAL_SIZE) return res.status(413).json({ error: 'The intake has reached its 500 MB total size limit.' });
      const itemId = id('item');
      const storagePath = `${session.id}/${itemId}/${safeName(file.data.name)}`;
      const client = await ensureBucket();
      let signed: { data: { token: string; signedUrl: string } | null; error: { message: string } | null };
      try {
        signed = await client.storage.from(BUCKET).createSignedUploadUrl(storagePath);
      } catch (err) {
        console.error(`[Intake] createSignedUploadUrl threw: ${err instanceof Error ? err.message : String(err)}`);
        throw err;
      }
      if (signed.error || !signed.data) throw signed.error || new Error('Could not create secure upload URL.');
      await db.execute(sql`INSERT INTO intake_items (id,session_id,name,size,content_type,kind,storage_bucket,storage_path,status,created_at) VALUES (${itemId},${session.id},${file.data.name},${file.data.size},${file.data.contentType},${file.data.kind},${BUCKET},${storagePath},'AWAITING_UPLOAD',NOW())`);
      return res.status(201).json({ itemId, path: storagePath, token: signed.data.token, signedUrl: signed.data.signedUrl, expiresAt: session.expiresAt });
    } catch (error) { return next(error); }
  });

  router.post('/intake/complete', async (req, res, next) => {
    try {
      const parsed = z.object({ sessionId: z.string().regex(/^intake_[a-f0-9]{32}$/), itemId: z.string().regex(/^item_[a-f0-9]{32}$/), sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional() }).strict().safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid intake completion request.' });
      const session = await loadSession(parsed.data.sessionId);
      if (!session) return res.status(410).json({ error: 'Intake session expired or closed.' });
      const itemResult = await db.execute(sql`SELECT id, name, size, content_type AS "contentType", storage_bucket AS bucket, storage_path AS path, status FROM intake_items WHERE id=${parsed.data.itemId} AND session_id=${session.id} LIMIT 1`);
      const item = (itemResult as any).rows?.[0];
      if (!item || item.status !== 'AWAITING_UPLOAD') return res.status(404).json({ error: 'Intake item not found or already completed.' });
      const client = await ensureBucket();
      const folder = item.path.split('/').slice(0, -1).join('/');
      const listed = await client.storage.from(item.bucket).list(folder, { limit: 10, search: item.path.split('/').pop() || undefined });
      if (listed.error) throw listed.error;
      const object = (listed.data || []).find((entry: any) => entry.name === item.path.split('/').pop());
      if (!object) return res.status(422).json({ error: 'Uploaded object was not found in secure storage.' });
      const observedSize = Number((object as any).metadata?.size ?? (object as any).metadata?.contentLength ?? -1);
      if (!Number.isFinite(observedSize) || observedSize !== Number(item.size)) {
        return res.status(422).json({ error: 'Uploaded object size does not match the declared size.' });
      }
      const result = await db.execute(sql`UPDATE intake_items SET status='UPLOADED', sha256=${parsed.data.sha256 ?? null}, uploaded_at=NOW() WHERE id=${parsed.data.itemId} AND session_id=${session.id} AND status='AWAITING_UPLOAD' RETURNING id, name, size, content_type AS "contentType", kind, storage_bucket AS "bucket", storage_path AS "path", sha256, status`);
      const updated = (result as any).rows?.[0];
      if (!updated) return res.status(409).json({ error: 'Intake item changed before completion.' });
      return res.status(200).json(updated);
    } catch (error) { return next(error); }
  });

  router.get('/intake/session/:id', async (req, res, next) => {
    try {
      const parsed = z.string().regex(/^intake_[a-f0-9]{32}$/).safeParse(req.params.id);
      if (!parsed.success) return res.status(404).json({ error: 'Intake session not found.' });
      const session = await loadSession(parsed.data);
      if (!session) return res.status(404).json({ error: 'Intake session not found.' });
      const result = await db.execute(sql`SELECT id, name, size, content_type AS "contentType", kind, status, sha256, created_at AS "createdAt", uploaded_at AS "uploadedAt" FROM intake_items WHERE session_id=${session.id} ORDER BY created_at ASC`);
      return res.json({ session: { id: session.id, status: session.status, expiresAt: session.expiresAt }, items: (result as any).rows || [] });
    } catch (error) { return next(error); }
  });

  router.post('/intake/claim', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const parsed = z.object({ sessionId: z.string().regex(/^intake_[a-f0-9]{32}$/) }).strict().safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Invalid intake claim request.' });
      const session = await loadSession(parsed.data.sessionId);
      if (!session) return res.status(410).json({ error: 'Intake session expired or closed.' });
      if (session.tenantId && session.tenantId !== req.user!.tenantId) return res.status(403).json({ error: 'Intake belongs to another workspace.' });
      await db.execute(sql`UPDATE intake_sessions SET tenant_id=${req.user!.tenantId}, status='CLAIMED', claimed_by=${req.user!.uid}, claimed_at=NOW() WHERE id=${session.id} AND (tenant_id IS NULL OR tenant_id=${req.user!.tenantId})`);
      await db.execute(sql`UPDATE intake_items SET tenant_id=${req.user!.tenantId}, status=CASE WHEN status='UPLOADED' THEN 'QUEUED' ELSE status END WHERE session_id=${session.id} AND (tenant_id IS NULL OR tenant_id=${req.user!.tenantId})`);
      return res.status(200).json({ success: true, sessionId: session.id, tenantId: req.user!.tenantId });
    } catch (error) { return next(error); }
  });

  return router;
}
