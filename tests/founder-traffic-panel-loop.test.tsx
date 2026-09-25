// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

const apiFetch = vi.fn();
vi.mock('../src/utils/apiClient', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import FounderTrafficPanel from '../src/components/FounderTrafficPanel';

const payload = {
  summary: { activeEvents: 5, activeSessions: 2, users24h: 15, pageviews24h: 22, users7d: 139, pageviews7d: 755 },
  topPages: [{ path: '/', views: 7 }],
  recent: [],
  generatedAt: '2026-09-25T23:31:57Z',
};

afterEach(() => { cleanup(); apiFetch.mockReset(); vi.useRealTimers(); });

describe('FounderTrafficPanel', () => {
  it('fetches once on mount, not in a loop after data arrives', async () => {
    apiFetch.mockImplementation(async () => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } }));
    render(<FounderTrafficPanel />);
    await screen.findByText('755');
    await new Promise((r) => setTimeout(r, 300));
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('refreshes on the 30s timer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    apiFetch.mockImplementation(async () => new Response(JSON.stringify(payload), { status: 200 }));
    render(<FounderTrafficPanel />);
    await screen.findByText('755');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });
});
