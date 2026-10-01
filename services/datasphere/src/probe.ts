import { randomUUID, createHash } from 'node:crypto';

const base=process.env.DATASPHERE_BASE_URL!;
const spr=process.env.DATASPHERE_SPR_INGEST_TOKEN!;
const con=process.env.DATASPHERE_CONSTELLATION_INGEST_TOKEN!;
const m2m=process.env.DATASPHERE_M2M_INGEST_TOKEN!;
const infra=process.env.DATASPHERE_INFRA_INGEST_TOKEN!;
const owner=process.env.DATASPHERE_OWNER_READ_TOKEN!;
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const tenant='probe-'+randomUUID();
const now=new Date().toISOString();
const baseEvent={
  eventId:randomUUID(),eventType:'probe.observation',schemaVersion:2,sourceSystem:'SPR',sourceIdentity:'probe-spr',
  sourceEventId:randomUUID(),tenantId:tenant,galaxyId:null,subjectType:'software',subjectId:'probe-subject',
  correlationId:'corr-'+randomUUID(),causationId:null,parentEventId:null,timestamp:now,observedAt:now,
  evidenceHash:sha('probe-evidence'),verificationState:'UNVERIFIED',
  cryptography:{algorithm:'TEST-ALG',keyId:'probe-key',signature:'probe-signature',verificationTime:now,verificationResult:'UNVERIFIED',metadata:{}},
  retentionClass:'STANDARD',limitations:['probe-only'],payload:{observed:true}
};
const results:Array<[string,number,number]>=[];

async function request(name:string,path:string,init?:RequestInit){
  const res=await fetch(base+path,init);
  let code:string|null=null;
  try{const body=await res.json() as any;code=body?.code??body?.receiptStatus??null}catch{}
  console.log(JSON.stringify({name,status:res.status,code}));
  return res.status;
}
async function expect(name:string,expected:number,path:string,init?:RequestInit){
  results.push([name,await request(name,path,init),expected]);
}
const postInit=(body:unknown,token?:string)=>({method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});

await expect('health',200,'/health');
await expect('ready',200,'/ready');
await expect('valid_spr',201,'/v1/events',postInit(baseEvent,spr));
await expect('duplicate_exact',200,'/v1/events',postInit(baseEvent,spr));
await expect('altered_replay',409,'/v1/events',postInit({...baseEvent,payload:{observed:false}},spr));
await expect('missing_auth',401,'/v1/events',postInit({...baseEvent,eventId:randomUUID(),sourceEventId:randomUUID()}));
await expect('spr_wrong_source',401,'/v1/events',postInit({...baseEvent,eventId:randomUUID(),sourceEventId:randomUUID(),sourceSystem:'CONSTELLATION'},spr));
await expect('con_wrong_source',401,'/v1/events',postInit({...baseEvent,eventId:randomUUID(),sourceEventId:randomUUID(),sourceSystem:'SPR'},con));
await expect('m2m_valid',201,'/v1/events',postInit({...baseEvent,eventId:randomUUID(),sourceEventId:randomUUID(),sourceSystem:'M2M',sourceIdentity:'probe-m2m'},m2m));
await expect('infra_valid',201,'/v1/events',postInit({...baseEvent,eventId:randomUUID(),sourceEventId:randomUUID(),sourceSystem:'INFRASTRUCTURE',sourceIdentity:'probe-infra'},infra));
await expect('portable_trustscore',400,'/v1/events',postInit({...baseEvent,eventId:randomUUID(),sourceEventId:randomUUID(),payload:{trustScore:100}},spr));
await expect('portable_nested_approved',400,'/v1/events',postInit({...baseEvent,eventId:randomUUID(),sourceEventId:randomUUID(),payload:{nested:{approved:true}}},spr));
await expect('bad_event_id',400,'/v1/events',postInit({...baseEvent,eventId:'not-a-uuid',sourceEventId:randomUUID()},spr));
await expect('bad_state',400,'/v1/events',postInit({...baseEvent,eventId:randomUUID(),sourceEventId:randomUUID(),verificationState:'PASS'},spr));
const missingCorrelation:any={...baseEvent,eventId:randomUUID(),sourceEventId:randomUUID()}; delete missingCorrelation.correlationId;
await expect('missing_correlation',400,'/v1/events',postInit(missingCorrelation,spr));
await expect('owner_verify',200,'/v1/internal/tenants/'+tenant+'/verify',{headers:{authorization:'Bearer '+owner}});
await expect('crypto_impact',200,'/v1/internal/crypto/algorithms/TEST-ALG/events',{headers:{authorization:'Bearer '+owner}});
await expect('owner_noauth_hidden',404,'/v1/internal/tenants/'+tenant+'/verify');

const failed=results.filter(([,actual,expected])=>actual!==expected);
if(failed.length){console.error(JSON.stringify({failed}));process.exit(1)}
console.log('DATASPHERE_PROBE_OK',results.length);
