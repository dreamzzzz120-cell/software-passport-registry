import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import crypto from 'node:crypto';
import { AuthenticatedRequest, requireRole } from '../middleware/security.ts';

const writeRoles = ['Owner','Admin','Technician'];
const id = (prefix:string) => `${prefix}_${crypto.randomUUID().replaceAll('-','')}`;

const folderSchema = z.object({
  name: z.string().trim().min(1).max(200),
  parentFolderId: z.string().trim().min(1).max(255).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
}).strict();

const fileSchema = z.object({
  originalName: z.string().trim().min(1).max(512),
  displayName: z.string().trim().min(1).max(512).optional(),
  folderId: z.string().trim().min(1).max(255).nullable().optional(),
  objectFileId: z.string().trim().min(1).max(255).nullable().optional(),
  contentType: z.string().trim().min(1).max(255).default('application/octet-stream'),
  byteSize: z.number().int().min(0).default(0),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
  category: z.string().trim().min(1).max(64).default('other'),
  tags: z.array(z.string().trim().min(1).max(64)).max(50).default([]),
  description: z.string().trim().max(5000).nullable().optional(),
  version: z.string().trim().max(128).nullable().optional(),
  ownerUserId: z.number().int().positive().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
}).strict();

const patchSchema = z.object({
  displayName: z.string().trim().min(1).max(512).optional(),
  folderId: z.string().trim().min(1).max(255).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  category: z.string().trim().min(1).max(64).optional(),
  version: z.string().trim().max(128).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  lifecycleStatus: z.enum(['active','archived','deleted']).optional(),
}).strict();

const linkSchema = z.object({
  linkType: z.enum(['client','passport','scan','evidence','finding','vendor','report']),
  targetId: z.string().trim().min(1).max(255),
}).strict();

function fileJson(r:any) {
  return { id:r.id, folderId:r.folder_id, objectFileId:r.object_file_id, originalName:r.original_name,
    displayName:r.display_name, contentType:r.content_type, byteSize:r.byte_size, sha256:r.sha256,
    category:r.category, tags:r.tags, description:r.description, version:r.version, ownerUserId:r.owner_user_id,
    expiresAt:r.expires_at, securityStatus:r.security_status, lifecycleStatus:r.lifecycle_status,
    source:r.source, metadata:r.metadata, createdAt:r.created_at, updatedAt:r.updated_at };
}
function folderJson(r:any) { return { id:r.id, parentFolderId:r.parent_folder_id, name:r.name, description:r.description, createdAt:r.created_at, updatedAt:r.updated_at }; }

async function audit(req:AuthenticatedRequest, fileId:string|null, action:string, outcome='allowed', metadata:any={}) {
  await req.db!.execute(sql`INSERT INTO user_file_audit (tenant_id,file_id,actor_user_id,action,outcome,request_id,metadata) VALUES (${req.user!.tenantId},${fileId},${Number(req.user!.id) || null},${action},${outcome},${req.res?.locals?.requestId ?? null},${JSON.stringify(metadata)}::jsonb)`);
}

export function createUserFilesRouter() {
  const router=Router();

  router.get('/folders', async(req:AuthenticatedRequest,res,next)=>{
    try {
      const rows=(await req.db!.execute(sql`SELECT * FROM user_file_folders WHERE tenant_id=${req.user!.tenantId} AND deleted_at IS NULL ORDER BY name ASC`) as any).rows||[];
      return res.json(rows.map(folderJson));
    } catch(e){return next(e);}
  });

  router.post('/folders', requireRole(writeRoles), async(req:AuthenticatedRequest,res,next)=>{
    const p=folderSchema.safeParse(req.body); if(!p.success)return res.status(400).json({error:'INVALID_PAYLOAD',details:p.error.flatten()});
    try {
      const tenant=req.user!.tenantId;
      if(p.data.parentFolderId){
        const parent=(await req.db!.execute(sql`SELECT id FROM user_file_folders WHERE id=${p.data.parentFolderId} AND tenant_id=${tenant} AND deleted_at IS NULL`) as any).rows?.[0];
        if(!parent)return res.status(404).json({error:'PARENT_FOLDER_NOT_FOUND'});
      }
      const folderId=id('folder');
      const row=(await req.db!.execute(sql`INSERT INTO user_file_folders (id,tenant_id,parent_folder_id,name,description,created_by) VALUES (${folderId},${tenant},${p.data.parentFolderId ?? null},${p.data.name},${p.data.description ?? null},${req.user!.uid}) RETURNING *`) as any).rows?.[0];
      return res.status(201).json(folderJson(row));
    }catch(e){return next(e);}
  });

  router.get('/', async(req:AuthenticatedRequest,res,next)=>{
    try {
      const tenant=req.user!.tenantId, folder=typeof req.query.folderId==='string'?req.query.folderId:null, category=typeof req.query.category==='string'?req.query.category:null, q=typeof req.query.q==='string'?req.query.q.trim():null;
      const rows=(await req.db!.execute(sql`SELECT * FROM user_files WHERE tenant_id=${tenant} AND lifecycle_status <> 'deleted' AND (${folder} IS NULL OR folder_id=${folder}) AND (${category} IS NULL OR category=${category}) AND (${q} IS NULL OR display_name ILIKE '%'||${q}||'%' OR original_name ILIKE '%'||${q}||'%') ORDER BY updated_at DESC LIMIT 500`) as any).rows||[];
      return res.json(rows.map(fileJson));
    }catch(e){return next(e);}
  });

  router.post('/', requireRole(writeRoles), async(req:AuthenticatedRequest,res,next)=>{
    const p=fileSchema.safeParse(req.body); if(!p.success)return res.status(400).json({error:'INVALID_PAYLOAD',details:p.error.flatten()});
    try {
      const tenant=req.user!.tenantId;
      if(p.data.folderId){
        const ok=(await req.db!.execute(sql`SELECT 1 FROM user_file_folders WHERE id=${p.data.folderId} AND tenant_id=${tenant} AND deleted_at IS NULL`) as any).rows?.length;
        if(!ok)return res.status(404).json({error:'FOLDER_NOT_FOUND'});
      }
      if(p.data.objectFileId){
        const ok=(await req.db!.execute(sql`SELECT 1 FROM object_files WHERE id=${p.data.objectFileId} AND tenant_id=${tenant} AND deleted_at IS NULL`) as any).rows?.length;
        if(!ok)return res.status(404).json({error:'OBJECT_FILE_NOT_FOUND'});
      }
      const fileId=id('file');
      const row=(await req.db!.execute(sql`INSERT INTO user_files (id,tenant_id,folder_id,object_file_id,original_name,display_name,content_type,byte_size,sha256,category,tags,description,version,owner_user_id,expires_at,created_by) VALUES (${fileId},${tenant},${p.data.folderId ?? null},${p.data.objectFileId ?? null},${p.data.originalName},${p.data.displayName ?? p.data.originalName},${p.data.contentType},${p.data.byteSize},${p.data.sha256 ?? null},${p.data.category},${JSON.stringify([...new Set(p.data.tags)])}::jsonb,${p.data.description ?? null},${p.data.version ?? null},${p.data.ownerUserId ?? null},${p.data.expiresAt ?? null},${req.user!.uid}) RETURNING *`) as any).rows?.[0];
      await audit(req,fileId,'create');
      return res.status(201).json(fileJson(row));
    }catch(e){return next(e);}
  });

  router.patch('/:id', requireRole(writeRoles), async(req:AuthenticatedRequest,res,next)=>{
    const p=patchSchema.safeParse(req.body); if(!p.success)return res.status(400).json({error:'INVALID_PAYLOAD',details:p.error.flatten()});
    try {
      const tenant=req.user!.tenantId, idp=req.params.id;
      const current=(await req.db!.execute(sql`SELECT * FROM user_files WHERE id=${idp} AND tenant_id=${tenant} AND lifecycle_status <> 'deleted'`) as any).rows?.[0];
      if(!current)return res.status(404).json({error:'FILE_NOT_FOUND'});
      const folder=p.data.folderId===undefined?current.folder_id:p.data.folderId;
      if(folder){const ok=(await req.db!.execute(sql`SELECT 1 FROM user_file_folders WHERE id=${folder} AND tenant_id=${tenant} AND deleted_at IS NULL`) as any).rows?.length;if(!ok)return res.status(404).json({error:'FOLDER_NOT_FOUND'});}
      const row=(await req.db!.execute(sql`UPDATE user_files SET display_name=COALESCE(${p.data.displayName ?? null},display_name),folder_id=${folder},tags=COALESCE(${p.data.tags ? JSON.stringify([...new Set(p.data.tags)]) : null}::jsonb,tags),description=CASE WHEN ${p.data.description === undefined} THEN description ELSE ${p.data.description ?? null} END,category=COALESCE(${p.data.category ?? null},category),version=CASE WHEN ${p.data.version === undefined} THEN version ELSE ${p.data.version ?? null} END,expires_at=CASE WHEN ${p.data.expiresAt === undefined} THEN expires_at ELSE ${p.data.expiresAt ?? null} END,lifecycle_status=COALESCE(${p.data.lifecycleStatus ?? null},lifecycle_status),deleted_at=CASE WHEN ${p.data.lifecycleStatus}='deleted' THEN CURRENT_TIMESTAMP ELSE deleted_at END WHERE id=${idp} AND tenant_id=${tenant} RETURNING *`) as any).rows?.[0];
      await audit(req,idp,p.data.folderId!==undefined?'move':p.data.displayName?'rename':p.data.tags?'tag':'view');
      return res.json(fileJson(row));
    }catch(e){return next(e);}
  });

  router.post('/:id/links', requireRole(writeRoles), async(req:AuthenticatedRequest,res,next)=>{
    const p=linkSchema.safeParse(req.body);if(!p.success)return res.status(400).json({error:'INVALID_PAYLOAD',details:p.error.flatten()});
    try{
      const tenant=req.user!.tenantId,fileId=req.params.id;
      const file=(await req.db!.execute(sql`SELECT id FROM user_files WHERE id=${fileId} AND tenant_id=${tenant} AND lifecycle_status <> 'deleted'`) as any).rows?.[0];if(!file)return res.status(404).json({error:'FILE_NOT_FOUND'});
      const linkId=id('flink');
      const row=(await req.db!.execute(sql`INSERT INTO user_file_links (id,tenant_id,file_id,link_type,target_id,created_by) VALUES (${linkId},${tenant},${fileId},${p.data.linkType},${p.data.targetId},${req.user!.uid}) ON CONFLICT (tenant_id,file_id,link_type,target_id) DO UPDATE SET created_at=CURRENT_TIMESTAMP RETURNING *`) as any).rows?.[0];
      await audit(req,fileId,'link',{linkType:p.data.linkType,targetId:p.data.targetId});
      return res.status(201).json(row);
    }catch(e){return next(e);}
  });

  router.get('/:id/audit', async(req:AuthenticatedRequest,res,next)=>{
    try{
      const rows=(await req.db!.execute(sql`SELECT id,action,outcome,request_id,metadata,created_at FROM user_file_audit WHERE file_id=${req.params.id} AND tenant_id=${req.user!.tenantId} ORDER BY created_at DESC LIMIT 500`) as any).rows||[];
      return res.json(rows);
    }catch(e){return next(e);}
  });

  return router;
}
