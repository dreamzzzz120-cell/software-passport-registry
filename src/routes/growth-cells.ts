import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { appPool } from '../db/index.ts';
import { requireAuth,requireRole,requireFounder,type AuthenticatedRequest } from '../middleware/security.ts';
import { DISTRIBUTION_TENANT_ID as tenant } from '../lib/distribution-engine.ts';
import { GROWTH_CELLS,growthCell,cellState } from '../lib/growth-cells.ts';
async function scoped<T>(fn:(client:any)=>Promise<T>) {
 const client=await appPool.connect();
 try {await client.query('BEGIN');await client.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);const result=await fn(client);await client.query('COMMIT');return result;}
 catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
const controlSchema=z.object({state:z.enum(['observing','paused','archived']),reason:z.string().trim().min(3).max(500)}).strict();
export function createGrowthCellsRouter() {
 const router=Router();const gates=[requireAuth,requireRole('Owner'),requireFounder];
 router.get('/founder/growth-cells',...gates,async(_req,res,next)=>{try{
 const data=await scoped(async client=>{
 const controls=(await client.query('SELECT cell_id,state FROM growth_cell_controls WHERE tenant_id=$1',[tenant])).rows;
 const stats=(await client.query(`SELECT payload->>'cellId' AS cell_id,COUNT(*) FILTER(WHERE status='queued')::int AS queued,COUNT(*) FILTER(WHERE status='running')::int AS running,COUNT(*) FILTER(WHERE status='succeeded')::int AS succeeded,COUNT(*) FILTER(WHERE status='dead_letter')::int AS failed FROM distribution_jobs WHERE tenant_id=$1 AND kind='growth_cell' GROUP BY payload->>'cellId'`,[tenant])).rows;
 const recent=(await client.query(`SELECT DISTINCT ON(payload->>'cellId') id,payload->>'cellId' AS cell_id,status,result,last_error,updated_at FROM distribution_jobs WHERE tenant_id=$1 AND kind='growth_cell' ORDER BY payload->>'cellId',updated_at DESC`,[tenant])).rows;
 const receipts=(await client.query('SELECT id,cell_id,previous_state,next_state,reason,created_at FROM growth_cell_control_receipts WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50',[tenant])).rows;
 return {cells:GROWTH_CELLS.map(cell=>{const control=controls.find((r:any)=>r.cell_id===cell.id)?.state??'observing';const counts=stats.find((r:any)=>r.cell_id===cell.id)??{queued:0,running:0,succeeded:0,failed:0};const last=recent.find((r:any)=>r.cell_id===cell.id)??null;return {...cell,control,counts,last,state:cellState(control,counts.running,counts.queued,counts.failed,Boolean(last?.result?.observedAt)),costCents:null};}),receipts};
 });res.json({...data,generatedAt:new Date().toISOString()});}catch(error){next(error);}});
 router.patch('/founder/growth-cells/:cellId',...gates,async(req:AuthenticatedRequest,res,next)=>{
 const cell=growthCell(req.params.cellId);const parsed=controlSchema.safeParse(req.body);if(!cell||!parsed.success)return res.status(400).json({error:'Valid cell, state and reason required.'});
 try{const result=await scoped(async client=>{
 await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`growth-cell:${cell.id}`]);
 const old=(await client.query('SELECT state FROM growth_cell_controls WHERE tenant_id=$1 AND cell_id=$2 FOR UPDATE',[tenant,cell.id])).rows[0]?.state??'observing';
 await client.query(`INSERT INTO growth_cell_controls(tenant_id,cell_id,state) VALUES($1,$2,$3) ON CONFLICT(tenant_id,cell_id) DO UPDATE SET state=EXCLUDED.state,updated_at=now()`,[tenant,cell.id,parsed.data.state]);
 const receiptId=randomUUID();await client.query('INSERT INTO growth_cell_control_receipts(id,tenant_id,cell_id,actor_id,previous_state,next_state,reason) VALUES($1,$2,$3,$4,$5,$6,$7)',[receiptId,tenant,cell.id,req.user!.id,old,parsed.data.state,parsed.data.reason]);return {receiptId,state:parsed.data.state};});return res.json(result);}catch(error){next(error);}});
 router.post('/founder/growth-cells/:cellId/missions',...gates,async(req,res,next)=>{
 const cell=growthCell(req.params.cellId);if(!cell)return res.status(400).json({error:'Unknown cell.'});
 try{const result=await scoped(async client=>{
 await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`growth-cell:${cell.id}`]);
 const state=(await client.query('SELECT state FROM growth_cell_controls WHERE tenant_id=$1 AND cell_id=$2',[tenant,cell.id])).rows[0]?.state??'observing';if(state!=='observing')return {blocked:true};
 const pending=(await client.query(`SELECT id FROM distribution_jobs WHERE tenant_id=$1 AND kind='growth_cell' AND payload->>'cellId'=$2 AND status IN('queued','running') LIMIT 1`,[tenant,cell.id])).rows[0];if(pending)return {id:pending.id,reused:true};
 const id=`dist_${randomUUID()}`;await client.query(`INSERT INTO distribution_jobs(id,tenant_id,kind,payload) VALUES($1,$2,'growth_cell',$3::jsonb)`,[id,tenant,JSON.stringify({cellId:cell.id,origin:{kind:'founder_cell_mission'}})]);return {id,reused:false};});return 'blocked' in result?res.status(409).json({error:'Cell is paused or archived.'}):res.status(202).json(result);}catch(error){next(error);}});
 return router;
}
