import { runWorkerLoop } from './src/workers/osv-worker.ts';
import { runMonitoringWorkerLoop } from './src/workers/monitoring-worker.ts';
import { runWebhookWorkerLoop } from './src/workers/webhook-worker.ts';

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
    process.exitCode = 1;
  }
}

normalizeWorkerDatabaseEnv();

async function main() {
  try {
    await Promise.all([
      runWorkerLoop(),
      runMonitoringWorkerLoop(),
      runWebhookWorkerLoop(),
    ]);
  } catch (error) {
    console.error('[Worker] Fatal error:', error);
    process.exit(1);
  }
}

main();
