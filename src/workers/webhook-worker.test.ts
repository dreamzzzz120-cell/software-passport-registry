import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

const lookup = vi.fn();
const request = vi.fn();
vi.mock('node:dns/promises', () => ({ lookup }));
vi.mock('node:https', () => ({ request }));
vi.mock('../security/credential-vault.ts', () => ({ decryptCredential: () => 'test-secret' }));

import { deliverWebhookOnce } from './webhook-worker';

function response(statusCode: number) {
  const responseEmitter = new EventEmitter() as EventEmitter & { statusCode: number };
  responseEmitter.statusCode = statusCode;
  return responseEmitter;
}

function fakeRequest(statusCode = 204) {
  const req = new EventEmitter() as EventEmitter & { end: (payload: string) => void; destroy: (error?: Error) => void };
  req.end = () => {
    const res = response(statusCode);
    const callback = request.mock.calls.at(-1)?.[1] as ((response: EventEmitter & { statusCode: number }) => void) | undefined;
    callback?.(res);
    res.emit('end');
  };
  req.destroy = (error?: Error) => req.emit('error', error || new Error('destroyed'));
  request.mockReturnValue(req);
  return req;
}

function fakePool() {
  const query = vi.fn()
    .mockResolvedValueOnce({ rows: [{
      id: 'delivery-1', tenant_id: 'tenant-a', webhook_id: 'webhook-1', event_id: 'event-1',
      event_type: 'passport.updated', payload: JSON.stringify({ passportId: 'p1' }),
      attempt_number: 1, created_at: new Date().toISOString(), url: 'https://example.com/hook',
      secret_ciphertext: 'encrypted', secret_key_version: 1, consecutive_failure_count: 0,
    }] })
    .mockResolvedValue({ rows: [] });
  return { query } as any;
}

describe('webhook delivery adversarial controls', () => {
  beforeEach(() => {
    lookup.mockReset();
    request.mockReset();
  });

  it('re-resolves immediately before connection and blocks DNS rebinding', async () => {
    lookup
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    const pool = fakePool();

    await deliverWebhookOnce(pool, 'delivery-1');

    expect(lookup).toHaveBeenCalledTimes(2);
    expect(request).not.toHaveBeenCalled();
    expect(pool.query.mock.calls.some((call: any[]) => String(call[0]).includes('dead_lettered') || String(call[0]).includes("status=$2"))).toBe(true);
  });

  it('pins the validated public address, disables redirects, and signs the payload', async () => {
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    fakeRequest(204);
    const pool = fakePool();

    await deliverWebhookOnce(pool, 'delivery-1');

    expect(request).toHaveBeenCalledTimes(1);
    const options = request.mock.calls[0][0] as Record<string, unknown>;
    expect(options.lookup).toBeTypeOf('function');
    expect(options.maxRedirects).toBe(0);
    expect(options.servername).toBe('example.com');
    const headers = options.headers as Record<string, string>;
    expect(headers['x-spr-signature']).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
    expect(headers['x-spr-signature-version']).toBe('v1');
  });

  it('rejects arbitrary internal event injection at the enqueue boundary', async () => {
    const { enqueueWebhookDelivery } = await import('./webhook-worker');
    const pool = { query: vi.fn() } as any;
    await expect(enqueueWebhookDelivery(pool, {
      tenantId: 'tenant-a', webhookId: 'webhook-1', eventId: 'event-2', eventType: 'arbitrary.internal', payload: {},
    })).rejects.toThrow('Webhook event type is not allowed');
    expect(pool.query).not.toHaveBeenCalled();
  });
});
