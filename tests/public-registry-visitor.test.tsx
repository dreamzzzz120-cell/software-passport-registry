// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
vi.mock('../src/utils/apiClient', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../src/utils/apiClient';
import PublicRegistryView from '../src/components/PublicRegistryView';
const item = { id: 'real', repository_owner: 'expressjs', repository_name: 'express', canonical_url: 'https://github.com/expressjs/express', status: 'discovered', stars: 1, language: 'JavaScript', license_spdx: 'MIT', quality_status: 'unknown', last_observed_at: '2026-10-01T00:00:00Z' };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('public registry visitor next steps', () => {
 it('keeps evidence UNKNOWN on index failure and carries the repo into free review', async () => {
  vi.mocked(apiFetch).mockResolvedValue(response({ ok: true, count: 1, items: [item] }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({}, 503)));
  render(<PublicRegistryView />);
  const link = await screen.findByRole('link', { name: 'Run a free review' });
  expect(link.getAttribute('href')).toContain('owner=expressjs&repo=express');
  expect(screen.queryByRole('link', { name: 'View SPR evidence' })).toBeNull();
  expect(screen.getByText(/Search and language filters apply to the complete loaded registry/)).toBeTruthy();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'missing' } });
  expect(screen.getByText('No matches in the observed registry')).toBeTruthy();
 });

 it('loads every registry page instead of stopping at the first page', async () => {
  const second = { ...item, id: 'second', repository_owner: 'vitejs', repository_name: 'vite' };
  vi.mocked(apiFetch)
    .mockResolvedValueOnce(response({ ok: true, count: 2, items: [item] }))
    .mockResolvedValueOnce(response({ ok: true, count: 2, items: [second] }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ entries: [] })));
  render(<PublicRegistryView />);
  await screen.findByText('expressjs');
  expect(screen.getByText('express')).toBeTruthy();
  expect(await screen.findByText('vitejs')).toBeTruthy();
  expect(screen.getByText('vite')).toBeTruthy();
  expect(vi.mocked(apiFetch).mock.calls[0]?.[0]).toContain('offset=0');
  expect(vi.mocked(apiFetch).mock.calls[1]?.[0]).toContain('offset=1');
 });

 it('links evidence only when a retrieved completed review identifies that repository', async () => {
  vi.mocked(apiFetch).mockResolvedValue(response({ ok: true, count: 1, items: [item] }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ entries: [{ owner: 'ExpressJS', repository: 'Express' }] })));
  render(<PublicRegistryView />);
  expect((await screen.findByRole('link', { name: 'View SPR evidence' })).getAttribute('href')).toBe('/software/expressjs/express');
 });
 it('distinguishes an empty registry and removes stale totals after failed refresh', async () => {
  vi.mocked(apiFetch).mockResolvedValueOnce(response({ ok: true, count: 0, items: [] })).mockResolvedValueOnce(response({}, 500));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ entries: [] })));
  render(<PublicRegistryView />);
  await screen.findByText('No repositories observed yet');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh registry' }));
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(screen.queryByText('Observed repositories')).toBeNull();
 });
});
