import * as Sentry from '@sentry/node';
import { runWorkerLoop } from './src/workers/osv-worker.ts';
import { runWebhookWorkerLoop } from './src/workers/webhook-worker.ts';
import { runSecurityScannerLoop } from './src/workers/security-scanner-worker.ts';
import { runIntakeScannerLoop } from './src/workers/intake-scan-worker.ts';
import { runTrustMonitoringWorkerLoop } from './src/workers/trust-monitoring-worker.ts';
import { runNotificationWorkerLoop } from './src/workers/notification-worker.ts';
import { runRetentionWorkerLoop } from './src/workers/retention-worker.ts';
import { runReportScheduleWorkerLoop } from './src/workers/report-schedule-worker.ts';
import { runDistributionWorkerLoop } from './src/workers/distribution-worker.ts';
import { runPublicRepositoryAgentTeamLoop } from './src/agents/public-repository-team-v2.ts';
import { runRegistryLineageLoop } from './src/workers/registry-lineage-worker.ts';
import { createWorkerPool, assertWorkerDatabase } from './src/workers/worker-db.ts';
import { config } from './src/config.ts';

type JobName =
  | 'osv' | 'webhook' | 'security' | 'intake' | 'trust-monitoring'
  | 'notifications' | 'retention' | 'report-schedules' | 'distribution'
  | 'registry-crawler' | 'registry-lineage';

const jobs: Record<JobName, () => Promise<void>> = {
  osv: runWorkerLoop,
  webhook: runWebhookWorkerLoop,
  security: runSecurityScannerLoop,
  intake: runIntakeScannerLoop,
  'trust-monitoring': runTrustMonitoringWorkerLoop,
  notifications: runNotificationWorkerLoop,
  retention: runRetentionWorkerLoop,
  'report-schedules': runReportScheduleWorkerLoop,
  distribution: runDistributionWorkerLoop,
  'registry-crawler': runPublicRepositoryAgentTeamLoop,
  'registry-lineage': runRegistryLineageLoop,
};

function normalizeDatabaseEnv() {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) return;
  const url = new URL(raw);
  process.env.SQL_HOST ||= url.hostname;
  process.env.SQL_USER ||= decodeURIComponent(url.username);
  process.env.SQL_PASSWORD ||= decodeURIComponent(url.password);
  process.env.SQL_DB_NAME ||= url.pathname.replace(/^\//, '');
}

async function main() {
  if (config.sentry.dsn) Sentry.init({ dsn: config.sentry.dsn, environment: config.nodeEnv, tracesSampleRate: config.isProduction ? 0.1 : 1.0 });
  normalizeDatabaseEnv();
  const name = process.argv[2] as JobName | undefined;
  if (!name || !(name in jobs)) throw new Error(`WORKER_JOB_REQUIRED: choose one of ${Object.keys(jobs).join(',')}`);

  const pool = createWorkerPool();
  try { await assertWorkerDatabase(pool); } finally { await pool.end(); }

  console.info(`[WorkerOnce] starting ${name}`);
  await jobs[name]();
  console.info(`[WorkerOnce] completed ${name}`);
}

main().catch(async (error) => {
  console.error('[WorkerOnce] failed:', error instanceof Error ? error.message : String(error));
  if (config.sentry.dsn) { Sentry.captureException(error); await Sentry.flush(2000).catch(() => undefined); }
  process.exit(1);
});
