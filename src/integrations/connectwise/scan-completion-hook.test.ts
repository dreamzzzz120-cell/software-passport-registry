import { describe, expect, it } from 'vitest';
import { ConnectWiseClient, type FetchLike } from './client.ts';
import type { ConnectWiseCredentials } from './types.ts';
import {
  DEFAULT_MAX_TICKETS_PER_SCAN,
  DEFAULT_MIN_SEVERITY,
  credentialsFrom,
  meetsThreshold,
  onScanCompleted,
  ticketableFindings,
  type SqlRunner,
} from './scan-completion-hook.ts';

const creds: ConnectWiseCredentials = {
  companyId: 'TestMSP', publicKey: 'pub', privateKey: 'priv',
  clientId: 'cid', apiBaseUrl: 'https://api.myconnectwise.net', defaultBoardId: '99',
};

const finding = (id: string, severity: string, category = 'Vulnerability') =>
  ({ id, severity, category, assetId: 'passport_1', psaTicketId: null });

/** Records every statement, and answers SELECTs from a fixed finding list. */
function stubQuery(rows: any[]) {
  const statements: Array<{ text: string; params: unknown[] }> = [];
  const query: SqlRunner = async (text, params) => {
    statements.push({ text, params });
    return { rows: text.trim().startsWith('SELECT') ? rows : [] };
  };
  return { statements, query, updates: () => statements.filter((s) => s.text.trim().startsWith('UPDATE')) };
}

const okTransport = (): FetchLike => {
  let next = 1000;
  return async () => ({ ok: true, status: 201, text: async () => JSON.stringify({ id: next++ }) });
};

describe('not every finding becomes a ticket', () => {
  // The scan of expressjs/express really did produce this: thirteen medium
  // licence findings and one high secret. Ticketing all fourteen would bury a
  // service board and train technicians to close SPR tickets unread.
  const expressShaped = [
    ...Array.from({ length: 13 }, (_, i) => finding(`lic-${i}`, 'medium', 'License')),
    finding('secret-1', 'high', 'Secret'),
  ];

  it('files one ticket for that scan, not fourteen', async () => {
    const { query } = stubQuery(expressShaped);
    const selected = await ticketableFindings(query, { tenantId: 't', jobId: 'j' });
    expect(selected).toHaveLength(1);
    expect(selected[0].id).toBe('secret-1');
  });

  it('defaults to high, so medium and below are recorded but not ticketed', () => {
    expect(DEFAULT_MIN_SEVERITY).toBe('high');
    expect(meetsThreshold('critical', 'high')).toBe(true);
    expect(meetsThreshold('high', 'high')).toBe(true);
    expect(meetsThreshold('medium', 'high')).toBe(false);
    expect(meetsThreshold('low', 'high')).toBe(false);
    expect(meetsThreshold('info', 'high')).toBe(false);
  });

  it('lets an operator lower the threshold deliberately', async () => {
    const { query } = stubQuery(expressShaped);
    const selected = await ticketableFindings(query, { tenantId: 't', jobId: 'j', minSeverity: 'medium', maxTickets: 50 });
    expect(selected).toHaveLength(14);
  });

  it('caps a pathological scan so it cannot flood a PSA', async () => {
    const many = Array.from({ length: 200 }, (_, i) => finding(`c-${i}`, 'critical'));
    const { query } = stubQuery(many);
    expect(await ticketableFindings(query, { tenantId: 't', jobId: 'j' })).toHaveLength(DEFAULT_MAX_TICKETS_PER_SCAN);
  });

  it('spends the cap on the most severe findings first', async () => {
    const { query } = stubQuery([finding('m', 'medium'), finding('c', 'critical'), finding('h', 'high')]);
    const selected = await ticketableFindings(query, { tenantId: 't', jobId: 'j', maxTickets: 2 });
    expect(selected.map((f) => f.id)).toEqual(['c', 'h']);
  });

  it('only ever considers newly detected, un-ticketed findings', async () => {
    const { query, statements } = stubQuery([]);
    await ticketableFindings(query, { tenantId: 't', jobId: 'j' });
    expect(statements[0].text).toContain("state = 'detected'");
    expect(statements[0].text).toContain('psa_ticket_id IS NULL');
    expect(statements[0].params).toEqual(['t', 'j']);
  });
});

describe('credentials are all-or-nothing', () => {
  it('accepts a complete payload', () => {
    expect(credentialsFrom({ ...creds })).toEqual(creds);
  });

  // A half-configured credential produces an auth failure against the customer's
  // real PSA, which looks to them like SPR probing their account.
  it('refuses a payload missing any field rather than calling with it', () => {
    for (const field of ['companyId', 'publicKey', 'privateKey', 'clientId', 'apiBaseUrl', 'defaultBoardId']) {
      expect(credentialsFrom({ ...creds, [field]: '' }), field).toBeNull();
    }
    expect(credentialsFrom(null)).toBeNull();
    expect(credentialsFrom({})).toBeNull();
  });
});

describe('the hook never breaks a scan that already succeeded', () => {
  it('does nothing at all when the tenant has not connected ConnectWise', async () => {
    const { query, statements } = stubQuery([finding('a', 'critical')]);
    const result = await onScanCompleted({ query, tenantId: 't', jobId: 'j', credentials: null });
    expect(result).toMatchObject({ skipped: 'NO_CREDENTIALS', attempted: 0, produced: 0 });
    expect(statements).toHaveLength(0);
  });

  it('reports nothing ticketable without touching the PSA', async () => {
    const { query } = stubQuery([finding('a', 'low')]);
    const result = await onScanCompleted({ query, tenantId: 't', jobId: 'j', credentials: creds });
    expect(result.skipped).toBe('NOTHING_TICKETABLE');
  });

  it('stamps only the ids ConnectWise returned', async () => {
    const { query, updates } = stubQuery([finding('a', 'critical'), finding('b', 'high')]);
    const result = await onScanCompleted({
      query, tenantId: 't', jobId: 'j', credentials: creds,
      makeClient: (c) => new ConnectWiseClient(c, okTransport()),
    });
    expect(result).toMatchObject({ attempted: 2, produced: 2 });
    expect(updates()).toHaveLength(2);
    expect(updates()[0].text).toContain('psa_ticket_id IS NULL');
    expect(updates()[0].params[0]).toBe('t');
  });

  // A PSA that is down must not fail a scan whose evidence is already recorded.
  it('writes nothing and swallows the failure when ConnectWise is unreachable', async () => {
    const failing: FetchLike = async () => { throw new Error('ECONNREFUSED'); };
    const { query, updates } = stubQuery([finding('a', 'critical')]);
    const result = await onScanCompleted({
      query, tenantId: 't', jobId: 'j', credentials: creds,
      makeClient: (c) => new ConnectWiseClient(c, failing),
    });
    expect(result.produced).toBe(0);
    expect(updates(), 'a PSA outage must not write to scan_findings').toHaveLength(0);
    expect(result.outcomes[0]).toMatchObject({ produced: false });
  });

  it('keeps going after one finding fails, so a single bad ticket does not strand the rest', async () => {
    let call = 0;
    const flaky: FetchLike = async () => {
      call += 1;
      return call === 1
        ? { ok: false, status: 500, text: async () => '' }
        : { ok: true, status: 201, text: async () => '{"id":777}' };
    };
    const { query, updates } = stubQuery([finding('a', 'critical'), finding('b', 'critical')]);
    const result = await onScanCompleted({
      query, tenantId: 't', jobId: 'j', credentials: creds,
      makeClient: (c) => new ConnectWiseClient(c, flaky),
    });
    expect(result).toMatchObject({ attempted: 2, produced: 1 });
    expect(updates()).toHaveLength(1);
  });
});
