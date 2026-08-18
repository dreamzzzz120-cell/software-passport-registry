import { runWorkerLoop } from './src/workers/osv-worker.ts';
import { runMonitoringWorkerLoop } from './src/workers/monitoring-worker.ts';
import { runWebhookWorkerLoop } from './src/workers/webhook-worker.ts';

async function main() {
  try {
    await Promise.all([
      runWorkerLoop(),
      runMonitoringWorkerLoop(),
      runWebhookWorkerLoop(),
    ]);
  } catch (error) {
    console.error('[Worker] Fatal error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
