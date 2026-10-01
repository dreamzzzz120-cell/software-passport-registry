import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const config=z.object({
  DATASPHERE_URL:z.string().url(),
  DATASPHERE_M2M_INGEST_TOKEN:z.string().min(32),
  DATASPHERE_M2M_SOURCE_IDENTITY:z.string().min(1)
});

export type DatasphereState='OBSERVED'|'VERIFIED'|'UNVERIFIED'|'CONFLICTING'|'INVALID'|'UNKNOWN';
export interface DatasphereEvent{
  eventId?:string; tenantId:string; sourceEventId:string; eventType:string; subjectType:string; subjectId:string;
  observedAt:string; timestamp?:string; evidenceHash:string; verificationState:DatasphereState;
  schemaVersion?:number; galaxyId?:string|null; correlationId?:string|null; causationId?:string|null;
  parentEventId?:string|null; retentionClass?:string; limitations?:string[];
  cryptography?:{algorithm:string;keyId:string|null;signature:string|null;verificationTime:string;verificationResult:DatasphereState;metadata?:Record<string,unknown>};
  payload:Record<string,unknown>;
}

export async function emitM2MDatasphereEvent(event:DatasphereEvent,env:NodeJS.ProcessEnv=process.env){
  const c=config.safeParse(env);
  if(!c.success)return{delivered:false,code:'DATASPHERE_NOT_CONFIGURED' as const};
  const now=new Date().toISOString();
  const body={
    ...event,eventId:event.eventId??randomUUID(),sourceSystem:'M2M',sourceIdentity:c.data.DATASPHERE_M2M_SOURCE_IDENTITY,
    timestamp:event.timestamp??now,schemaVersion:event.schemaVersion??2,correlationId:event.correlationId??event.sourceEventId,
    causationId:event.causationId??null,galaxyId:event.galaxyId??null,parentEventId:event.parentEventId??null,
    retentionClass:event.retentionClass??'STANDARD',limitations:event.limitations??[],
    cryptography:event.cryptography??{algorithm:'SOURCE_TOKEN_AUTH',keyId:null,signature:null,verificationTime:now,verificationResult:'UNVERIFIED',metadata:{}}
  };
  const response=await fetch(new URL('/v1/events',c.data.DATASPHERE_URL),{
    method:'POST',
    headers:{'content-type':'application/json','authorization':`Bearer ${c.data.DATASPHERE_M2M_INGEST_TOKEN}`},
    body:JSON.stringify(body)
  });
  if(!response.ok)throw new Error(`DATASPHERE_INGEST_FAILED_${response.status}`);
  return{delivered:true,receipt:await response.json()};
}
