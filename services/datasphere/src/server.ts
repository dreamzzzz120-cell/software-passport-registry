import Fastify from 'fastify';
import postgres from 'postgres';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const env=z.object({
  PORT:z.coerce.number().int().positive().default(8080),
  DATABASE_URL:z.string().min(1),
  DATASPHERE_INGEST_TOKEN:z.string().min(32)
}).parse(process.env);

const app=Fastify({logger:true,bodyLimit:2*1024*1024});
const sql=postgres(env.DATABASE_URL,{prepare:false,max:10});
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
const stable=(v:unknown):string=>{
  if(v===null||typeof v!=='object')return JSON.stringify(v);
  if(Array.isArray(v))return '['+v.map(stable).join(',')+']';
  return '{'+Object.entries(v as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b))
    .map(([k,x])=>JSON.stringify(k)+':'+stable(x)).join(',')+'}';
};
const authorized=(h?:string)=>{
  const a=Buffer.from(h??''),b=Buffer.from('Bearer '+env.DATASPHERE_INGEST_TOKEN);
  return a.length===b.length&&timingSafeEqual(a,b);
};
const envelope=z.object({
  tenantId:z.string().min(1).max(200),
  sourceSystem:z.enum(['SPR','CONSTELLATION']),
  sourceEventId:z.string().min(1).max(300),
  eventType:z.string().min(1).max(200),
  subjectType:z.string().min(1).max(100),
  subjectId:z.string().min(1).max(300),
  observedAt:z.string().datetime({offset:true}),
  evidenceHash:z.string().regex(/^[0-9a-f]{64}$/),
  verificationState:z.enum(['VERIFIED','OBSERVED','DECLARED','UNKNOWN','STALE','CONFLICTING','UNAVAILABLE']),
  schemaVersion:z.number().int().positive().default(1),
  correlationId:z.string().max(300).nullable().optional(),
  parentEventId:z.string().max(300).nullable().optional(),
  retentionClass:z.string().min(1).max(100).default('STANDARD'),
  limitations:z.array(z.string().max(1000)).default([]),
  payload:z.record(z.string(),z.unknown())
});

app.get('/health',async()=>({ok:true,service:'datasphere'}));
app.get('/ready',async(_q,r)=>{
  try{await sql`SELECT 1`;return{ready:true}}
  catch{return r.code(503).send({ready:false,code:'DATABASE_UNAVAILABLE'})}
});

app.post('/v1/events',async(q,r)=>{
  if(!authorized(q.headers.authorization))return r.code(401).send({code:'UNAUTHORIZED'});
  const parsed=envelope.safeParse(q.body);
  if(!parsed.success)return r.code(400).send({code:'INVALID_EVENT',issues:parsed.error.issues});
  const e=parsed.data,payloadHash=sha(stable(e.payload));
  try{
    const result=await sql.begin(async tx=>{
      await tx`SELECT pg_advisory_xact_lock(hashtext(${e.tenantId}))`;
      const old=await tx<{id:string,event_hash:string}[]>`
        SELECT id,event_hash FROM datasphere_events
        WHERE tenant_id=${e.tenantId} AND source_system=${e.sourceSystem}
        AND source_event_id=${e.sourceEventId} LIMIT 1`;
      if(old[0])return{id:old[0].id,eventHash:old[0].event_hash,duplicate:true};
      const last=await tx<{event_hash:string}[]>`
        SELECT event_hash FROM datasphere_events WHERE tenant_id=${e.tenantId}
        ORDER BY received_at DESC,id DESC LIMIT 1`;
      const previousHash=last[0]?.event_hash??null;
      const eventHash=sha(stable({...e,payloadHash,previousHash,payload:undefined}));
      const rows=await tx<{id:string}[]>`
        INSERT INTO datasphere_events(
          tenant_id,source_system,source_event_id,event_type,subject_type,subject_id,observed_at,
          evidence_hash,payload_hash,previous_hash,event_hash,schema_version,verification_state,
          correlation_id,parent_event_id,retention_class,limitations,payload
        ) VALUES(
          ${e.tenantId},${e.sourceSystem},${e.sourceEventId},${e.eventType},${e.subjectType},${e.subjectId},
          ${e.observedAt},${e.evidenceHash},${payloadHash},${previousHash},${eventHash},${e.schemaVersion},
          ${e.verificationState},${e.correlationId??null},${e.parentEventId??null},${e.retentionClass},
          ${JSON.stringify(e.limitations)},${JSON.stringify(e.payload)}
        ) RETURNING id`;
      return{id:rows[0]!.id,eventHash,duplicate:false};
    });
    return r.code(result.duplicate?200:201).send(result);
  }catch(error){
    q.log.error({error},'datasphere ingest failed');
    return r.code(503).send({code:'INGEST_UNAVAILABLE'});
  }
});

process.on('SIGTERM',()=>void sql.end({timeout:5}));
await app.listen({port:env.PORT,host:'0.0.0.0'});
