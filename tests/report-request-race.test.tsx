// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import ReportsView from '../src/components/ReportsView';
import type { SoftwarePassport } from '../src/types';
const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../src/utils/apiClient', () => ({ apiFetch }));
vi.mock('../src/utils/pdfGenerator', () => ({ generateCoBrandedTrustReport: vi.fn(), generatePassportEvidenceReport: vi.fn() }));
vi.mock('../src/components/PlainEnglishReport', () => ({ default: ({ snapshot }: any) => <div>{snapshot.reportHash}</div> }));
vi.mock('../src/components/VendorEvidenceRequestPanel', () => ({ default: () => null }));
const passports = ['a', 'b'].map(id => ({ id, name: id, version: '1', evidence: [], vulnerabilities: [], sbom: [] } as unknown as SoftwarePassport));
const response = (hash: string) => ({ ok: true, json: async () => ({ reportHash: hash, passport: { id: 'a', name: 'a' }, findings: [], evidence: [] }) });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('discards an old report response after switching Launch Tickets', async () => {
  let finish!: (value: any) => void;
  apiFetch.mockImplementation((url: string) => url === '/api/trust-loop/reports/a?type=executive'
    ? new Promise(resolve => { finish = resolve; })
    : Promise.resolve({ ok: true, json: async () => ({ snapshots: [], insufficientData: true }) }));
  render(<ReportsView passports={passports} />);
  fireEvent.click(screen.getByRole('button', { name: 'Load report' }));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  const select = screen.getAllByRole('combobox').find(el => (el as HTMLSelectElement).value === 'a')!;
  fireEvent.change(select, { target: { value: 'b' } });
  await act(async () => { finish(response('old-report-hash')); });
  expect(screen.queryByText('old-report-hash')).toBeNull();
  expect(screen.getByRole('button', { name: 'Load report' }).hasAttribute('disabled')).toBe(false);
});
