import { beforeAll,afterAll,it,expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { GROWTH_CELLS,observeGrowthCell,runGrowthCellObservation,cellState,DISTRIBUTION_CLAIM_JOB_SQL } from '../src/lib/growth-cells.ts';
const db=new PGlite();
beforeAll(async()=>{
 await db.exec(`CREATE ROLE spr_app_runtime;CREATE ROLE spr_worker_runtime;
 CREATE TABLE distribution_jobs(id text PRIMARY KEY,tenant_id text,kind text,status text,payload jsonb,updated_at timestamptz DEFAULT now(),available_at timestamptz DEFAULT now(),created_at timestamptz DEFAULT now(),attempts int DEFAULT 0,max_attempts int DEFAULT 5);
 CREATE TABLE distribution_contacts(tenant_id text,replied_at timestamptz,checkout_at timestamptz,customer_at timestamptz,updated_at timestamptz);
 CREATE TABLE growth_content_opportunities(tenant_id text,kind text,status text,observed_clicks int,observed_conversions int,updated_at timestamptz);
 CREATE TABLE growth_referral_links(tenant_id text,owner_type text,visits int,conversions int,updated_at timestamptz);
 CREATE TABLE growth_experiments(tenant_id text,status text,updated_at timestamptz);
 CREATE TABLE free_review_submissions(tenant_id text,status text,created_at timestamptz);
 CREATE TABLE q_legion_missions(tenant_id text,state text,updated_at timestamptz);`);
 await db.exec(readFileSync('migrations/0142_growth_command_cells.sql','utf8'));
},30000);
afterAll(async()=>{await db.close();});
it('executes all fifteen SQL observation handlers and preserves missing data',async()=>{
 for(const cell of GROWTH_CELLS){const result=await observeGrowthCell(db,cell.id,'target');expect(result.metrics.records).toBe(0);expect(result.metrics.lastObservedAt).toBeNull();expect(result.costCents).toBeNull();expect(result.execution).toBe('OBSERVATION_ONLY');}
});
it('filters job evidence by tenant and kind and rejects unknown identifiers',async()=>{
 await db.exec(`INSERT INTO distribution_jobs(id,tenant_id,kind,status,payload) VALUES('foreign','other','research_url','succeeded','{}'),('local','target','research_url','succeeded','{}'),('unrelated','target','send_outreach','dead_letter','{}');`);
 expect((await observeGrowthCell(db,'recon','target')).metrics).toMatchObject({records:1,succeeded:1,failed:0});
 await expect(observeGrowthCell(db,"recon';DROP TABLE distribution_jobs",'target')).rejects.toThrow('GROWTH_CELL_UNKNOWN');
});
it('deduplicates pending missions and allows completed missions to run again',async()=>{
 await db.exec(`INSERT INTO distribution_jobs(id,tenant_id,kind,status,payload) VALUES('mission','target','growth_cell','queued','{"cellId":"recon"}');`);
 await expect(db.exec(`INSERT INTO distribution_jobs(id,tenant_id,kind,status,payload) VALUES('duplicate','target','growth_cell','running','{"cellId":"recon"}');`)).rejects.toThrow();
 await db.exec(`UPDATE distribution_jobs SET status='succeeded' WHERE id='mission';INSERT INTO distribution_jobs(id,tenant_id,kind,status,payload) VALUES('next','target','growth_cell','queued','{"cellId":"recon"}');`);
});
it('enforces tenant RLS and protects historical receipts from runtime rewrites',async()=>{
 await db.exec(`INSERT INTO growth_cell_controls VALUES('target','recon','paused',now()),('other','recon','observing',now());INSERT INTO growth_cell_control_receipts VALUES('receipt','target','recon','founder','observing','paused','Pause test',now());SET ROLE spr_app_runtime;SELECT set_config('app.tenant_id','target',false);`);
 expect((await db.query('SELECT tenant_id FROM growth_cell_controls')).rows).toEqual([{tenant_id:'target'}]);
 await expect(db.exec("UPDATE growth_cell_control_receipts SET reason='rewrite'")).rejects.toThrow();await expect(db.exec('DELETE FROM growth_cell_control_receipts')).rejects.toThrow();await db.exec('RESET ROLE');
});
it('worker claims skip paused cells and foreign tenants; resume admits pending work',async()=>{
 await db.exec(`INSERT INTO distribution_jobs(id,tenant_id,kind,status,payload) VALUES('foreignQueued','other','growth_cell','queued','{"cellId":"quality"}');`);
 expect((await db.query(DISTRIBUTION_CLAIM_JOB_SQL,['target'])).rows).toEqual([]);
 await db.exec("UPDATE growth_cell_controls SET state='observing' WHERE tenant_id='target'");
 expect((await db.query(DISTRIBUTION_CLAIM_JOB_SQL,['target'])).rows[0]).toMatchObject({id:'next'});
});
it('separates control state from activity and preserves UNKNOWN',()=>{
 expect(cellState('observing',0,0,0,false)).toBe('UNKNOWN');expect(cellState('paused',1,2,3,true)).toBe('PAUSED');expect(cellState('observing',1,0,0,false)).toBe('RUNNING');
});
it('returns the connection before persistence and releases it after a failed observation',async()=>{
 let leased=false;
 const pool={connect:async()=>{
   if(leased)throw new Error('POOL_EXHAUSTED');leased=true;
   return {query:(text:string,values?:any[])=>db.query(text,values),release:()=>{leased=false;}};
 }};
 await runGrowthCellObservation(pool,'recon','target');
 const persistenceClient=await pool.connect();persistenceClient.release();
 await expect(runGrowthCellObservation(pool,'unknown','target')).rejects.toThrow('GROWTH_CELL_UNKNOWN');
 const recoveryClient=await pool.connect();recoveryClient.release();
 expect(leased).toBe(false);
});
