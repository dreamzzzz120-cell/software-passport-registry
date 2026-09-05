import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  CONNECTWISE_SIGNATURE_HEADER,
  connectWiseAdapter,
  dispositionForStatus,
  externalEventId,
  parseConnectWiseWebhook,
  payloadHash,
  verifyConnectWiseSignature,
} from './webhook-adapter.ts';
import { planFindingUpdate, isRejection } from '../psa-finding-sync.ts';

const SECRET = 'tenant-webhook-secret-value';
const BODY = JSON.stringify({ eventId: 'evt-1', ticket: { id: 874512, status: { name: 'Closed' } } });
const hmac = (secret: string, body: string) => crypto.createHmac('sha256', secret).update(body, 'utf8').digest();

describe('ConnectWise signature verification', () => {
  it('reads the signature from X-CW-Signature', () => {
    expect(connectWiseAdapter.signatureHeader).toBe('x-cw-signature');
    expect(CONNECTWISE_SIGNATURE_HEADER).toBe('x-cw-signature');
  });

  // The supplied specification says the value is "base64-encoded or hex-encoded
  // depending on the patch version of their API gateway". Picking one would
  // reject every genuine webhook from an instance using the other, so the digest
  // is computed once and compared against both encodings of itself.
  it('accepts the hex encoding', () => {
    expect(verifyConnectWiseSignature(SECRET, BODY, hmac(SECRET, BODY).toString('hex'))).toBe(true);
  });

  it('accepts the base64 encoding of the same digest', () => {
    expect(verifyConnectWiseSignature(SECRET, BODY, hmac(SECRET, BODY).toString('base64'))).toBe(true);
  });

  it('accepts an uppercase hex signature', () => {
    expect(verifyConnectWiseSignature(SECRET, BODY, hmac(SECRET, BODY).toString('hex').toUpperCase())).toBe(true);
  });

  it('rejects a signature made with the wrong secret', () => {
    expect(verifyConnectWiseSignature(SECRET, BODY, hmac('not-the-secret', BODY).toString('hex'))).toBe(false);
  });

  it('rejects a signature over a different body, which is what tamper detection means', () => {
    const tampered = JSON.stringify({ eventId: 'evt-1', ticket: { id: 999999, status: { name: 'Closed' } } });
    expect(verifyConnectWiseSignature(SECRET, tampered, hmac(SECRET, BODY).toString('hex'))).toBe(false);
  });

  it('fails closed on empty, malformed and truncated input', () => {
    for (const bad of ['', '   ', 'not-a-signature', hmac(SECRET, BODY).toString('hex').slice(0, 32)]) {
      expect(verifyConnectWiseSignature(SECRET, BODY, bad), JSON.stringify(bad)).toBe(false);
    }
    expect(verifyConnectWiseSignature('', BODY, hmac(SECRET, BODY).toString('hex'))).toBe(false);
  });
});

describe('status mapping stays conservative', () => {
  it('maps the statuses the operator can rely on', () => {
    expect(dispositionForStatus('Closed')).toBe('resolved_fixed');
    expect(dispositionForStatus('resolved')).toBe('resolved_fixed');
    expect(dispositionForStatus('Not Applicable')).toBe('resolved_not_applicable');
    expect(dispositionForStatus('Cancelled')).toBe('resolved_not_applicable');
    expect(dispositionForStatus('Reopened')).toBe('reopened');
    expect(dispositionForStatus('In Progress')).toBe('acknowledged');
  });

  // ConnectWise service-board statuses are configurable per board, so an
  // unfamiliar one must not be guessed into a state change.
  it('returns unknown for a status it has never seen, and that changes nothing', () => {
    for (const status of ['Escalated to Tier 3', '', null, undefined, 42, 'Waiting on Vendor']) {
      expect(dispositionForStatus(status), String(status)).toBe('unknown');
    }
    const outcome = planFindingUpdate('detected', dispositionForStatus('Escalated to Tier 3'), {
      ticketId: 'CW-1', actor: 'tech', observedAt: '2026-09-05T00:00:00.000Z',
    });
    expect(isRejection(outcome)).toBe(true);
    if (isRejection(outcome)) expect(outcome.code).toBe('NO_CLAIM');
  });
});

describe('payload parsing is tolerant about shape, strict about conclusions', () => {
  it('finds the ticket id and status in the nested ticket object', () => {
    const event = parseConnectWiseWebhook(BODY);
    expect(event.ticketId).toBe('874512');
    expect(event.disposition).toBe('resolved_fixed');
  });

  it('finds them in a flat payload too', () => {
    const event = parseConnectWiseWebhook(JSON.stringify({ ticketId: 'CW-42', status: 'Resolved', actor: 'tech@msp' }));
    expect(event.ticketId).toBe('CW-42');
    expect(event.disposition).toBe('resolved_fixed');
    expect(event.actor).toBe('tech@msp');
  });

  it('yields no claim rather than throwing on a body it cannot read', () => {
    const event = parseConnectWiseWebhook('not json at all');
    expect(event.ticketId).toBe('');
    expect(event.disposition).toBe('unknown');
  });
});

describe('replay is bounded at the storage layer, since the signature carries no timestamp', () => {
  it('uses the vendor event id when one is present', () => {
    expect(externalEventId(BODY)).toBe('evt-1');
  });

  it('falls back to a payload hash when the delivery is unidentified', () => {
    const body = JSON.stringify({ ticket: { id: 5, status: { name: 'Closed' } } });
    expect(externalEventId(body)).toBe(`sha256:${payloadHash(body)}`);
    expect(externalEventId('not json')).toBe(`sha256:${payloadHash('not json')}`);
  });

  it('gives the same delivery the same id, so a replay collides', () => {
    expect(externalEventId(BODY)).toBe(externalEventId(BODY));
  });

  it('is enforced by a unique constraint the route relies on', () => {
    const route = fs.readFileSync(path.join(process.cwd(), 'src/routes/psa-webhooks.ts'), 'utf8');
    expect(route).toContain('ON CONFLICT (endpoint_id, external_event_id) DO NOTHING');
    expect(route).toContain('DUPLICATE_DELIVERY');
    const migration = fs.readFileSync(path.join(process.cwd(), 'migrations/0068_psa_webhook_ingress.sql'), 'utf8');
    expect(migration).toContain('UNIQUE (endpoint_id, external_event_id)');
  });

  it('uses the ConnectWise verifier rather than the native scheme for this vendor', () => {
    const route = fs.readFileSync(path.join(process.cwd(), 'src/routes/psa-webhooks.ts'), 'utf8');
    expect(route).toContain('verify: verifyConnectWiseSignature');
    expect(route).toContain('adapter.verify');
  });
});
