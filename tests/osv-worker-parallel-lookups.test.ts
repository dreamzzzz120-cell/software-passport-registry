import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const worker = fs.readFileSync(path.join(root, 'src/workers/osv-worker.ts'), 'utf8');

// Observed in production: scanning this project's own repository (a real
// manifest with dozens of components) landed on scanStatus "partial" with
// failureReason "The scan did not finish in time" -- the security engine (one
// orchestrated call) finished in seconds while the OSV loop, which queried
// components one at a time with its own HTTP round-trip each, was still
// going when the customer-facing deadline hit. The fix is concurrency, not a
// longer deadline: a longer deadline just makes customers wait longer for
// the same underlying slowness.
describe('OSV component lookups run concurrently instead of one at a time', () => {
  it('fetches components through a bounded worker pool rather than a serial await loop', () => {
    expect(worker).toContain('OSV_FETCH_CONCURRENCY');
    expect(worker).toMatch(/Math\.min\(OSV_FETCH_CONCURRENCY,\s*components\.length\)/);
    // The old code awaited fetchOsv directly inside a `for...of components.entries()`
    // loop; that exact shape must be gone, not just supplemented.
    expect(worker).not.toMatch(/for \(const \[index, component\] of components\.entries\(\)\) \{\s*const provider = await fetchOsv\(component\);/);
  });

  it('a single failing component does not fail the whole job', () => {
    // The previous loop had no try/catch around fetchOsv at all: any one
    // failure -- one slow dependency, one OSV hiccup -- threw and took every
    // other component's already-obtainable result down with it.
    expect(worker).toMatch(/catch \(error\) \{[\s\S]{0,300}providerResults\[index\] = null|catch \(error\) \{[\s\S]{0,400}osv_component_query_failed/);
  });

  it('a total OSV outage still fails the job rather than reporting a false-clean zero-findings result', () => {
    // This is the one case concurrency must NOT paper over: if every single
    // component failed (provider down, egress blocked), that must surface as
    // a failure, not silently persist as "0 findings" -- which downstream
    // renders identically to a genuinely clean scan.
    expect(worker).toContain("throw new Error('OSV_ALL_QUERIES_FAILED')");
    expect(worker).toMatch(/failedComponentCount === components\.length/);
  });

  it('DB writes stay serial and bounded, respecting the worker pool size', () => {
    // worker-db.ts caps SQL_POOL_MAX at 4 by default; only the network fetch
    // was ever the bottleneck, so persistence intentionally was not also
    // parallelized against that same limited pool.
    expect(worker).toMatch(/persist(ence|ProviderResult)/i);
    const persistLoop = worker.slice(worker.indexOf('for (const result of providerResults)'));
    expect(persistLoop.slice(0, 400)).toContain('pool.connect()');
  });
});
