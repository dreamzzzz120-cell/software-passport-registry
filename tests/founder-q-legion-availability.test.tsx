// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const apiFetch = vi.fn();
vi.mock('../src/utils/apiClient', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
import FounderQLegionPanel from '../src/components/FounderQLegionPanel';
afterEach(() => { cleanup(); apiFetch.mockReset(); });
it('shows unknown outcomes and disables rebuild when storage is unavailable', async () => {
  apiFetch.mockResolvedValue(new Response(JSON.stringify({ error: 'Q-LEGION storage is not configured.' }), { status: 503 }));
  render(<FounderQLegionPanel />);
  await screen.findByRole('alert');
  expect(screen.queryByText('0')).toBeNull();
  expect((screen.getByRole('button', { name: 'Rebuild observed missions' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/Strategy outcomes are unavailable/)).toBeTruthy();
});
it('clears old outcomes when a subsequent refresh fails', async () => {
  apiFetch.mockImplementation(async () => new Response(JSON.stringify({mode:'SHADOW',missionCount:0,receiptCount:0,totals:{sent:9,replied:0,demos:0,checkouts:0,customers:0,lost:0},strategyPerformance:[],missions:[]})));
  render(<FounderQLegionPanel />);
  await screen.findByText('9');
  apiFetch.mockImplementation(async () => new Response('{}', {status:503}));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByRole('alert');
  await waitFor(() => expect(screen.queryByText('9')).toBeNull());
});
