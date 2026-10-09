// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import EvidenceGapPlanPanel from '../src/components/EvidenceGapPlanPanel';
import { buildEvidenceGapPlan } from '../src/trust/evidence-gap-plan';
import type { CanonicalReport } from '../src/trust/plain-english-report';

const report: CanonicalReport = { passport: { id: 'p1', name: 'Client software' }, reportHash: 'hash-real',
  risk: { overall: null, security: null, compliance: null, verificationStatus: 'unverified' },
  evidenceQuality: { completenessBasisPoints: 0, unknownDimensions: 0, latestObservationAt: null },
  findings: [{ id: 'f1', control_id: 'mfa', title: 'MFA coverage', severity: 'high', status: 'UNKNOWN', description: 'Token cannot read the control.', remediation: '', updated_at: '2026-10-09', resolved_at: null }],
  evidence: [], generatedAt: '2026-10-09T00:00:00Z' };

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('review plan interactions', () => {
  it('renders actual gap text and unassigned work; escapes source text', () => {
    const plan = buildEvidenceGapPlan({ ...report, findings: [{ ...report.findings[0], description: '<script>bad()</script>' }] });
    const { container } = render(<EvidenceGapPlanPanel plan={plan} />);
    expect(screen.getByText('Unassigned')).toBeTruthy();
    expect(screen.getByText('<script>bad()</script>')).toBeTruthy();
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByRole('region', { name: 'Evidence gaps and review plan' })).toBeTruthy();
  });
  it('copies review questions without sending them or claiming verification', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<EvidenceGapPlanPanel plan={buildEvidenceGapPlan(report)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy evidence questions' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Questions copied'));
    expect(writeText.mock.calls[0][0]).toContain('MFA coverage (mfa)');
    expect(writeText.mock.calls[0][0]).toContain('hash-real');
    expect(writeText.mock.calls[0][0]).toContain('Responses require review');
  });
  it('exposes clipboard failure and offers download', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true });
    render(<EvidenceGapPlanPanel plan={buildEvidenceGapPlan(report)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy evidence questions' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Copy failed'));
    expect(screen.getByRole('button', { name: 'Download review plan' })).toBeTruthy();
  });
  it('downloads the proposed work and releases the object URL', () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:test');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<EvidenceGapPlanPanel plan={buildEvidenceGapPlan(report)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download review plan' }));
    expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });
});
