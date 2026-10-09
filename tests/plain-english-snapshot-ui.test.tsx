// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PlainEnglishReport from '../src/components/PlainEnglishReport';
import type { CanonicalReport } from '../src/trust/plain-english-report';

const snapshot: CanonicalReport = {
  passport: { id: 'p1', name: 'Historical software' }, reportHash: 'historical-hash',
  risk: { overall: null, security: null, compliance: null, verificationStatus: 'unverified' },
  evidenceQuality: { completenessBasisPoints: 0, unknownDimensions: 0, latestObservationAt: null },
  findings: [{ id: 'f1', control_id: 'mfa', title: 'Historical MFA gap', severity: 'high', status: 'UNKNOWN', description: 'Historical missing scope', remediation: '', updated_at: '2026-09-01', resolved_at: null }],
  evidence: [], generatedAt: '2026-09-01T00:00:00Z',
};
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('renders and exports the exact selected snapshot without requesting a newer report', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  const { rerender } = render(<PlainEnglishReport snapshot={snapshot} />);
  expect(screen.getAllByText('Historical missing scope').length).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Copy evidence questions' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
  expect(writeText.mock.calls[0][0]).toContain('historical-hash');
  rerender(<PlainEnglishReport snapshot={{ ...snapshot, reportHash: 'new-hash', findings: [{ ...snapshot.findings[0], description: 'New missing scope' }] }} />);
  expect(screen.queryAllByText('Historical missing scope')).toHaveLength(0);
  expect(screen.getAllByText('New missing scope').length).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Copy evidence questions' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
  expect(writeText.mock.calls[1][0]).toContain('new-hash');
  expect(fetch).not.toHaveBeenCalled();
});
