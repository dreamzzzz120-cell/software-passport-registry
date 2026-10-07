// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import EvidenceDashboardView from '../src/components/EvidenceDashboardView';
import type { Alert } from '../src/types';
afterEach(cleanup);

it('counts each finding once and opens its finding detail instead of monitoring', () => {
  const navigate = vi.fn();
  render(<EvidenceDashboardView role="Viewer" clients={[]} scans={[]} passports={[]}
    alerts={[
      { id: 'high-1', title: 'Observed vulnerability', severity: 'High', status: 'Open' },
      { id: 'closed-1', title: 'Resolved issue', severity: 'Critical', status: 'Resolved' },
      { id: 'cancelled-1', title: 'Cancelled issue', severity: 'High', status: 'Cancelled' },
    ] as Alert[]}
    findings={[{ id: 'high-1', severity: 'HIGH', status: 'OPEN' }]}
    onNavigateTab={navigate} onOpenQuickAction={vi.fn()} />);
  const tile = screen.getByRole('button', { name: /Open trust findings/ });
  expect(within(tile).getByText('1')).toBeTruthy();
  fireEvent.click(tile);
  expect(navigate).toHaveBeenLastCalledWith('/alerts');
  fireEvent.click(screen.getByRole('button', { name: /Observed vulnerability/ }));
  expect(navigate).toHaveBeenLastCalledWith('/alerts', 'high-1');
  expect(screen.queryByRole('button', { name: /Resolved issue|Cancelled issue/ })).toBeNull();
  const monitoring = screen.getByRole('button', { name: /Monitoring.*Open workspace/ });
  fireEvent.click(monitoring);
  expect(navigate).toHaveBeenLastCalledWith('/monitoring');
});
