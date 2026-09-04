import { createServer } from 'node:http';
import * as Sentry from '@sentry/node';
import { runWorkerLoop } from './src/workers/osv-worker.ts';
import { runWebhookWorkerLoop } from './src/workers/webhook-worker.ts';
import { runSecurityScannerLoop } from './src/workers/security-scanner-worker.ts';
import { runTrustMonitoringWorkerLoop } from './src/workers/trust-monitoring-worker.ts';
import { runNotificationWorkerLoop } from './src/workers/notification-worker.ts';
import { runRetentionWorkerLoop } from './src/workers/retention-worker.ts';
import { runReportScheduleWorkerLoop } from './src/workers/report-schedule-worker.ts';
import { createWorkerPool, assertWorkerDatabase } from './src/workers/worker-db.ts';
import { config } from './src/config.ts';

if (config.sentry.dsn) Sentry.init({ dsn: config.sentry.dsn, environment: config.nodeEnv, tracesSampleRate: config.isProduction ? 0.1 : 1.0 });
let ready = false;
function normalizeWorkerDatabaseEnv() { const raw=process.env.DATABASE_URL?.trim(); if(!raw)return; try{const url=new URL(raw);process.env.SQL_HOST ||= url.hostname;process.env.SQL_USER ||= decodeURIComponent(url.username);process.env.SQL_PASSWORD ||= decodeURIComponent(url.password);process.env.SQL_DB_NAME ||= url.pathname.replace(/^\//,'');}catch(error){console.error('[Worker] Invalid DATABASE_URL:',error instanceof Error?error.message:String(error));process.exit(1);} }
function startHealthServer(){const port=Number.parseInt(process.env.PORT??'8080',10);const server=createServer((request,response)=>{if(request.url==='/health'&&request.method==='GET'){response.writeHead(ready ? 200 : 503,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify({ok:ready,service:'spr-worker',ready}));return;}response.writeHead(404,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify({error:'Not found'}));});server.on('error',error=>{console.error('[Worker] Health server error:',error);if(config.sentry.dsn)Sentry.captureException(error);process.exit(1);});server.listen(port,'0.0.0.0',()=>console.log(`[Worker] Health endpoint listening on 0.0.0.0:${port}`));}
async function verifyDatabase(){const pool=createWorkerPool();try{await assertWorkerDatabase(pool);}finally{await pool.end();}}
async function supervise(name:string,run:()=>Promise<void>){let delay=1000;while(true){try{await run();delay=1000;}catch(error){console.error(`[Worker] ${name} loop failure:`,error instanceof Error?error.message:String(error));if(config.sentry.dsn)Sentry.captureException(error,{ tags: { worker_loop:name } });await new Promise(r=>setTimeout(r,delay));delay=Math.min(delay*2,30000);}}}
normalizeWorkerDatabaseEnv();startHealthServer();
async function main(){await verifyDatabase();ready=true;const scanConsumers=Math.max(1,Math.min(4,Number.parseInt(process.env.SCAN_QUEUE_CONSUMERS??'2',10)||2));const scanSupervisors=[supervise('osv', runWorkerLoop),...Array.from({length:scanConsumers-1},(_,index)=>supervise(`osv-${index+2}`,runWorkerLoop))];await Promise.all([...scanSupervisors,supervise('security', runSecurityScannerLoop),supervise('trust-monitoring',runTrustMonitoringWorkerLoop),supervise('webhook',runWebhookWorkerLoop),supervise('notifications',runNotificationWorkerLoop),supervise('retention',runRetentionWorkerLoop),supervise('report-schedules',runReportScheduleWorkerLoop)]);}
main().catch(async error=>{ready=false;console.error('[Worker] Fatal startup error:',error instanceof Error?error.message:String(error));if(config.sentry.dsn){Sentry.captureException(error,{ tags: { worker_startup:'true' } });await Sentry.flush(2000).catch(()=>undefined);}process.exit(1);});
