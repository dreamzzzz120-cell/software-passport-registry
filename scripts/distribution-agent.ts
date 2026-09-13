import { enqueueResearchUrl } from '../src/lib/distribution-engine.ts';
import { runDistributionWorkerLoop } from '../src/workers/distribution-worker.ts';
import { createWorkerPool } from '../src/workers/worker-db.ts';

const [command, ...args] = process.argv.slice(2);

if (command === 'research') {
  const urls = args.filter(Boolean);
  if (!urls.length || urls.length > 100) {
    console.error('Usage: npm run distribution -- research https://example.com [https://example.org ...]');
    process.exit(2);
  }
  const pool = createWorkerPool();
  try {
    const ids = [];
    for (const url of urls) ids.push(await enqueueResearchUrl(pool, url));
    console.log(JSON.stringify({ status: 'queued', count: ids.length, jobIds: ids }));
  } finally {
    await pool.end();
  }
} else if (command === 'worker') {
  await runDistributionWorkerLoop();
} else {
  console.error('Usage: npm run distribution -- worker | research <url> [url ...]');
  process.exit(2);
}
