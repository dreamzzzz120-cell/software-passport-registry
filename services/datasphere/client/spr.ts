import { z } from 'zod';

const config=z.object({
  DATASPHERE_URL:z.string().url(),
  DATASPHERE_INGEST_TOKEN:z.string().min(32)
});

export type DatasphereState='VERIFIED'|'OBSERVED'|'DECLARED'|'UNKNOWN'|'STALE'|'CONFLICTING'|'UNAVAILABLE';
export interface DatasphereEvent{
  tenantId:string; sourceEventId:string; eventType:string; subjectType:string; subjectId:string;
  observedAt:string; evidenceHash:string; verificationState:DatasphereState;
  schemaVersion?:number; correlationId?:string|null; parentEventId?:string|null;
  retentionClass?:string; limitations?:string[]; payload:Record<string,unknown>;
}

export async function emitSprDatasphereEvent(event:DatasphereEvent,env:NodeJS.ProcessEnv=process.env){
  const c=config.safeParse(env);
  if(!c.success)return{delivered:false,code:'DATASPHERE_NOT_CONFIGURED' as const};
  const response=await fetch(new URL('/v1/events',c.data.DATASPHERE_URL),{
    method:'POST',
    headers:{'content-type':'application/json','authorization':`Bearer ${c.data.DATASPHERE_INGEST_TOKEN}`},
    body:JSON.stringify({...event,sourceSystem:'SPR'})
  });
  if(!response.ok)throw new Error(`DATASPHERE_INGEST_FAILED_${response.status}`);
  return{delivered:true,receipt:await response.json()};
}
