// @vitest-environment jsdom
/**
 * Experience Agent frontend regression tests. The component is rendered for
 * real in jsdom with Supabase auth and the API client replaced by fakes, so
 * these assertions are about what a user would actually see and what the
 * component actually sends and does -- not about how the file reads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readRaw } from './helpers/source-contract.ts';

const authState: { currentUser: null | { uid: string } } = { currentUser: null };
const listeners: Array<(user: unknown) => void> = [];
vi.mock('../src/lib/supabase-auth', () => ({
  auth: authState,
  onAuthStateChanged: (_auth: unknown, cb: (user: unknown) => void) => {
    listeners.push(cb);
    cb(authState.currentUser);
    return () => {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    };
  },
}));

type FakeResponse = { status: number; ok: boolean; json: () => Promise<unknown> };
const calls: Array<{ url: string; body: unknown }> = [];
let responder: (url: string, body: unknown) => FakeResponse = () => ({ status: 500, ok: false, json: async () => ({}) });
vi.mock('../src/utils/apiClient', () => ({ apiFetch: async (url: string, init?: { body?: string }) => { const body = init?.body ? JSON.parse(init.body) : undefined; calls.push({ url, body }); return responder(url, body); } }));

const ok = (payload: unknown): FakeResponse => ({ status: 200, ok: true, json: async () => payload });
const notFound = (payload: unknown): FakeResponse => ({ status: 404, ok: false, json: async () => payload });

async function mount(signedIn: boolean) {
  authState.currentUser = signedIn ? { uid: 'uid-a' } : null;
  const { default: ExperienceAgent } = await import('../src/components/ExperienceAgent');
  return render(<ExperienceAgent />);
}

const keyK = (init: KeyboardEventInit) => fireEvent.keyDown(window, { key: 'k', ...init });

beforeEach(() => { calls.length = 0; window.history.replaceState({}, '', '/dashboard'); });
afterEach(() => { cleanup(); listeners.length = 0; });

describe('mounting and authentication gate', () => {
  it('is mounted eagerly and directly in main.tsx next to <App /> (no lazy loading)', () => {
    const main = readRaw('src/main.tsx');
    expect(main).toContain("import ExperienceAgent from './components/ExperienceAgent';");
    expect(main).toContain('<App /><ExperienceAgent />');
    expect(main).not.toMatch(/lazy\(|Suspense|import\(/);
  });

  it('renders nothing for an unauthenticated visitor, and Ctrl+K does not open a command dialog', async () => {
    await mount(false);
    expect(screen.queryByRole('button', { name: 'Open SPR Agent' })).toBeNull();
    keyK({ ctrlKey: true });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.length).toBe(0);
  });

  it('shows the launcher for an authenticated user and opens with Ctrl+K and Cmd+K', async () => {
    await mount(true);
    expect(screen.getByRole('button', { name: 'Open SPR Agent' })).toBeTruthy();
    keyK({ ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: 'SPR Agent' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    keyK({ metaKey: true });
    expect(await screen.findByRole('dialog', { name: 'SPR Agent' })).toBeTruthy();
  });

  it('drops the command UI when the user signs out', async () => {
    await mount(true);
    expect(screen.getByRole('button', { name: 'Open SPR Agent' })).toBeTruthy();
    act(() => { authState.currentUser = null; for (const cb of listeners) cb(null); });
    expect(screen.queryByRole('button', { name: 'Open SPR Agent' })).toBeNull();
  });

  it('supports keyboard close/toggle, locks background scroll, and restores launcher focus', async () => {
    await mount(true);
    const launcher = screen.getByRole('button', { name: 'Open SPR Agent' }) as HTMLButtonElement;
    fireEvent.click(launcher);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(launcher));
    expect(document.body.style.overflow).not.toBe('hidden');
    keyK({ ctrlKey: true });
    expect(await screen.findByRole('dialog')).toBeTruthy();
    keyK({ ctrlKey: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('clears the conversation and recalls the last command with ArrowUp', async () => {
    responder = () => ok({ intent: 'help', reply: 'Observed answer.' });
    await mount(true);
    await openAndSend('show clients');
    await screen.findByText('Observed answer.');
    const input = screen.getByLabelText('Ask SPR Agent') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.value).toBe('show clients');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByText('Observed answer.')).toBeNull();
    expect(input.value).toBe('');
  });

  it('adds a retry control after a failed command and retries only on explicit click', async () => {
    let failed = true;
    responder = () => failed
      ? ({ status: 500, ok: false, json: async () => ({}) })
      : ok({ intent: 'help', reply: 'Recovered.' });
    await mount(true);
    await openAndSend('help me');
    await screen.findByText('SPR Agent could not complete the request.');
    expect(calls.map((call) => call.url)).toEqual(['/api/agent/v1/command']);
    failed = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Recovered.');
    expect(calls.map((call) => call.url)).toEqual(['/api/agent/v1/command', '/api/agent/v1/command']);
  });

  it('exposes the transcript as a polite live log and character feedback', async () => {
    await mount(true);
    keyK({ ctrlKey: true });
    const log = await screen.findByRole('log');
    expect(log.getAttribute('aria-live')).toBe('polite');
    const input = screen.getByLabelText('Ask SPR Agent') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'x'.repeat(451) } });
    expect(screen.getByText('451/500')).toBeTruthy();
    expect(screen.getByText(/Current page:/).textContent).toContain('/dashboard');
  });
});

async function openAndSend(text: string) {
  if (!screen.queryByRole('dialog')) keyK({ ctrlKey: true });
  await screen.findByRole('dialog');
  fireEvent.change(screen.getByLabelText('Ask SPR Agent'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}

describe('navigation and action allowlists on the client', () => {
  it('never auto-navigates from a conversational response; navigation requires a user click', async () => {
    responder = () => ok({ intent: 'navigation', path: '/passports', reply: 'Opening Passports.' });
    await mount(true);
    await openAndSend('show passports');
    await screen.findByText('Opening Passports.');
    expect(window.location.pathname).toBe('/dashboard');
    expect(calls[0].url).toBe('/api/agent/v1/command');
    expect(calls[0].body).toMatchObject({ input: 'show passports', context: { path: '/dashboard' } });
    expect((calls[0].body as any).context.history).toEqual(expect.any(Array));
    fireEvent.click(screen.getByRole('button', { name: 'Open suggested page' }));
    expect(window.location.pathname).toBe('/passports');
  });

  it('ignores a non-allowlisted path even if the server returns one', async () => {
    responder = () => ok({ intent: 'navigation', path: '/api/admin/export', reply: 'x' });
    await mount(true);
    await openAndSend('go somewhere');
    await screen.findByText(/not on the agent’s approved navigation list/);
    expect(window.location.pathname).toBe('/dashboard');
    responder = () => ok({ intent: 'navigation', path: 'https://evil.example/', reply: 'y' });
    await openAndSend('go elsewhere');
    await screen.findByText('y');
    expect(window.location.pathname).toBe('/dashboard');
    expect(screen.getAllByText(/not on the agent’s approved navigation list/).length).toBe(2);
  });

  it('executes only the allowlisted verify endpoint; any other action is refused without a request', async () => {
    responder = (url) => url === '/api/agent/v1/command' ? ok({ intent: 'passport', reply: 'planning', action: { type: 'verify', endpoint: '/api/agent/v1/delete-passport', payload: { id: 'x' } } }) : ok({});
    await mount(true);
    await openAndSend('verify alpha app');
    await screen.findByText(/not in the agent’s approved action allowlist/);
    expect(calls.map((c) => c.url)).toEqual(['/api/agent/v1/command']);
  });

  it('never executes a proposed scan until the user explicitly confirms it', async () => {
    responder = (url) => {
      if (url === '/api/agent/v1/command') return ok({
        intent: 'scan_proposal',
        reply: 'I prepared a scan but have not started it.',
        proposedAction: {
          id: 'scan:pass-a:sbom',
          type: 'scan',
          endpoint: '/api/scans',
          method: 'POST',
          requiresConfirmation: true,
          description: 'Run an SBOM verification scan for alpha app.',
          payload: { targetName: 'alpha app', scanType: 'SBOM Verify', clientName: 'Client A' },
          evidence: { tenantScoped: true, passportId: 'pass-a', clientId: 'client-a' },
        },
      });
      if (url === '/api/agent/v1/receipts/confirmation') return ok({ receiptId: 'agentrcpt_confirm_scan', status: 'CONFIRMED' });
      if (url === '/api/scans') return ok({ id: 'scan_123', jobId: 'job_123', status: 'Queued' });
      if (url === '/api/agent/v1/receipts/outcome') return ok({ receiptId: 'agentrcpt_outcome_scan', status: 'EXECUTED' });
      return ok({});
    };
    await mount(true);
    await openAndSend('scan alpha app');
    await screen.findByText('Run an SBOM verification scan for alpha app.');
    expect(calls.map((c) => c.url)).toEqual(['/api/agent/v1/command']);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and run' }));
    await screen.findByText(/Receipt: id scan_123 · job job_123 · status Queued/);
    expect(calls.map((c) => c.url)).toEqual([
      '/api/agent/v1/command',
      '/api/agent/v1/receipts/confirmation',
      '/api/scans',
      '/api/agent/v1/receipts/outcome',
    ]);
    expect(calls[2].body).toEqual({ targetName: 'alpha app', scanType: 'SBOM Verify', clientName: 'Client A' });
    expect((calls[3].body as any).parentReceiptId).toBe('agentrcpt_confirm_scan');
  });

  it('confirms an approved monitoring run only after the user clicks confirm', async () => {
    responder = (url) => {
      if (url === '/api/agent/v1/command') return ok({
        intent: 'monitoring_run_proposal',
        reply: 'Prepared, not run.',
        proposedAction: {
          id: 'monitor:mon-1:run',
          type: 'monitoring_run',
          endpoint: '/api/monitoring/monitoring-configurations/mon-1/run',
          method: 'POST',
          requiresConfirmation: true,
          description: 'Run repository monitoring now.',
          payload: {},
        },
      });
      if (url === '/api/agent/v1/receipts/confirmation') return ok({ receiptId: 'agentrcpt_confirm_monitor', status: 'CONFIRMED' });
      if (url === '/api/monitoring/monitoring-configurations/mon-1/run') return ok({ jobId: 'collector-job-1', state: 'queued', accepted: true });
      if (url === '/api/agent/v1/receipts/outcome') return ok({ receiptId: 'agentrcpt_outcome_monitor', status: 'EXECUTED' });
      return ok({});
    };
    await mount(true);
    await openAndSend('run monitoring alpha app');
    expect(calls.map((c) => c.url)).toEqual(['/api/agent/v1/command']);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm and run' }));
    await screen.findByText(/job collector-job-1 · state queued/);
    expect(calls.map((c) => c.url)).toEqual([
      '/api/agent/v1/command',
      '/api/agent/v1/receipts/confirmation',
      '/api/monitoring/monitoring-configurations/mon-1/run',
      '/api/agent/v1/receipts/outcome',
    ]);
  });

  it('confirms a report schedule only after showing recipient and cadence', async () => {
    responder = (url) => {
      if (url === '/api/agent/v1/command') return ok({
        intent: 'report_schedule_proposal',
        reply: 'Prepared, not created.',
        proposedAction: {
          id: 'report-schedule:pass-a:weekly',
          type: 'report_schedule',
          endpoint: '/api/report-schedules',
          method: 'POST',
          requiresConfirmation: true,
          description: 'Create a weekly executive report schedule for alpha app, delivered to a@example.test.',
          payload: { passportId: 'pass-a', reportType: 'executive', cadence: 'weekly', recipientEmails: ['a@example.test'] },
        },
      });
      if (url === '/api/agent/v1/receipts/confirmation') return ok({ receiptId: 'agentrcpt_confirm_report', status: 'CONFIRMED' });
      if (url === '/api/report-schedules') return ok({ id: 'rptsch_1', cadence: 'weekly', nextRunAt: '2026-10-12T00:00:00.000Z' });
      if (url === '/api/agent/v1/receipts/outcome') return ok({ receiptId: 'agentrcpt_outcome_report', status: 'EXECUTED' });
      return ok({});
    };
    await mount(true);
    await openAndSend('schedule weekly report for alpha app');
    await screen.findByText(/delivered to a@example.test/);
    expect(calls.map((c) => c.url)).toEqual(['/api/agent/v1/command']);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and run' }));
    await screen.findByText(/id rptsch_1 · cadence weekly · next 2026-10-12T00:00:00.000Z/);
    expect(calls.map((c) => c.url)).toEqual([
      '/api/agent/v1/command',
      '/api/agent/v1/receipts/confirmation',
      '/api/report-schedules',
      '/api/agent/v1/receipts/outcome',
    ]);
  });

  it('confirms founder discovery and pipeline actions through approved endpoints', async () => {
    let mode: 'discovery' | 'stage' = 'discovery';
    responder = (url) => {
      if (url === '/api/agent/v1/command' && mode === 'discovery') return ok({
        intent: 'founder_discovery_proposal',
        reply: 'Prepared discovery.',
        proposedAction: {
          id: 'founder-discovery:kelowna',
          type: 'founder_discovery',
          endpoint: '/api/founder/distribution/discovery/run',
          method: 'POST',
          requiresConfirmation: true,
          description: 'Discover MSP candidates for Kelowna.',
          payload: { query: 'Kelowna', limit: 25 },
        },
      });
      if (url === '/api/agent/v1/receipts/confirmation') return ok({ receiptId: mode === 'discovery' ? 'agentrcpt_confirm_discovery' : 'agentrcpt_confirm_stage', status: 'CONFIRMED' });
      if (url === '/api/founder/distribution/discovery/run') return ok({ status: 'queued', provider: 'search', discovered: 5, queued: 5 });
      if (url === '/api/agent/v1/command' && mode === 'stage') return ok({
        intent: 'founder_pipeline_stage_proposal',
        reply: 'Prepared stage update.',
        proposedAction: {
          id: 'founder-stage:dc_1:qualified',
          type: 'founder_pipeline_stage',
          endpoint: '/api/founder/distribution/contacts/dc_1/stage',
          method: 'PATCH',
          requiresConfirmation: true,
          description: 'Move contact dc_1 to the qualified pipeline stage.',
          payload: { stage: 'qualified' },
        },
      });
      if (url === '/api/founder/distribution/contacts/dc_1/stage') return ok({ id: 'dc_1', pipelineStage: 'qualified' });
      if (url === '/api/agent/v1/receipts/outcome') return ok({ receiptId: mode === 'discovery' ? 'agentrcpt_outcome_discovery' : 'agentrcpt_outcome_stage', status: 'EXECUTED' });
      return ok({});
    };

    await mount(true);
    await openAndSend('find MSPs in Kelowna');
    expect(calls.map((c) => c.url)).toEqual(['/api/agent/v1/command']);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm and run' }));
    await waitFor(() => expect(calls.map((c) => c.url)).toContain('/api/founder/distribution/discovery/run'));

    mode = 'stage';
    await openAndSend('move contact dc_1 to qualified');
    await screen.findByText('Prepared stage update.');
    const stageButtons = screen.getAllByRole('button', { name: 'Confirm and run' });
    fireEvent.click(stageButtons[stageButtons.length - 1]);
    await waitFor(() => expect(calls.map((c) => c.url)).toContain('/api/founder/distribution/contacts/dc_1/stage'));
    const stageActionCall = calls.find((call) => call.url === '/api/founder/distribution/contacts/dc_1/stage');
    expect(stageActionCall?.body).toEqual({ stage: 'qualified' });
  });

  it('action buttons returned by the server only navigate within the allowlist', async () => {
    responder = () => ok({ intent: 'help', reply: 'help text', actions: [{ label: 'Bad link', path: '/etc/passwd' }, { label: 'Good link', path: '/clients' }] });
    await mount(true);
    await openAndSend('help');
    fireEvent.click(await screen.findByRole('button', { name: 'Bad link' }));
    expect(window.location.pathname).toBe('/dashboard');
    await screen.findByText(/not on the agent’s approved navigation list/);
    fireEvent.click(screen.getByRole('button', { name: 'Good link' }));
    expect(window.location.pathname).toBe('/clients');
  });
});

describe('evidence, provenance and UNKNOWN as shown to the user', () => {
  const verified = {
    status: 'OBSERVED', trustDecision: { status: 'NOT_EVALUATED_BY_EXPERIENCE_AGENT' }, evidence: { count: 1, latestObservationAt: '2026-09-01T01:00:00.000Z', latestHash: 'sha256:obs' }, findings: { open: 1, criticalOrHigh: 1 },
    sources: [{ evidenceId: 'e-a-1', provider: 'osv', sourceUrl: 'https://osv.dev/vulnerability/GHSA-x', observedAt: '2026-09-01T00:00:00.000Z', verificationMethod: 'api', evidenceHash: 'sha256:abc123', limitation: 'OSV coverage only' }],
    provenance: { tenantScoped: true, findingRecords: { findingIds: ['f-a-1', 'f-a-2'] }, evidenceRecords: { evidenceIds: ['e-a-1'] }, observationRecords: { observationIds: ['obs-a-1'] } },
  };

  it('displays the observed counts and the provenance (ids, hash, source URL, timestamp, limitation)', async () => {
    responder = (url) => url === '/api/agent/v1/command' ? ok({ intent: 'passport', reply: 'planning', action: { type: 'verify', endpoint: '/api/agent/v1/verify-software', payload: { query: 'alpha app' } } }) : ok(verified);
    await mount(true);
    await openAndSend('verify alpha app');
    await screen.findByText('I observed 1 evidence record(s). I am not assigning a separate trust decision.');
    expect(calls.map((c) => c.url)).toEqual(['/api/agent/v1/command', '/api/agent/v1/verify-software']);
    expect(calls[1].body).toEqual({ query: 'alpha app' });
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Observed: OBSERVED');
    expect(dialog.textContent).toContain('Finding IDs observed: f-a-1, f-a-2');
    expect(dialog.textContent).toContain('Evidence IDs observed: e-a-1');
    expect(dialog.textContent).toContain('Observation IDs observed: obs-a-1');
    expect(dialog.textContent).toContain('Hash: sha256:abc123');
    expect(dialog.textContent).toContain('observed 2026-09-01T00:00:00.000Z');
    expect(dialog.textContent).toContain('Limitation: OSV coverage only');
    const link = screen.getByRole('link', { name: 'Open observed source' }) as HTMLAnchorElement;
    expect(link.href).toBe('https://osv.dev/vulnerability/GHSA-x');
    expect(link.rel).toContain('noreferrer');
    expect(dialog.textContent).not.toMatch(/\b(VERIFIED|INVESTIGATE|AVOID)\b/);
  });

  it('shows UNKNOWN clearly when no passport was observed, with no negative claim', async () => {
    responder = (url) => url === '/api/agent/v1/command' ? ok({ intent: 'passport', reply: 'planning', action: { type: 'verify', endpoint: '/api/agent/v1/verify-software', payload: { query: 'nothing' } } }) : notFound({ status: 'UNKNOWN', reason: 'SOFTWARE_NOT_REGISTERED', provenance: { kind: 'tenant_scoped_database_lookup', table: 'passports', fields: ['id', 'name'], matched: false } });
    await mount(true);
    await openAndSend('verify nothing');
    await screen.findByText(/That software is UNKNOWN because no matching passport record was observed in your authorized workspace\. No negative trust claim was made\./);
    expect(screen.getByRole('dialog').textContent).toContain('Observed: UNKNOWN');
  });

  it('summary answers show the tables, fields and filters they were counted from', async () => {
    responder = () => ok({ intent: 'summary', reply: 'I found 1 client(s).', data: { counts: { clients: 1, passports: 1, openFindings: 1, criticalHighFindings: 1 }, topPassports: [{ passport_id: 'pass-a', name: 'alpha app', open_findings: 1, critical_high: 1, finding_ids: ['f-a-1'] }] }, provenance: { generatedAt: '2026-09-13T00:00:00.000Z', tenantScoped: true, sources: [{ table: 'trust_findings', fields: ['id', 'severity', 'status'], observation: 'open and critical/high counts', filter: 'tenant_id = authenticated tenant' }] } });
    await mount(true);
    await openAndSend('What is my biggest risk today?');
    await screen.findByText('I found 1 client(s).');
    const text = screen.getByRole('dialog').textContent ?? '';
    expect(text).toContain('trust_findings');
    expect(text).toContain('fields: id, severity, status');
    expect(text).toContain('tenant_id = authenticated tenant');
    expect(text).toContain('alpha app: 1 critical/high, 1 open · IDs: f-a-1');
  });

  it('a failed request is shown as a safe error, never as a result', async () => {
    responder = () => ({ status: 500, ok: false, json: async () => ({ error: 'An unexpected server error occurred.' }) });
    await mount(true);
    await openAndSend('What is my biggest risk today?');
    await screen.findByText('SPR Agent could not complete the request.');
    expect(screen.getByRole('dialog').textContent).not.toMatch(/I found|Observed:/);
  });

  it('caps input at 500 characters at the input itself', async () => {
    await mount(true);
    keyK({ ctrlKey: true });
    const input = (await screen.findByLabelText('Ask SPR Agent')) as HTMLInputElement;
    expect(input.maxLength).toBe(500);
  });
});
