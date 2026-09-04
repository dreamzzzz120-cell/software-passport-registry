import { jsPDF } from 'jspdf';
import type { Pool } from 'pg';

function advance(cadence: string, from: Date) { const d=new Date(from); if(cadence==='weekly') d.setUTCDate(d.getUTCDate()+7); else d.setUTCMonth(d.getUTCMonth()+1); return d; }
function pdf(passport:any, reportType:string) { const doc=new jsPDF(); doc.setFont('helvetica','bold'); doc.setFontSize(18); doc.text('Software Passport Registry',20,25); doc.setFontSize(14); doc.text(`${reportType} trust report`,20,37); doc.setFont('helvetica','normal'); doc.setFontSize(10); let y=52; const lines=[`Passport: ${passport.name||passport.id}`,`Version: ${passport.version||'Unknown'}`,`Publisher: ${passport.publisher||'Unknown'}`,`Verification status: ${passport.verification_status||'unverified'}`,`Overall score: ${passport.overall_score ?? 'NOT ASSESSED'}`,`Security score: ${passport.security_score ?? 'NOT ASSESSED'}`,`Compliance score: ${passport.compliance_score ?? 'NOT ASSESSED'}`,`Generated: ${new Date().toISOString()}`,`Passport evidence is rendered from the tenant-scoped registry record.`]; for(const line of lines){doc.text(line,20,y);y+=9;} return Buffer.from(doc.output('arraybuffer')); }

export async function runDueSchedule(pool: Pool, now = new Date()): Promise<number> {
  let processed=0;
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const {rows}=await client.query(`SELECT id,tenant_id,passport_id,report_type,cadence,recipient_emails,next_run_at FROM report_schedules WHERE enabled=true AND next_run_at<=CURRENT_TIMESTAMP ORDER BY next_run_at ASC FOR UPDATE SKIP LOCKED LIMIT 10`);
    for(const row of rows){
      try{
        const p=(await client.query(`SELECT id,name,version,publisher,verification_status,overall_score,security_score,compliance_score FROM passports WHERE id=$1 AND tenant_id=$2 LIMIT 1`,[row.passport_id,row.tenant_id])).rows[0];
        if(!p) throw new Error('PASSPORT_NOT_FOUND');
        const attachment=pdf(p,row.report_type);
        const emails=JSON.parse(row.recipient_emails||'[]');
        for(const destination of emails){ await client.query(`INSERT INTO notification_outbox (id,tenant_id,channel,destination,subject,body,attachments_json,available_at) VALUES ($1,$2,'email',$3,$4,$5,$6,CURRENT_TIMESTAMP)`,[`rptmail_${cryptoRandom()}`,row.tenant_id,destination,`SPR ${row.report_type} report`,`Your scheduled ${row.report_type} Software Passport Registry report is attached.`,JSON.stringify([{filename:`software-passport-${row.passport_id}.pdf`,content:attachment.toString('base64')}])]); }
        const next=advance(row.cadence,new Date(row.next_run_at)); await client.query(`UPDATE report_schedules SET last_run_at=CURRENT_TIMESTAMP,next_run_at=$2,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$1`,[row.id,next.toISOString()]); processed++;
      }catch(error){ await client.query(`UPDATE report_schedules SET last_error=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1`,[row.id,String(error).slice(0,1000)]); }
    }
    await client.query('COMMIT'); return processed;
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
function cryptoRandom(){return Math.random().toString(36).slice(2)+Date.now().toString(36);}
export async function runReportScheduleWorkerLoop(): Promise<void> { const {createWorkerPool}=await import('./worker-db.ts'); const pool=createWorkerPool(); try{await runDueSchedule(pool);}finally{await pool.end();} await new Promise(r=>setTimeout(r,Number(process.env.REPORT_SCHEDULE_POLL_MS||30000))); }
