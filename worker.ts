import { createServer } from 'node:http';
import { runWorkerLoop } from './src/workers/osv-worker.ts';
import { runWebhookWorkerLoop } from './src/workers/webhook-worker.ts';
import { runSecurityScannerLoop } from './src/workers/security-scanner-worker.ts';
import { runTrustMonitoringWorkerLoop } from './src/workers/trust-monitoring-worker.ts';
import { createWorkerPool, assertWorkerDatabase } from './src/workers/worker-db.ts';

// Deployment sentinel: worker source changes intentionally retrigger Railway after
// production hardening changes that affect shared runtime dependencies.
let ready = false;

function normalizeWorkerDatabaseEnv() {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) return;
  try {
    const url = new URL(raw);
    process.env.SQL_HOST ||= url.hostname;
    process.env.SQL_USER ||= decodeURIComponent(url.username);
    process.env.SQL_PASSWORD ||= decodeURIComponent(url.password);
    process.env.SQL_DB_NAME ||= url.pathname.replace(/^\//, '');
  } catch (error) {
    console.error('[Worker] Invalid DATABASE_URL:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function startHealthServer() {
  const port = Number.parseInt(process.env.PORT ?? '8080', 10);
  const server = createServer((request, response) => {
    if (request.url === '/health' && request.method === 'GET') {
      response.writeHead(ready ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ ok: ready, service: 'spr-worker', ready }));
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ error: 'Not found' }));
  });
  server.on('error', error => { console.error('[Worker] Health server error:', error); process.exit(1); });
  server.listen(port, '0.0.0.0', () => console.log(`[Worker] Health endpoint listening on 0.0.0.0:${port}`));
}

async function verifyDatabase() {
  const pool = createWorkerPool();
  try { await assertWorkerDatabase(pool); }
  finally { await pool.end(); }
}

async function supervise(name: string, run: () => Promise<void>) {
  let delay = 1000;
  while (true) {
    try {
      await run();
      if (name === 'osv' || name === 'security' || name === 'trust-monitoring' || name === 'webhook') {
        console.warn(`[Worker] ${name} loop exited; restarting`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      delay = 1000;
    } catch (error) {
      console.error(`[Worker] ${name} loop failure:`, error instanceof Error ? error.message : String(error));
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 30_000);
    }
  }
}

normalizeWorkerDatabaseEnv();
startHealthServer();

async function main() {
  await verifyDatabase();
  ready = true;
  await Promise.all([
    supervise('osv', runWorkerLoop),
    supervise('security', runSecurityScannerLoop),
    supervise('trust-monitoring', runTrustMonitoringWorkerLoop),
    supervise('webhook', runWebhookWorkerLoop),
  ]);
}

main().catch(error => {
  ready = false;
  console.error('[Worker] Fatal startup error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
