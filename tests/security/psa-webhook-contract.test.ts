import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const route = fs.readFileSync(path.join(root, 'src/routes/integrations-live.ts'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations/0068_psa_webhook_ingress.sql'), 'utf8');

describe('PSA webhook security contract', () => {
  it('limits inbound webhook providers to the selected PSA/RMM set', () => {
    expect(route).toContain("new Set(['connectwise', 'autotask', 'ninjaone'])");
    expect(migration).toContain("CHECK (provider IN ('connectwise','autotask','ninjaone'))");
  });

  it('requires a time-bound HMAC signature before accepting an event', () => {
    expect(route).toContain("x-spr-webhook-signature");
    expect(route).toContain('Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300');
    expect(route).toContain("createHmac('sha256', secret)");
    expect(route).toContain('timingSafeEqual');
  });

  it('deduplicates events per opaque endpoint and external event id', () => {
    expect(migration).toContain('UNIQUE (endpoint_id, external_event_id)');
    expect(route).toContain('ON CONFLICT (endpoint_id, external_event_id) DO NOTHING');
  });

  it('does not allow a webhook to invent its own finding binding', () => {
    expect(route).toContain("router.put('/psa/findings/:findingId/ticket', requireAuth, requireRole(['Owner', 'Admin', 'Operator'])");
    expect(route).toContain('PSA ticket is already bound to another finding.');
  });

  it('cannot transition a verified finding backwards through the webhook', () => {
    expect(route).toContain("state NOT IN ('verified_not_affected','remediated_verified')");
    expect(route).toContain("state = 'detected' OR state = 'claimed_false_positive' OR state = 'remediated_claimed'");
    expect(route).toContain("'under_verification'");
  });

  it('stores webhook secrets encrypted and keeps only a hash for integrity', () => {
    expect(route).toContain('encryptCredentials({ secret: parsed.data.secret })');
    expect(route).toContain('secretHash(parsed.data.secret)');
    expect(migration).toContain('secret_hash text NOT NULL');
    expect(migration).toContain('secret_ciphertext text NOT NULL');
  });
});
