/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

// Founder-only site traffic, read from SPR's own page-view telemetry
// (traffic_events, written by installPageViewTracking in the SPA). Counts
// are what the server returns and nothing else. Scope matters here: only
// SPA pages send events, so the server-rendered /software, /whitepaper and
// /roi pages -- and every crawler hit on them -- are not in these numbers.
type Summary = { active_sessions?: number; active_events?: number; users_24h?: number; pageviews_24h?: number; users_7d?: number; pageviews_7d?: number };
type TopPage = { path: string; views: number };

export default function FounderTrafficPanel() {
  const [summary, setSummary] = useState<Summary>({});
  const [topPages, setTopPages] = useState<TopPage[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/traffic/summary').then(async (res) => {
      const data = await res.json().catch(() => null);
      if (cancelled) return;
      if (!res.ok || !data || typeof data !== 'object') { setState('error'); return; }
      setSummary(data.summary && typeof data.summary === 'object' ? data.summary : {});
      setTopPages(Array.isArray(data.topPages) ? data.topPages : []);
      setState('ready');
    }).catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, []);

  const n = (v: number | undefined) => (typeof v === 'number' ? v.toLocaleString() : 'Not verified');
  const tiles: [string, number | undefined][] = [
    ['Sessions, last 30 min', summary.active_sessions],
    ['Visitors, 24 h', summary.users_24h],
    ['Page views, 24 h', summary.pageviews_24h],
    ['Visitors, 7 d', summary.users_7d],
    ['Page views, 7 d', summary.pageviews_7d],
  ];

  return (
    <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-6 space-y-3" id="founder-traffic">
      <div className="flex items-center gap-2">
        <Activity className="w-4 h-4 text-[var(--spr-highlight)]" />
        <h2 className="text-sm font-bold text-[var(--spr-text)]">Site traffic</h2>
        <span className="text-xs text-[var(--spr-text-muted)]">SPR page-view telemetry (app pages only; server-rendered /software pages and crawlers are not counted)</span>
      </div>
      {state === 'loading' && <p className="text-xs text-[var(--spr-text-muted)]">Loading…</p>}
      {state === 'error' && <p role="alert" className="text-xs text-[var(--spr-red)]">Traffic could not be loaded.</p>}
      {state === 'ready' && (
        <>
          <div className="grid gap-3 sm:grid-cols-5">
            {tiles.map(([label, value]) => (
              <div key={label} className="rounded border border-[var(--spr-border)] p-3">
                <p className="text-[11px] uppercase tracking-wide text-[var(--spr-text-muted)]">{label}</p>
                <p className="text-lg font-semibold text-[var(--spr-text)] tabular-nums">{n(value)}</p>
              </div>
            ))}
          </div>
          {topPages.length === 0 && <p className="text-xs text-[var(--spr-text-muted)]">No page views recorded in the last 24 hours.</p>}
          {topPages.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-[var(--spr-text-muted)]"><th className="py-1 pr-3">Page (24 h)</th><th className="py-1 pr-3 text-right">Views</th></tr></thead>
                <tbody>
                  {topPages.map((p) => (
                    <tr key={p.path} className="border-t border-[var(--spr-border)]">
                      <td className="py-1.5 pr-3 font-mono text-[var(--spr-text)]">{p.path}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-[var(--spr-text)]">{p.views.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
