import { runWorkerLoop } from './src/workers/osv-worker.ts';
import { runMonitoringWorkerLoop } from './src/workers/monitoring-worker.ts';

async function main() {
  try {
    await Promise.all([runWorkerLoop(), runMonitoringWorkerLoop()]);
  } catch (error) {
    console.error('[Worker] Fatal error:', error);
    process.exit(1);
  }
}

main();