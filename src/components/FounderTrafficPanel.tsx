/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { useFounderData } from '../lib/founderData';

// Founder-only site traffic, read from SPR's own page-view telemetry
// (traffic_events, written by installPageViewTracking in the SPA). Counts
// are what the server returns and nothing else. Scope matters here: only
// SPA pages send events, so the server-rendered /software, /whitepaper and
// /roi pages -- and every crawler hit on them -- are not in these numbers.
type Summary = { activeSessions: number | null; activeEvents: number | null; visitors24h: number | null; pageViews24h: number | null; visitors7d: number | null; pageViews7d: number | null };
type TopPage = { path: string; views: number };

export default function FounderTrafficPanel() {
  const { overview, loading } = useFounderData();
  const traffic = overview?.traffic;
  const [topPages, setTopPages] = useState<TopPage[]>([]);
  const [pagesState, setPagesState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    // Top pages are supplemental. The headline traffic numbers come from the
    // shared founder snapshot so Refresh Everything keeps the Founder page
    // internally consistent and a failed pages query cannot turn totals into
    // false zeros.
    fetch('/api/traffic/summary', { credentials: 'include' }).then(async (res) => {
      const data = await res.json().catch(() => null);
      if (cancelled) return;
      if (!res.ok || !data || typeof data !== 'object') { setPagesState('error'); return; }
      setTopPages(Array.isArray(data.topPages) ? data.topPages : []);
      setPagesState('ready');
    }).catch(() => { if (!cancelled) setPagesState('error'); });
    return () => { cancelled = true; };
  }, []);

  const n = (v: number | null | undefined) => (typeof v === 'number' ? v.toLocaleString() : 'Not verified');
  const tiles: [string, number | null | undefined][] = [
    ['Sessions, last 30 min', traffic?.activeSessions],
    ['Visitors, 24 h', traffic?.visitors24h],
    ['Page views, 24 h', traffic?.pageViews24h],
    ['Visitors, 7 d', traffic?.visitors7d],
    ['Page views, 7 d', traffic?.pageViews7d],
  ];

  return (
    <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-6 space-y-3" id="founder-traffic">
      <div className="flex items-center gap-2">
        <Activity className="w-4 h-4 text-[var(--spr-highlight)]" />
        <h2 className="text-sm font-bold text-[var(--spr-text)]">Site traffic</h2>
        <span className="text-xs text-[var(--spr-text-muted)]">SPR page-view telemetry (app pages only; server-rendered /software pages and crawlers are not counted)</span>
      </div>
      {loading && !overview && <p className="text-xs text-[var(--spr-text-muted)]">Loading…</p>}
      {!loading && !traffic && <p role="alert" className="text-xs text-[var(--spr-red)]">Traffic could not be verified.</p>}
      {traffic && (
        <>
          <div className="grid gap-3 sm:grid-cols-5">
            {tiles.map(([label, value]) => (
              <div key={label} className="rounded border border-[var(--spr-border)] p-3">
                <p className="text-[11px] uppercase tracking-wide text-[var(--spr-text-muted)]">{label}</p>
                <p className="text-lg font-semibold text-[var(--spr-text)] tabular-nums">{n(value)}</p>
              </div>
            ))}
          </div>
          {pagesState === 'loading' && <p className="text-xs text-[var(--spr-text-muted)]">Loading top pages…</p>}
          {pagesState === 'error' && <p className="text-xs text-[var(--spr-text-muted)]">Top-page detail could not be loaded; headline totals above remain from the founder snapshot.</p>}
          {pagesState === 'ready' && topPages.length === 0 && <p className="text-xs text-[var(--spr-text-muted)]">No page views recorded in the last 24 hours.</p>}
          {pagesState === 'ready' && topPages.length > 0 && (
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
