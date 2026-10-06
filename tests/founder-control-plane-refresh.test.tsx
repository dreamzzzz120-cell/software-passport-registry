// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../src/utils/apiClient', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
import FounderControlPlane from '../src/components/FounderControlPlane';
afterEach(() => { cleanup(); apiFetch.mockReset(); });

it('keeps independently retrieved billing visible when another endpoint fails', async () => {
  apiFetch.mockImplementation(async (path: string) => {
    if (path === '/api/remediation-tasks') throw new Error('Repair service unavailable');
    return new Response(JSON.stringify(path === '/api/billing' ? { subscription: { plan: 'Professional' } } : {}));
  });
  render(<FounderControlPlane />);
  await screen.findByText('Professional');
  expect(screen.getByText(/Repair service unavailable/)).toBeTruthy();
});

it('clears stale readings and disables campaign toggles when refresh fails', async () => {
  apiFetch.mockImplementation(async (path: string) => new Response(JSON.stringify(
    path === '/api/founder/distribution/growth' ? { settings: { outreachEnabled: true } } :
    path === '/api/founder/reality' ? { incidents: [], systemState: {} } :
    path === '/api/billing' ? { subscription: { plan: 'Professional' } } : {}
  )));
  render(<FounderControlPlane />);
  await screen.findByText('Professional');
  apiFetch.mockImplementation(async () => new Response('{}', { status: 503 }));
  fireEvent.click(screen.getByRole('button', { name: /Refresh controls/ }));
  await screen.findByText(/Incident data unavailable/);
  expect(screen.queryByText('Professional')).toBeNull();
  expect(screen.queryByText('No active reality incidents are currently observed.')).toBeNull();
  await waitFor(() => expect((screen.getByRole('button', { name: /Outreach.*UNKNOWN/ }) as HTMLButtonElement).disabled).toBe(true));
});
