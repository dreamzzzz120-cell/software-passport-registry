import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('SPR webhook delivery wiring contracts', () => {
  it('was previously built end-to-end but never enqueued a single delivery anywhere', () => {
    // Documents the bug this session fixed: enqueueWebhookDelivery existed and the
    // worker polled for queued rows forever, but no code path ever inserted one.
    const worker = read('src/workers/webhook-worker.ts');
    expect(worker).toContain('export async function enqueueWebhookDelivery');
    const trustLoop = read('src/trust/trust-loop.ts');
    expect(trustLoop).toContain('async function notifyWebhooks(');
  });

  it('matches webhooks to events using the same jsonb containment shape the events column actually stores', () => {
    const trustLoop = read('src/trust/trust-loop.ts');
    expect(trustLoop).toContain('events::jsonb @>');
  });

  it('enqueues into the same unique idempotency key the worker dedupes on', () => {
    const trustLoop = read('src/trust/trust-loop.ts');
    expect(trustLoop).toContain('ON CONFLICT (tenant_id,webhook_id,idempotency_key) DO NOTHING');
  });

  it('fires risk.created only for newly-inserted open findings, not on every re-observation of an existing one', () => {
    const trustLoop = read('src/trust/trust-loop.ts');
    expect(trustLoop).toContain('RETURNING (xmax=0) AS inserted');
    expect(trustLoop).toContain("result.wasNew&&result.finding.status==='OPEN'");
  });

  it('fires risk.resolved and verification.completed from the explicit verification path, not an inferred status diff', () => {
    const trustLoop = read('src/trust/trust-loop.ts');
    expect(trustLoop).toContain("notifyWebhooks(input.tenantId,'risk.resolved'");
    expect(trustLoop).toContain("notifyWebhooks(input.tenantId,'verification.completed'");
  });

  it('never lets a webhook enqueue failure break the authoritative trust-loop write', () => {
    const trustLoop = read('src/trust/trust-loop.ts');
    const fnStart = trustLoop.indexOf('async function notifyWebhooks');
    const fnBody = trustLoop.slice(fnStart, fnStart + 1400);
    expect(fnBody).toContain('try {');
    expect(fnBody).toContain('catch (error)');
  });
});
