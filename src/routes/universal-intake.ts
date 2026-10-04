import crypto from 'node:crypto';
import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index.ts';
import { AuthenticatedRequest, requireAuth } from '../middleware/security.ts';
import { createIntakeSignedUpload, deleteIntakeObject, downloadIntakeObject } from '../integrations/intake-storage.ts';

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_TOTAL_SIZE = 500 * 1024 * 1024;
const MAX_FILES_PER_SESSION = 100;
const MAX_FILENAME_LENGTH = 180;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const BUCKET = process.env.SPR_INTAKE_BUCKET?.trim() || 'spr-intake';

// Source/config extensions (js..toml below) have no standardized MIME type --
// browsers guess wildly and inconsistently across OS/vendor (a .ts file is
// notoriously reported as 'video/mp2t' by some browsers, .py/.go/.rs/.toml
// are often reported blank). The extension allowlist plus size/filename
// checks below are the real gate for these; DOCUMENT_MIME_TYPES is the
// stricter, meaningful check reserved for formats where a MIME mismatch is
// actually a useful signal (documents and archives).
const SOURCE_EXTENSIONS = new Set(['json', 'xml', 'spdx', 'yaml', 'yml', 'toml', 'lock', 'js', 'jsx', 'ts', 'tsx', 'py', 'go', 'rs', 'java', 'cs', 'cpp', 'c', 'rb', 'php', 'md', 'txt']);
const DOCUMENT_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'zip', 'tar', 'gz', 'tgz']);
const ALLOWED_EXTENSIONS = new Set([...SOURCE_EXTENSIONS, ...DOCUMENT_EXTENSIONS]);
const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip', 'application/x-zip-compressed', 'multipart/x-zip',
  'application/gzip', 'application/x-gzip', 'application/x-compressed',
  'application/x-tar',
  'application/octet-stream',
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
export function validateFilePolicy(file: { name: string; size: number; contentType: string; kind: string }) {
  if (file.size > MAX_FILE_SIZE) return 'File exceeds the 50 MB intake limit.';
  const normalized = file.name.normalize('NFKC');
  if (normalized !== file.name || /[\0\\/]/.test(file.name)) return 'Filename contains unsupported characters.';
  if (file.name.length > MAX_FILENAME_LENGTH) return 'Filename is too long.';
  const ext = extensionOf(file.name);
  if (!ext || !ALLOWED_EXTENSIONS.has(ext)) return 'File type is not supported for SPR intake.';
  // Only document/archive extensions get a strict MIME check -- a mismatch
  // there (e.g. an .exe renamed to .pdf) is a real signal. Source/config
  // extensions accept whatever the browser reported, since there's no
  // standardized MIME type to check it against.
  if (DOCUMENT_EXTENSIONS.has(ext) && file.contentType && !DOCUMENT_MIME_TYPES.has(file.contentType.toLowerCase())) {
    return 'File content type is not supported for SPR intake.';
  }
  if (file.kind === 'archive' && !['zip', 'tar', 'gz', 'tgz'].includes(ext)) return 'Archive type does not match its filename.';
  if (file.kind === 'sbom' && !['json', 'xml', 'spdx'].includes(ext)) return 'SBOM type does not match its filename.';
  return null;
}
export function validateObservedFileSignature(name: string, bytes: Buffer): string | null {
  const ext = extensionOf(name);
  if (ext === 'pdf' && !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) return 'Uploaded bytes do not match the declared PDF type.';
  if (ext === 'zip' || ext === 'docx') {
    const zip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06) || (bytes[2] === 0x07 && bytes[3] === 0x08));
    if (!zip) return 'Uploaded bytes do not match the declared ZIP-based type.';
  }
  if ((ext === 'gz' || ext === 'tgz') && !(bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b)) return 'Uploaded bytes do not match the declared GZIP type.';
  if (ext === 'tar' && !(bytes.length >= 262 && bytes.subarray(257, 262).equals(Buffer.from('ustar')))) return 'Uploaded bytes do not match the declared TAR type.';
  return null;
}
function safeName(value: string) {
  const normalized = value.normalize('NFKC').replace(/[\\/\0]/g, '_').replace(/[^A-Za-z0-9._()\- ]/g, '_').trim();
  return (normalized || 'file').slice(0, MAX_FILENAME_LENGTH);
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
      const signed = await createIntakeSignedUpload({
        sessionId: session.id,
        itemId,
        fileName: safeName(file.data.name),
        contentType: file.data.contentType,
      });
      if (signed.bucket !== BUCKET || signed.path !== storagePath) throw new Error('INTAKE_BROKER_PATH_MISMATCH');
      await db.execute(sql`INSERT INTO intake_items (id,session_id,name,size,content_type,kind,storage_bucket,storage_path,status,created_at) VALUES (${itemId},${session.id},${file.data.name},${file.data.size},${file.data.contentType},${file.data.kind},${signed.bucket},${signed.path},'AWAITING_UPLOAD',NOW())`);
      return res.status(201).json({ itemId, path: signed.path, token: signed.token, signedUrl: signed.signedUrl, expiresAt: session.expiresAt });
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
      // The client-reported sha256 (if any) is never trusted as the record of
      // truth. The broker returns a short-lived read URL and SPR hashes the
      // exact bytes it observes before the item can become QUEUED.
      let bytes: Buffer;
      try {
        bytes = await downloadIntakeObject({ bucket: item.bucket, path: item.path });
      } catch {
        return res.status(422).json({ error: 'Could not read the uploaded object to verify its contents.' });
      }
      if (bytes.length !== Number(item.size)) {
        await deleteIntakeObject({ bucket: item.bucket, path: item.path }).catch(() => undefined);
        await db.execute(sql`UPDATE intake_items SET status='FAILED' WHERE id=${parsed.data.itemId} AND session_id=${session.id} AND status='AWAITING_UPLOAD'`);
        return res.status(422).json({ error: 'Uploaded object size does not match the declared size.' });
      }
      const signatureError = validateObservedFileSignature(item.name, bytes);
      if (signatureError) {
        await deleteIntakeObject({ bucket: item.bucket, path: item.path }).catch(() => undefined);
        await db.execute(sql`UPDATE intake_items SET status='FAILED' WHERE id=${parsed.data.itemId} AND session_id=${session.id} AND status='AWAITING_UPLOAD'`);
        return res.status(415).json({ error: signatureError });
      }
      const serverSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      if (parsed.data.sha256 && parsed.data.sha256 !== serverSha256) {
        console.warn(`[Intake] Client-reported sha256 for item ${parsed.data.itemId} did not match the server-computed hash; the server-computed value is what was persisted.`);
      }
      const result = await db.execute(sql`UPDATE intake_items SET status='UPLOADED', sha256=${serverSha256}, uploaded_at=NOW() WHERE id=${parsed.data.itemId} AND session_id=${session.id} AND status='AWAITING_UPLOAD' RETURNING id, name, size, content_type AS "contentType", kind, storage_bucket AS "bucket", storage_path AS "path", sha256, status`);
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
