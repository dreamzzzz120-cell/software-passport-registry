/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

type Summary = {
  activeEvents: number | null;
  activeSessions: number | null;
  users24h: number | null;
  pageviews24h: number | null;
  users7d: number | null;
  pageviews7d: number | null;
};

type TopPage = { path: string; views: number };
type RecentEvent = { occurredAt: string; path: string; deviceType: string | null; country: string | null };
type TrafficData = { summary: Summary | null; topPages: TopPage[]; recent: RecentEvent[]; generatedAt: string };

const REFRESH_MS = 30_000;

export default function FounderTrafficPanel() {
  const [data, setData] = useState<TrafficData | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const hasData = useRef(false);

  // Stable across renders. It used to depend on `data`, so every successful
  // fetch rebuilt `load`, re-ran the effect below and fetched again -- a tight
  // loop (~5 requests/s) that exhausted the founder rate-limit budget and
  // 429'd every other founder panel.
  const load = useCallback(async () => {
    if (!hasData.current) setState('loading');
    try {
      const res = await apiFetch('/api/founder/traffic');
      if (!res.ok) {
        setState('error');
        return;
      }
      const next = (await res.json()) as TrafficData;
      if (!next || typeof next !== 'object' || !next.summary) {
        setState('error');
        return;
      }
      setData({
        summary: next.summary,
        topPages: Array.isArray(next.topPages) ? next.topPages : [],
        recent: Array.isArray(next.recent) ? next.recent : [],
        generatedAt: next.generatedAt,
      });
      hasData.current = true;
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { void load(); }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const n = (v: number | null | undefined) => (typeof v === 'number' ? v.toLocaleString() : 'Not verified');
  const summary = data?.summary;
  const tiles: [string, number | null | undefined][] = [
    ['Active events, 30 min', summary?.activeEvents],
    ['Active sessions, 30 min', summary?.activeSessions],
    ['Sessions, 24 h', summary?.users24h],
    ['Page views, 24 h', summary?.pageviews24h],
    ['Sessions, 7 d', summary?.users7d],
    ['Page views, 7 d', summary?.pageviews7d],
  ];

  return (
    <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-6 space-y-4" id="founder-traffic">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-[var(--spr-highlight)]" />
          <h2 className="text-sm font-bold text-[var(--spr-text)]">Site traffic</h2>
          <span className="text-xs text-[var(--spr-text-muted)]">SPR page-view telemetry</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-[var(--spr-text-muted)]">
            {data?.generatedAt ? `Updated ${new Date(data.generatedAt).toLocaleTimeString()}` : 'Not verified'}
          </span>
          <button onClick={() => void load()} className="spr-btn spr-btn-secondary inline-flex items-center gap-2 text-xs" disabled={state === 'loading'}>
            <RefreshCw className={`w-3.5 h-3.5 ${state === 'loading' ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {state === 'loading' && !data && <p className="text-xs text-[var(--spr-text-muted)]">Loading traffic telemetry…</p>}
      {state === 'error' && !data && <p role="alert" className="text-xs text-[var(--spr-red)]">Traffic could not be verified.</p>}
      {state === 'error' && data && <p className="text-xs text-[var(--spr-amber)]">Refresh failed; showing the last verified traffic snapshot.</p>}

      {data && summary && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {tiles.map(([label, value]) => (
              <div key={label} className="rounded border border-[var(--spr-border)] p-3">
                <p className="text-[11px] uppercase tracking-wide text-[var(--spr-text-muted)]">{label}</p>
                <p className="text-lg font-semibold text-[var(--spr-text)] tabular-nums">{n(value)}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-[11px] uppercase tracking-[0.2em] font-semibold text-[var(--spr-text-muted)]">Top pages · 24 h</p>
              {data.topPages.length === 0 ? (
                <p className="text-xs text-[var(--spr-text-muted)]">No page views recorded in the last 24 hours.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-left text-[11px] uppercase tracking-wide text-[var(--spr-text-muted)]"><th className="py-1 pr-3">Page</th><th className="py-1 text-right">Views</th></tr></thead>
                    <tbody>
                      {data.topPages.slice(0, 10).map((p) => (
                        <tr key={p.path} className="border-t border-[var(--spr-border)]">
                          <td className="py-1.5 pr-3 font-mono text-[var(--spr-text)]">{p.path}</td>
                          <td className="py-1.5 text-right tabular-nums text-[var(--spr-text)]">{p.views.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <p className="mb-2 text-[11px] uppercase tracking-[0.2em] font-semibold text-[var(--spr-text-muted)]">Recent observed events</p>
              {data.recent.length === 0 ? (
                <p className="text-xs text-[var(--spr-text-muted)]">No traffic events recorded.</p>
              ) : (
                <div className="max-h-64 overflow-auto rounded border border-[var(--spr-border)]">
                  <table className="w-full text-xs">
                    <thead><tr className="sticky top-0 bg-[var(--spr-surface)] text-left text-[11px] uppercase tracking-wide text-[var(--spr-text-muted)]"><th className="py-1.5 px-2">Time</th><th className="py-1.5 px-2">Page</th><th className="py-1.5 px-2">Device</th><th className="py-1.5 px-2">Country</th></tr></thead>
                    <tbody>
                      {data.recent.slice(0, 25).map((event, i) => (
                        <tr key={`${event.occurredAt}-${event.path}-${i}`} className="border-t border-[var(--spr-border)]">
                          <td className="whitespace-nowrap py-1.5 px-2 text-[var(--spr-text-muted)]">{new Date(event.occurredAt).toLocaleTimeString()}</td>
                          <td className="py-1.5 px-2 font-mono text-[var(--spr-text)]">{event.path}</td>
                          <td className="py-1.5 px-2 text-[var(--spr-text-muted)]">{event.deviceType ?? 'unknown'}</td>
                          <td className="py-1.5 px-2 text-[var(--spr-text-muted)]">{event.country ?? 'unknown'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
