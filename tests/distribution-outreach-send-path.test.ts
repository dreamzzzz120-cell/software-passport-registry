import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const state=vi.hoisted(()=>({ pg:null as any, sends:[] as any[] }));
vi.mock('../src/db/index.ts',()=>({ db:{},appPool:{connect:async()=>({query:(q:string,p?:any[])=>state.pg.query(q,p),release(){}})} }));
vi.mock('../src/lib/branded-email.ts',async original=>({
  ...await original<any>(),sendBrandedEmail:async(...args:any[])=>{state.sends.push(args);return 'provider-real-path-test';},
}));
import { sendInitial, sendDueFollowups, queueContact, unsubscribeContact, outreachToken } from '../src/lib/distribution-outreach.ts';
import { settingsSchema } from '../src/routes/distribution-growth.ts';
const tenant='tenant-free-review-system';
const env={...process.env};
beforeAll(async()=>{
  state.pg=new PGlite();
  for(const file of ['0083_distribution_engine.sql','0087_autonomous_distribution_outreach.sql','0093_distribution_growth_engine.sql','0094_distribution_followup_stage_guard.sql','0095_distribution_sender_verification.sql','0142_scale_distribution_daily_cap.sql','0143_distribution_send_reservations.sql']) await state.pg.exec(readFileSync('migrations/'+file,'utf8'));
  await state.pg.exec(`CREATE TABLE q_legion_settings (tenant_id text, strategy_execution_enabled boolean);
    ALTER TABLE distribution_messages ADD COLUMN q_legion_mission_id text, ADD COLUMN q_legion_strategy_id text, ADD COLUMN q_legion_strategy_probability double precision;`);
});
afterAll(async()=>{await state.pg.close();});
beforeEach(async()=>{
  state.sends=[];
  Object.assign(process.env,{DISTRIBUTION_AUTONOMOUS_OUTREACH:'true',RESEND_API_KEY:'test',EMAIL_FROM:'transactional@example.test',DISTRIBUTION_OUTREACH_FROM:'SPR <sales@example.test>',DISTRIBUTION_OUTREACH_VERIFY_TO:'founder@example.test',DISTRIBUTION_LI_ATTESTED:'true',SPR_PUBLIC_PASSPORT_SECRET:'test-secret'});
  await state.pg.exec(`TRUNCATE distribution_send_attempts,distribution_messages,distribution_contacts,distribution_sender_verifications;
    UPDATE distribution_campaign_settings SET outreach_enabled=true,daily_send_cap=1000,last_send_reserved_at=NULL;`);
  await state.pg.query(`INSERT INTO distribution_contacts (id,tenant_id,email,company,outreach_basis) VALUES ('c1',$1,'info@msp.example.test','MSP','legitimate_interest')`,[tenant]);
});
afterEach(()=>{for(const k of Object.keys(process.env)) if(!(k in env)) delete process.env[k];Object.assign(process.env,env);});
async function verify(from='SPR <sales@example.test>',status='sent',id='verified') {
  await state.pg.query(`INSERT INTO distribution_sender_verifications (id,from_address,to_address,status,provider_message_id) VALUES ($1,$2,'founder@example.test',$3,'verification-provider-id')`,[id,from,status]);
}
describe('real outreach functions with PostgreSQL SQL and a controlled provider',()=>{
  it('accepts a 1,000 campaign setting and rejects 1,001',()=>{
    expect(settingsSchema.safeParse({dailySendCap:1000}).success).toBe(true);
    expect(settingsSchema.safeParse({dailySendCap:1001}).success).toBe(false);
  });
  it('blocks missing, failed, and mismatched sender verification before contacting anyone',async()=>{
    await expect(sendInitial('c1')).rejects.toThrow('SENDER_VERIFICATION_REQUIRED');
    await verify(undefined,'failed','failed');
    await expect(sendInitial('c1')).rejects.toThrow('SENDER_VERIFICATION_REQUIRED');
    await verify('SPR <other@example.test>','sent','other');
    await expect(sendInitial('c1')).rejects.toThrow('SENDER_VERIFICATION_REQUIRED');
    expect(state.sends).toHaveLength(0);
  });
  it('sends from the verified outreach address, persists the receipt, and uses a stable key',async()=>{
    await verify();
    const result=await sendInitial('c1');
    expect(state.sends).toHaveLength(1);
    expect(state.sends[0][4]).toEqual({from:'SPR <sales@example.test>',replyTo:'sales@example.test',idempotencyKey:result.messageId});
    expect((await state.pg.query(`SELECT status FROM distribution_send_attempts`)).rows[0].status).toBe('sent');
    expect((await state.pg.query(`SELECT provider_message_id FROM distribution_messages`)).rows[0].provider_message_id).toBe(result.providerId);
    await expect(sendInitial('c1')).rejects.toThrow('INITIAL_ALREADY_SENT');
    expect(state.sends).toHaveLength(1);
  });
  it('keeps outreach-basis attestation and consent-evidence gates enforced',async()=>{
    await verify();process.env.DISTRIBUTION_LI_ATTESTED='false';
    await expect(sendInitial('c1')).rejects.toThrow('LI_ATTESTATION_REQUIRED');
    await state.pg.query(`UPDATE distribution_contacts SET outreach_basis='consent'`);
    await expect(sendInitial('c1')).rejects.toThrow('CONSENT_EVIDENCE_REQUIRED');
    expect(state.sends).toHaveLength(0);
  });
  it('does not revive an unsubscribed address on rediscovery',async()=>{
    expect(await unsubscribeContact('info@msp.example.test',outreachToken('info@msp.example.test'))).toBe(true);
    expect(await queueContact('INFO@MSP.EXAMPLE.TEST','Again','https://msp.example.test',{},'legitimate_interest',null)).toBe('c1');
    expect((await state.pg.query(`SELECT status FROM distribution_contacts WHERE id='c1'`)).rows[0].status).toBe('unsubscribed');
    await verify();await expect(sendInitial('c1')).rejects.toThrow('NOT_ACTIVE');
    expect(state.sends).toHaveLength(0);
  });
  it('routes followups through the same reservation and stops after a reply',async()=>{
    await verify();await sendInitial('c1');
    await state.pg.query(`UPDATE distribution_messages SET q_legion_strategy_id='revenue_first',q_legion_strategy_probability=0.6 WHERE kind='initial'`);
    await state.pg.query(`UPDATE distribution_campaign_settings SET last_send_reserved_at=NULL`);
    await state.pg.query(`UPDATE distribution_contacts SET next_followup_at=NOW()-INTERVAL '1 day' WHERE id='c1'`);
    expect(await sendDueFollowups()).toBe(1);
    expect(state.sends).toHaveLength(2);
    expect(state.sends[1][1]).toMatch(/recurring software-assurance/);
    expect((await state.pg.query(`SELECT q_legion_strategy_probability FROM distribution_messages WHERE kind='followup'`)).rows[0].q_legion_strategy_probability).toBe(0.6);
    expect((await state.pg.query(`SELECT followup_count FROM distribution_contacts WHERE id='c1'`)).rows[0].followup_count).toBe(1);
    await state.pg.query(`UPDATE distribution_contacts SET pipeline_stage='replied' WHERE id='c1'`);
    expect(await sendDueFollowups()).toBe(0);
  });
});
