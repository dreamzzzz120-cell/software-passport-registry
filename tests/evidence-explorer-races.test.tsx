// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const api = vi.hoisted(() => vi.fn());
vi.mock('../src/utils/apiClient', () => ({ apiFetch: api }));
import EvidenceExplorerView from '../src/components/EvidenceExplorerView';
import type { SoftwarePassport } from '../src/types';
afterEach(() => { cleanup(); api.mockReset(); });
const passports = [{ id: 'a', name: 'A', version: '1' }, { id: 'b', name: 'B', version: '1' }] as SoftwarePassport[];
const ledger = (trace: string) => new Response(JSON.stringify({ trace, findings: [], evidence: [], observations: [] }));
it('keeps the latest passport ledger when an older response arrives last', async () => {
  let resolveA!: (response: Response) => void;
  api.mockImplementation((url: string) => url.endsWith('/a') ? new Promise<Response>(resolve => { resolveA = resolve; }) : Promise.resolve(ledger('ledger B')));
  render(<EvidenceExplorerView passports={passports} />);
  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/trust-loop/ledger/a'));
  fireEvent.change(screen.getByLabelText('Passport'), { target: { value: 'b' } });
  await screen.findByText('ledger B');
  await act(async () => { resolveA(ledger('ledger A')); });
  expect(screen.queryByText('ledger A')).toBeNull();
  expect(screen.getByText('ledger B')).toBeTruthy();
});
it('rejects malformed lists and retries without refetching on selection', async () => {
  api.mockResolvedValueOnce(new Response('{bad'));
  render(<EvidenceExplorerView />);
  await screen.findByText('Passport list unavailable');
  api.mockImplementation((url: string) => Promise.resolve(url === '/api/user/passports' ? new Response(JSON.stringify(passports)) : ledger(url)));
  fireEvent.click(screen.getByRole('button', { name: /retry/i }));
  await waitFor(() => expect((screen.getByLabelText('Passport') as HTMLSelectElement).value).toBe('a'));
  // Finish the first ledger request before switching; this test specifically checks
  // that selecting another passport doesn't re-fetch the passport list.
  await screen.findByText('/api/trust-loop/ledger/a');
  fireEvent.change(screen.getByLabelText('Passport'), { target: { value: 'b' } });
  await screen.findByText('/api/trust-loop/ledger/b');
  expect(api.mock.calls.filter(([url]) => url === '/api/user/passports')).toHaveLength(2);
});
