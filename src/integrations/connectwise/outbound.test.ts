import { describe, expect, it } from 'vitest';
import { ConnectWiseClient, type FetchLike } from './client.ts';
import { ConnectWiseError, type ConnectWiseCredentials } from './types.ts';
import { buildTicketRequest, produceTicketForFinding, type TicketableFinding } from './outbound.ts';

const creds: ConnectWiseCredentials = {
  companyId: 'TestMSP',
  publicKey: 'pub_key_123',
  privateKey: 'priv_key_456',
  clientId: '11111111-2222-3333-4444-555555555555',
  apiBaseUrl: 'https://api-eu.myconnectwise.net',
  defaultBoardId: '99',
};

const finding: TicketableFinding = {
  id: 'finding-abc',
  severity: 'High',
  category: 'Secret',
  assetId: 'passport_1',
  psaTicketId: null,
};

/** Records what the client sent, and replies with whatever the test wants. */
function stubTransport(reply: { ok: boolean; status: number; body: string }) {
  const calls: Array<{ url: string; init: Parameters<FetchLike>[1] }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { ok: reply.ok, status: reply.status, text: async () => reply.body };
  };
  return { calls, fetchImpl };
}

/** Captures stamped ticket ids instead of touching a database. */
function stubStamp() {
  const statements: Array<{ findingId: string; ticketId: string }> = [];
  return { statements, stamp: async (findingId: string, ticketId: string) => { statements.push({ findingId, ticketId }); } };
}

describe('ConnectWise auth and endpoint construction', () => {
  it('builds the documented basic auth token from companyId+publicKey:privateKey', () => {
    const header = new ConnectWiseClient(creds).authorizationHeader();
    expect(header.startsWith('Basic ')).toBe(true);
    const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
    expect(decoded).toBe('TestMSP+pub_key_123:priv_key_456');
  });

  it('sends the clientId as its own header, since the Manage API rejects requests without it', async () => {
    const { calls, fetchImpl } = stubTransport({ ok: true, status: 201, body: '{"id":123456}' });
    await new ConnectWiseClient(creds, fetchImpl).createTicket({ summary: 's', detail: 'd' });
    expect(calls[0].init.headers.clientId).toBe(creds.clientId);
    expect(calls[0].init.headers.Authorization.startsWith('Basic ')).toBe(true);
  });

  it('posts to the tenant site, not to a hardcoded host', async () => {
    const { calls, fetchImpl } = stubTransport({ ok: true, status: 201, body: '{"id":1}' });
    await new ConnectWiseClient(creds, fetchImpl).createTicket({ summary: 's', detail: 'd' });
    expect(calls[0].url).toBe('https://api-eu.myconnectwise.net/v4_6_release/apis/3.0/service/tickets');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(calls[0].init.body).board.id).toBe(99);
  });

  // apiBaseUrl is tenant-supplied, so it is an SSRF surface: without this an
  // operator could have SPR fetch cloud metadata on their behalf, authenticated,
  // from inside the network.
  it('refuses a private or non-HTTPS ConnectWise base URL', () => {
    for (const bad of ['http://api.myconnectwise.net', 'https://169.254.169.254', 'https://127.0.0.1', 'https://10.0.0.5']) {
      const client = new ConnectWiseClient({ ...creds, apiBaseUrl: bad });
      expect(() => client.ticketsEndpoint(), bad).toThrow(ConnectWiseError);
    }
  });
});

describe('the client never invents a ticket id', () => {
  it('returns the id ConnectWise actually sent', async () => {
    const { fetchImpl } = stubTransport({ ok: true, status: 201, body: '{"id":874512}' });
    await expect(new ConnectWiseClient(creds, fetchImpl).createTicket({ summary: 's', detail: 'd' }))
      .resolves.toEqual({ id: 874512 });
  });

  it('fails on missing credentials rather than fabricating success', async () => {
    const client = new ConnectWiseClient({ ...creds, privateKey: '' });
    await expect(client.createTicket({ summary: 's', detail: 'd' }))
      .rejects.toMatchObject({ code: 'CONNECTWISE_CREDENTIALS_INCOMPLETE' });
  });

  it('surfaces rejected credentials as an auth failure', async () => {
    const { fetchImpl } = stubTransport({ ok: false, status: 401, body: '' });
    await expect(new ConnectWiseClient(creds, fetchImpl).createTicket({ summary: 's', detail: 'd' }))
      .rejects.toMatchObject({ code: 'CONNECTWISE_AUTH_FAILED' });
  });

  it('treats a response with no usable id as a failure, not a ticket', async () => {
    for (const body of ['{}', '{"id":"874512"}', '{"id":0}', '{"id":-3}', 'not json']) {
      const { fetchImpl } = stubTransport({ ok: true, status: 201, body });
      await expect(new ConnectWiseClient(creds, fetchImpl).createTicket({ summary: 's', detail: 'd' }), body)
        .rejects.toMatchObject({ code: 'CONNECTWISE_RESPONSE_UNUSABLE' });
    }
  });
});

describe('the producer only stamps psa_ticket_id on a real ticket', () => {
  it('writes the id ConnectWise returned', async () => {
    const { fetchImpl } = stubTransport({ ok: true, status: 201, body: '{"id":424242}' });
    const { stamp, statements } = stubStamp();
    const outcome = await produceTicketForFinding(stamp, finding, new ConnectWiseClient(creds, fetchImpl));
    expect(outcome).toEqual({ produced: true, ticketId: '424242' });
    expect(statements).toHaveLength(1);
  });

  // The failure this whole design exists to prevent: an id written for a ticket
  // that does not exist can never be matched by the inbound webhook, which
  // resolves through (tenant_id, psa_ticket_id).
  it('writes nothing at all when ConnectWise fails', async () => {
    for (const reply of [
      { ok: false, status: 401, body: '' },
      { ok: false, status: 500, body: '' },
      { ok: true, status: 201, body: '{}' },
    ]) {
      const { fetchImpl } = stubTransport(reply);
      const { stamp, statements } = stubStamp();
      const outcome = await produceTicketForFinding(stamp, finding, new ConnectWiseClient(creds, fetchImpl));
      expect(outcome.produced, JSON.stringify(reply)).toBe(false);
      expect(statements, 'no database write may happen on failure').toHaveLength(0);
    }
  });

  it('never tickets the same finding twice', async () => {
    const { fetchImpl } = stubTransport({ ok: true, status: 201, body: '{"id":1}' });
    const { stamp, statements } = stubStamp();
    const outcome = await produceTicketForFinding(stamp, { ...finding, psaTicketId: '999' }, new ConnectWiseClient(creds, fetchImpl));
    expect(outcome).toMatchObject({ produced: false, code: 'ALREADY_TICKETED' });
    expect(statements).toHaveLength(0);
  });
});

describe('the ticket body does not give away the paid report', () => {
  const request = buildTicketRequest(finding);

  it('carries severity, category and asset, and no finding detail', () => {
    expect(request.summary).toContain('High');
    expect(request.summary).toContain('Secret');
    expect(request.detail).toContain('passport_1');
    expect(request.detail).toContain('Full description, affected component, evidence and remediation are in the Software Passport.');
  });

  it('tells the technician that closing the ticket is a claim, not a fix', () => {
    expect(request.detail).toContain('SPR re-scans to verify it');
    expect(request.detail).toContain('does not by itself mark the finding as fixed');
  });
});
