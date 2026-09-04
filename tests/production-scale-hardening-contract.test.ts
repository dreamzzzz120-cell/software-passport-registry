import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('production scale hardening contracts', () => {
  it('keeps provider retries bounded and jittered', () => {
    const source = read('src/integrations/resilience.ts');
    expect(source).toContain('Math.min(5, options.attempts ?? DEFAULT_ATTEMPTS)');
    expect(source).toContain('MAX_BACKOFF_MS = 8_000');
    expect(source).toContain('0.75 + Math.max(0, Math.min(1, random)) * 0.5');
  });

  it('keeps OSV fan-out bounded and refuses an all-failed provider result', () => {
    const source = read('src/workers/osv-worker.ts');
    expect(source).toContain('const OSV_FETCH_CONCURRENCY = 8;');
    expect(source).toContain('Math.min(OSV_FETCH_CONCURRENCY, components.length)');
    expect(source).toContain("if (components.length > 0 && failedComponentCount === components.length) throw new Error('OSV_ALL_QUERIES_FAILED')");
    expect(source).toContain('PROVIDER_MAX_RESPONSE_BYTES');
    expect(source).toContain('PROVIDER_TIMEOUT_MS');
  });

  it('keeps repository acquisition bounded before scanning', () => {
    const source = read('src/workers/security-scanner-worker.ts');
    expect(source).toContain('MAX_ARCHIVE_BYTES = 50 * 1024 * 1024');
    expect(source).toContain('validateArchiveEntries');
    expect(source).toContain('runBounded(archiveExecutable');
    expect(source).toContain('JOB_LEASE_MS = 10 * 60 * 1000');
    expect(source).toContain('FOR UPDATE SKIP LOCKED');
  });

  it('keeps confidence freshness time-based', () => {
    const source = read('src/trust/trust-loop.ts');
    expect(source).toContain('function freshnessMultiplier(observedAt:string,now=Date.now())');
    expect(source).toContain('const ageHours=Math.max(0,(now-new Date(observedAt).getTime())/3600000)');
    expect(source).toContain('CONFIDENCE_VERSION');
  });

  it('keeps worker startup supervised and observable', () => {
    const source = read('worker.ts');
    expect(source).toContain("supervise('osv', runWorkerLoop)");
    expect(source).toContain("supervise('security', runSecurityScannerLoop)");
    expect(source).toContain("Sentry.captureException(error, { tags: { worker_loop: name } })");
    expect(source).toContain('response.writeHead(ready ? 200 : 503');
  });
});
