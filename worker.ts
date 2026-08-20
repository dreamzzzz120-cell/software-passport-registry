import { createServer } from 'node:http';
import { runWorkerLoop } from './src/workers/osv-worker.ts';
import { runWebhookWorkerLoop } from './src/workers/webhook-worker.ts';
import { runSecurityScannerLoop } from './src/workers/security-scanner-worker.ts';
import { runTrustMonitoringWorkerLoop } from './src/workers/trust-monitoring-worker.ts';

function normalizeWorkerDatabaseEnv() { const raw=process.env.DATABASE_URL?.trim(); if(!raw)return; try{const url=new URL(raw);process.env.SQL_HOST ||= url.hostname;process.env.SQL_USER ||= decodeURIComponent(url.username);process.env.SQL_PASSWORD ||= decodeURIComponent(url.password);process.env.SQL_DB_NAME ||= url.pathname.replace(/^\//,'');}catch(error){console.error('[Worker] Invalid DATABASE_URL:',error instanceof Error?error.message:String(error));process.exitCode=1;} }
function startHealthServer(){const port=Number.parseInt(process.env.PORT??'8080',10);const server=createServer((request,response)=>{if(request.url==='/health'&&request.method==='GET'){response.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify({ok:true,service:'spr-worker'}));return;}response.writeHead(404,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify({error:'Not found'}));});server.on('error',error=>{console.error('[Worker] Health server error:',error);process.exit(1);});server.listen(port,'0.0.0.0',()=>console.log(`[Worker] Health endpoint listening on 0.0.0.0:${port}`));}
normalizeWorkerDatabaseEnv();startHealthServer();
async function main(){try{await Promise.all([runWorkerLoop(),runSecurityScannerLoop(),runTrustMonitoringWorkerLoop(),runWebhookWorkerLoop()]);}catch(error){console.error('[Worker] Fatal error:',error);process.exit(1);}}
main();
