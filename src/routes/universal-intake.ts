import crypto from 'node:crypto';
import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { db } from '../db/index.ts';
import { AuthenticatedRequest, requireAuth } from '../middleware/security.ts';

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const MAX_FILES_PER_SESSION = 100;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const BUCKET = process.env.SPR_INTAKE_BUCKET?.trim() || 'spr-intake';

const fileSchema = z.object({
  name: z.string().trim().min(1).max(500),
  size: z.number().int().nonnegative().max(MAX_FILE_SIZE),
  contentType: z.string().trim().max(200).default('application/octet-stream'),
  kind: z.enum(['software', 'document', 'sbom', 'archive', 'unknown']).default('unknown'),
}).strict();

function id(prefix: string) { return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`; }
function safeName(value: string) {
  const normalized = value.normalize('NFKC').replace(/[\\/\0]/g, '_').replace(/[^A-Za-z0-9._()\- ]/g, '_').trim();
  return (normalized || 'file').slice(0, 180);
}
function supabaseAdmin() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw Object.assign(new Error('Universal intake storage is not configured.'), { status: 503 });
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function ensureBucket() {
  const client = supabaseAdmin();
  const { data, error } = await client.storage.getBucket(BUCKET);
  if (!data && error) {
    const created = await client.storage.createBucket(BUCKET, { public: false, fileSizeLimit: `${MAX_FILE_SIZE}B` });
    if (created.error && !/already exists/i.test(created.error.message)) throw created.error;
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

  // Anonymous, short-lived quarantine session. The random session id is the
  // bearer credential for the pre-signup intake; it contains no tenant data.
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
      const session = await loadSession(sessionId.data);
      if (!session) return res.status(410).json({ error: 'Intake session expired or closed.' });
      const countResult = await db.execute(sql`SELECT COUNT(*)::int AS count FROM intake_items WHERE session_id=${session.id}`);
      const count = Number((countResult as any).rows?.[0]?.count || 0);
      if (count >= MAX_FILES_PER_SESSION) return res.status(413).json({ error: 'The intake has reached its 100-file limit.' });
      if (file.data.size > MAX_FILE_SIZE) return res.status(413).json({ error: 'File exceeds the 100 MB intake limit.' });
      const itemId = id('item');
      const storagePath = `${session.id}/${itemId}/${safeName(file.data.name)}`;
      const client = await ensureBucket();
      const signed = await client.storage.from(BUCKET).createSignedUploadUrl(storagePath);
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
      const result = await db.execute(sql`UPDATE intake_items SET status='UPLOADED', sha256=${parsed.data.sha256 ?? null}, uploaded_at=NOW() WHERE id=${parsed.data.itemId} AND session_id=${session.id} AND status='AWAITING_UPLOAD' RETURNING id, name, size, content_type AS "contentType", kind, storage_bucket AS "bucket", storage_path AS "path", sha256, status`);
      const row = (result as any).rows?.[0];
      if (!row) return res.status(404).json({ error: 'Intake item not found or already completed.' });
      return res.status(200).json(row);
    } catch (error) { return next(error); }
  });

  router.get('/intake/session/:id', async (req, res, next) => {
    try {
      const session = await loadSession(req.params.id);
      if (!session) return res.status(404).json({ error: 'Intake session not found.' });
      const result = await db.execute(sql`SELECT id, name, size, content_type AS "contentType", kind, status, sha256, created_at AS "createdAt", uploaded_at AS "uploadedAt" FROM intake_items WHERE session_id=${session.id} ORDER BY created_at ASC`);
      return res.json({ session, items: (result as any).rows || [] });
    } catch (error) { return next(error); }
  });

  // Claim is authenticated and billing-exempt by design: it only transfers
  // already-quarantined evidence into the caller's existing workspace.
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
