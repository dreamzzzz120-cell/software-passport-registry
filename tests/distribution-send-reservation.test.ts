import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
vi.mock('../src/db/index.ts', () => ({ db: {}, appPool: {} }));
import { withReservedOutreach } from '../src/lib/distribution-send-reservation.ts';
import { EmailProviderError } from '../src/lib/branded-email.ts';

const tenant = 'tenant-free-review-system';
let pg: PGlite;
let queue: Promise<void>;
let failReceipt: boolean;
// PGlite is one PostgreSQL session. Serialize leases so transactions cannot
// interleave on that session. This verifies real SQL and durable recovery,
// not PostgreSQL's multi-process row-lock implementation.
const pool = {
  async connect() {
    let release!: () => void;
    const turn = new Promise<void>(r => { release = r; });
    const previous = queue; queue = previous.then(() => turn); await previous;
    return {
      async query(text: string, params?: any[]) {
        if (failReceipt && /INSERT INTO distribution_messages/.test(text)) throw new Error('SIMULATED_RECEIPT_FAILURE');
        return pg.query(text, params);
      },
      release,
    };
  },
};

beforeEach(async () => {
  pg = new PGlite(); queue = Promise.resolve(); failReceipt = false;
  await pg.exec('CREATE ROLE spr_app_runtime; CREATE ROLE spr_worker_runtime;');
  await pg.exec(readFileSync('migrations/0083_distribution_engine.sql','utf8'));
  await pg.exec(readFileSync('migrations/0087_autonomous_distribution_outreach.sql','utf8'));
  await pg.exec(readFileSync('migrations/0093_distribution_growth_engine.sql','utf8'));
  await pg.exec(readFileSync('migrations/0142_scale_distribution_daily_cap.sql','utf8'));
  await pg.exec(readFileSync('migrations/0143_distribution_send_reservations.sql','utf8'));
  await pg.query(`INSERT INTO distribution_contacts (id,tenant_id,email,outreach_basis) SELECT 'c'||n,$1,'info@msp'||n||'.test','legitimate_interest' FROM generate_series(1,12) n`,[tenant]);
  await pg.query(`UPDATE distribution_campaign_settings SET daily_send_cap=1000 WHERE tenant_id=$1`,[tenant]);
});
afterEach(async () => { await pg.close(); });

async function send(id = 'c1', options: { limit?:number; kind?:'initial'|'followup'; transport?:()=>Promise<string>; gate?:(client:any,contact:any)=>Promise<void> } = {}) {
  return withReservedOutreach(pool,tenant,id,options.kind ?? 'initial', {
    environmentLimit:options.limit ?? 1000, intervalMs:0,
    gate:options.gate ?? (async () => undefined),
    async send(client, contact, reservation, mark) {
      mark(); const providerId = await (options.transport ?? (async () => 'provider-1'))();
      await client.query(`INSERT INTO distribution_messages (id,tenant_id,contact_id,kind,subject,provider_message_id,status,sent_at) VALUES ($1,$2,$3,$4,'test',$5,'sent',CURRENT_TIMESTAMP AT TIME ZONE 'UTC')`,[reservation.id,tenant,contact.id,reservation.kind,providerId]);
      if (reservation.kind === 'followup') await client.query(`UPDATE distribution_contacts SET followup_count=followup_count+1,next_followup_at=NULL WHERE id=$1`,[id]);
      return { providerId,key:reservation.id };
    },
  });
}

describe('durable outreach capacity and recovery', () => {
  it('allows the worker reservation privileges and scopes the app role with RLS', async () => {
    await pg.exec(`BEGIN; SET LOCAL ROLE spr_worker_runtime;`);
    await pg.query(`SELECT set_config('app.tenant_id',$1,true)`,[tenant]);
    await expect(pg.query(`SELECT daily_send_cap FROM distribution_campaign_settings WHERE tenant_id=$1 FOR UPDATE`,[tenant])).resolves.toBeTruthy();
    await pg.query(`UPDATE distribution_campaign_settings SET last_send_reserved_at=NOW() WHERE tenant_id=$1`,[tenant]);
    await pg.query(`INSERT INTO distribution_send_attempts (id,tenant_id,contact_id,kind,sequence,status) VALUES ('worker',$1,'c1','initial',0,'reserved')`,[tenant]);
    await pg.exec('COMMIT; BEGIN; SET LOCAL ROLE spr_app_runtime;');
    await pg.query(`SELECT set_config('app.tenant_id','another-tenant',true)`);
    expect((await pg.query(`SELECT id FROM distribution_send_attempts`)).rows).toHaveLength(0);
    await pg.exec('ROLLBACK;');
  });
  it('migration accepts 1,000, rejects 1,001, and enforces attempt uniqueness', async () => {
    await expect(pg.query(`UPDATE distribution_campaign_settings SET daily_send_cap=1001`)).rejects.toThrow();
    await pg.query(`INSERT INTO distribution_send_attempts (id,tenant_id,contact_id,kind,sequence,status) VALUES ('a',$1,'c1','initial',0,'reserved')`,[tenant]);
    await expect(pg.query(`INSERT INTO distribution_send_attempts (id,tenant_id,contact_id,kind,sequence,status) VALUES ('b',$1,'c1','initial',0,'reserved')`,[tenant])).rejects.toThrow();
  });

  it('allows only one additional logical send at 999, including concurrent callers', async () => {
    await pg.query(`INSERT INTO distribution_messages (id,tenant_id,contact_id,kind,subject,status,sent_at) SELECT 'historic'||n,$1,'c12','followup','old','sent',CURRENT_TIMESTAMP AT TIME ZONE 'UTC' FROM generate_series(1,999) n`,[tenant]);
    const transport = vi.fn(async () => 'accepted');
    const outcomes = await Promise.allSettled(Array.from({length:10},(_,i) => send('c'+(i+1),{transport})));
    expect(outcomes.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(transport).toHaveBeenCalledTimes(1);
    expect((await pg.query<{ count:number }>(`SELECT COUNT(*)::int AS count FROM distribution_messages WHERE status='sent'`)).rows[0].count).toBe(1000);
  });

  it('honors the smaller campaign/environment cap', async () => {
    await pg.query(`UPDATE distribution_campaign_settings SET daily_send_cap=1`);
    await send('c1');
    await expect(send('c2')).rejects.toThrow('DAILY_SEND_LIMIT');
    await pg.query(`UPDATE distribution_campaign_settings SET daily_send_cap=1000`);
    await expect(send('c2',{limit:1})).rejects.toThrow('DAILY_SEND_LIMIT');
  });

  it('rejects duplicate initial jobs without another provider call', async () => {
    const transport = vi.fn(async () => 'accepted');
    await Promise.allSettled([send('c1',{transport}),send('c1',{transport})]);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('does not replay provider acceptance after the database receipt fails', async () => {
    failReceipt=true;
    const transport=vi.fn(async()=> 'accepted');
    await expect(send('c1',{transport})).rejects.toThrow('RECEIPT_FAILURE');
    failReceipt=false;
    expect((await pg.query<{status:string}>(`SELECT status FROM distribution_send_attempts`)).rows[0].status).toBe('unknown');
    await expect(send('c1',{transport})).rejects.toThrow('ALREADY_RESERVED');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('holds unknown/abandoned attempts beyond the provider idempotency window', async () => {
    const transport=vi.fn(async()=> { throw new Error('TIMEOUT_AFTER_ACCEPTANCE'); });
    await expect(send('c1',{transport})).rejects.toThrow('TIMEOUT');
    await pg.query(`UPDATE distribution_send_attempts SET status='reserved',reserved_at=NOW()-INTERVAL '2 days'`);
    await expect(send('c1',{transport})).rejects.toThrow('ALREADY_RESERVED');
    await expect(send('c2',{limit:1})).rejects.toThrow('DAILY_SEND_LIMIT');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('defers a definite 429 and retries with the same logical key', async () => {
    const transport=vi.fn(async()=> { throw new EmailProviderError(429,'rate limited'); });
    await expect(send('c1',{transport})).rejects.toThrow('RETRY_WAIT');
    const before=(await pg.query<{id:string}>(`SELECT id FROM distribution_send_attempts`)).rows[0].id;
    await expect(send('c1')).rejects.toThrow('RETRY_WAIT');
    await pg.query(`UPDATE distribution_send_attempts SET retry_at=NOW()-INTERVAL '1 second'`);
    expect((await send('c1')).key).toBe(before);
  });

  it.each(['unsubscribed','suppressed','invalid'])('blocks %s contacts', async status => {
    await pg.query(`UPDATE distribution_contacts SET status=$1 WHERE id='c1'`,[status]);
    const transport=vi.fn(async()=> 'should-not-send');
    await expect(send('c1',{transport})).rejects.toThrow('NOT_ACTIVE');
    expect(transport).not.toHaveBeenCalled();
  });

  it('pauses safely, rejects absent sender verification, and rechecks before dispatch', async () => {
    const gate=vi.fn(async()=> { throw new Error('SENDER_VERIFICATION_REQUIRED'); });
    await expect(send('c1',{gate})).rejects.toThrow('SENDER_VERIFICATION');
    await pg.query(`UPDATE distribution_campaign_settings SET outreach_enabled=false`);
    await expect(send()).rejects.toThrow('OUTREACH_PAUSED');
    await pg.query(`UPDATE distribution_campaign_settings SET outreach_enabled=true`);
    let checks=0;
    const transport=vi.fn(async()=> 'should-not-send');
    await expect(send('c1',{transport,gate:async(client)=> { if(++checks===2) throw new Error('CONTACT_SUPPRESSED_BEFORE_DISPATCH'); }})).rejects.toThrow('SUPPRESSED');
    expect(transport).not.toHaveBeenCalled();
  });

  it('claims a due followup once and stops after a reply', async () => {
    await send('c1');
    await pg.query(`UPDATE distribution_contacts SET next_followup_at=NOW()-INTERVAL '1 day' WHERE id='c1'`);
    const transport=vi.fn(async()=> 'followup');
    await Promise.allSettled([send('c1',{kind:'followup',transport}),send('c1',{kind:'followup',transport})]);
    expect(transport).toHaveBeenCalledTimes(1);
    await pg.query(`UPDATE distribution_contacts SET next_followup_at=NOW()-INTERVAL '1 day',pipeline_stage='replied' WHERE id='c1'`);
    await expect(send('c1',{kind:'followup',transport})).rejects.toThrow('NOT_ACTIVE');
  });

  it('uses UTC boundaries and does not count yesterday as today', async () => {
    await pg.query(`SET TIME ZONE 'America/Vancouver'`);
    await pg.query(`INSERT INTO distribution_messages (id,tenant_id,contact_id,kind,subject,status,sent_at) VALUES ('yesterday',$1,'c2','initial','old','sent',date_trunc('day',NOW() AT TIME ZONE 'UTC')-INTERVAL '1 second')`,[tenant]);
    await expect(send('c1',{limit:1})).resolves.toBeTruthy();
  });
});
