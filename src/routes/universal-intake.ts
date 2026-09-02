import crypto from 'node:crypto';
import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { db } from '../db/index.ts';
import { AuthenticatedRequest, requireAuth } from '../middleware/security.ts';

// 100MB was never reachable: production logs (after #71/#72 added the logging
// needed to see it) show createBucket rejected with a Supabase StorageApiError
// 400 "The object exceeded the maximum allowed size" for a fileSizeLimit of
// 104857600. That is Supabase's own project-wide storage cap rejecting the
// bucket's requested per-bucket limit, not anything this app controls. 50MB is
// Supabase's documented platform default global file size limit (raisable by
// the project owner in Dashboard -> Settings -> Storage, up to 5GB on paid
// plans) and the strongest evidenced value short of that dashboard setting
// being changed. If it is still rejected, the project's real cap is lower than
// even the platform default and the exact number will show in the same log line.
const MAX_FILE_SIZE = 50 * 1024 * 1024;
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
  // Supabase renamed the server-side key: projects created through the current
  // dashboard issue a "secret key" (SUPABASE_SECRET_KEY), while older ones issue
  // a service_role JWT (SUPABASE_SERVICE_ROLE_KEY). Production had the former and
  // this read only the latter, so every upload-url request answered
  // 503 "Universal intake storage is not configured" -- a visitor could stage
  // files through the homepage's headline feature and then hit a hard failure.
  // Accept either name rather than depending on which vintage a project is.
  const key = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    // Name what is missing. The previous message said only that storage was not
    // configured, which is why a variable-name mismatch survived a deploy.
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
    // fileSizeLimit was passed as `${MAX_FILE_SIZE}B` -- "104857600B". Supabase
    // parses that string with the `bytes` library, and the bucket was created
    // with a limit far below the intended 100MB, which is why production
    // rejected an 11-byte upload with 400 "The object exceeded the maximum
    // allowed size". A plain number is unambiguous: Supabase reads it as bytes.
    const created = await client.storage.createBucket(BUCKET, { public: false, fileSizeLimit: MAX_FILE_SIZE });
    if (created.error && !/already exists/i.test(created.error.message)) {
      // This throw previously carried no logging of its own, so a bucket that
      // failed to CREATE looked identical, from the logs, to one that never got
      // asked for -- both were silent. Production kept returning "The object
      // exceeded the maximum allowed size" for an 11-byte file after the string
      // "104857600B" bug was already fixed, and there was nothing here to say
      // why: whether Supabase rejected the 100MB request outright (a project
      // storage plan can cap this below what a bucket asks for) or something
      // else. `name`/`status` are logged alongside `message` because
      // supabase-js's own message text is not always specific enough on its own
      // to tell those cases apart.
      const err = created.error as { message: string; name?: string; status?: number; statusCode?: string | number };
      console.error(`[Intake] createBucket failed for "${BUCKET}" (requested fileSizeLimit=${MAX_FILE_SIZE}): name=${err.name ?? 'unknown'} status=${err.status ?? err.statusCode ?? 'unknown'} message=${err.message}`);
      throw created.error;
    }
    console.info(`[Intake] Created bucket "${BUCKET}" with fileSizeLimit=${MAX_FILE_SIZE}.`);
    return client;
  }
  // A bucket created by the earlier code still carries the bad limit, and
  // createBucket is never reached once the bucket exists -- so the broken limit
  // survives every deploy until something reconciles it.
  //
  // The limit is logged either way. It is the one number that explains the 400
  // and it is not otherwise observable from here: the Railway API returns the
  // Supabase keys redacted, so the bucket cannot be inspected directly.
  //
  // Reconciliation is best effort and fully contained: repairing a bucket must
  // never be the reason an upload fails. supabase-js raises for some failures
  // rather than returning { error }, and an uncaught raise here would surface as
  // the request's own error -- which is the shape of the failure already seen.
  const currentLimit = (data as { file_size_limit?: number | null } | null)?.file_size_limit ?? null;
  if (data && currentLimit !== MAX_FILE_SIZE) {
    console.info(`[Intake] Bucket "${BUCKET}" file_size_limit=${String(currentLimit)}; intended ${MAX_FILE_SIZE}. Reconciling.`);
    try {
      const updated = await client.storage.updateBucket(BUCKET, { public: false, fileSizeLimit: MAX_FILE_SIZE });
      if (updated.error) console.error(`[Intake] Could not reconcile bucket size limit: ${updated.error.message}`);
      else console.info(`[Intake] Bucket size limit reconciled to ${MAX_FILE_SIZE} bytes.`);
    } catch (err) {
      console.error(`[Intake] updateBucket threw while reconciling (limit stays ${String(currentLimit)}): ${err instanceof Error ? err.message : String(err)}`);
    }
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
      if (file.data.size > MAX_FILE_SIZE) return res.status(413).json({ error: 'File exceeds the 50 MB intake limit.' });
      const itemId = id('item');
      const storagePath = `${session.id}/${itemId}/${safeName(file.data.name)}`;
      const client = await ensureBucket();
      // Production returned 400 "The object exceeded the maximum allowed size"
      // for an 11-byte file, and NEITHER the "resolves with { error }" branch
      // below NOR ensureBucket's own logging ever fired for it -- confirmed live,
      // twice, after each was instrumented in turn. supabase-js does not always
      // resolve to { error } on failure; some failures reject the call instead
      // (the reconciliation branch above already assumes this for updateBucket,
      // but this call was never given the same assumption). An error that
      // rejects here previously reached the client with no [Intake] line at all.
      let signed: { data: { token: string; signedUrl: string } | null; error: { message: string; name?: string; status?: number; statusCode?: string | number } | null };
      try {
        signed = await client.storage.from(BUCKET).createSignedUploadUrl(storagePath);
      } catch (err) {
        const e = err as { message?: string; name?: string; status?: number; statusCode?: string | number };
        console.error(`[Intake] createSignedUploadUrl threw for bucket "${BUCKET}" (declared size ${file.data.size} bytes): name=${e?.name ?? 'unknown'} status=${e?.status ?? e?.statusCode ?? 'unknown'} message=${e?.message ?? String(err)}`);
        throw err;
      }
      if (signed.error || !signed.data) {
        // Name the call and the declared size so the next failure is explicable
        // from the logs rather than only from the customer's screen. The storage
        // path is derived from ids we generated, not from the uploaded filename,
        // so it discloses nothing about the user.
        const e = signed.error;
        console.error(`[Intake] createSignedUploadUrl failed for bucket "${BUCKET}" (declared size ${file.data.size} bytes): name=${e?.name ?? 'unknown'} status=${e?.status ?? e?.statusCode ?? 'unknown'} message=${e?.message ?? 'no data returned'}`);
        throw signed.error || new Error('Could not create secure upload URL.');
      }
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
