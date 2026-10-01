import { randomUUID, createHash } from 'node:crypto';

const base=process.env.DATASPHERE_BASE_URL!;
const spr=process.env.DATASPHERE_SPR_INGEST_TOKEN!;
const owner=process.env.DATASPHERE_OWNER_READ_TOKEN!;
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');

const tenant='probe-'+randomUUID();
const sourceEventId=randomUUID();
const now=new Date().toISOString();
const event={
  eventId:randomUUID(),eventType:'probe.observation',schemaVersion:2,sourceSystem:'SPR',sourceIdentity:'probe-spr',
  sourceEventId,tenantId:tenant,galaxyId:null,subjectType:'software',subjectId:'probe-subject',
  correlationId:'corr-'+randomUUID(),causationId:null,parentEventId:null,timestamp:now,observedAt:now,
  evidenceHash:sha('probe-evidence'),verificationState:'UNVERIFIED',
  cryptography:{algorithm:'TEST-ALG',keyId:'probe-key',signature:'probe-signature',verificationTime:now,verificationResult:'UNVERIFIED',metadata:{}},
  retentionClass:'STANDARD',limitations:['probe-only'],payload:{observed:true}
};

async function request(name:string,path:string,init?:RequestInit){
  const res=await fetch(base+path,init);
  let code:string|null=null;
  try{const body=await res.json() as any;code=body?.code??body?.receiptStatus??null}catch{}
  console.log(JSON.stringify({name,status:res.status,code}));
  return res.status;
}
const post=(body:unknown,token?:string)=>request('post','/v1/events',{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});

const results=[
  ['health',await request('health','/health'),200],
  ['ready',await request('ready','/ready'),200],
  ['valid',await post(event,spr),201],
  ['duplicate',await post(event,spr),200],
  ['altered',await post({...event,payload:{observed:false}},spr),409],
  ['noauth',await post({...event,eventId:randomUUID(),sourceEventId:randomUUID()}),401],
  ['verify',await request('verify','/v1/internal/tenants/'+tenant+'/verify',{headers:{authorization:'Bearer '+owner}}),200]
] as const;

const failed=results.filter(([,actual,expected])=>actual!==expected);
if(failed.length){console.error(JSON.stringify({failed}));process.exit(1)}
console.log('DATASPHERE_PROBE_OK');
