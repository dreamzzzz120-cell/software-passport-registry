/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { Database } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { CRAWL_LANGUAGES } from '../lib/registryCrawl';

// Founder-only view of the public registry crawler: registry size, queue
// depth and the last passes exactly as the worker recorded them.
type Run = { id: string; startedAt: string; finishedAt: string | null; discovered: number; enqueued: number; skipped: number; error: string | null; note: string | null };
type Data = { registrySize: number; queue: Record<string, number>; cursor: { languageIndex: number; page: number; updatedAt: string } | null; runs: Run[]; enabled: boolean };

export default function FounderRegistryCrawlerPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/founder/registry-crawler').then(async (res) => {
      const json = await res.json().catch(() => null);
      if (cancelled) return;
      if (!res.ok || !json) { setState('error'); return; }
      setData(json); setState('ready');
    }).catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-6 space-y-3" id="founder-registry-crawler">
      <div className="flex items-center gap-2">
        <Database className="w-4 h-4 text-[var(--spr-highlight)]" />
        <h2 className="text-sm font-bold text-[var(--spr-text)]">Public registry crawler</h2>
        {data && <span className="text-xs text-[var(--spr-text-muted)]">{data.registrySize} repositories fully reviewed · {data.enabled ? 'enabled' : 'disabled'}</span>}
      </div>
      {state === 'loading' && <p className="text-xs text-[var(--spr-text-muted)]">Loading…</p>}
      {state === 'error' && <p role="alert" className="text-xs text-[var(--spr-red)]">Crawler telemetry could not be loaded.</p>}
      {data && (
        <>
          <p className="text-xs text-[var(--spr-text-muted)]">
            Queue: {Object.entries(data.queue).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ') || 'empty'}.
            {data.cursor ? ` Discovery cursor: ${CRAWL_LANGUAGES[data.cursor.languageIndex] ?? '?'} page ${data.cursor.page} (moved ${new Date(data.cursor.updatedAt).toLocaleString()}).` : ' Discovery has not run yet.'}
          </p>
          {data.runs.length === 0 ? <p className="text-xs text-[var(--spr-text-muted)]">No crawl passes recorded yet. The worker runs one pass per hour.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-[var(--spr-text-muted)]"><th className="py-1 pr-3">Started</th><th className="py-1 pr-3">Discovered</th><th className="py-1 pr-3">Queued</th><th className="py-1 pr-3">Already reviewed</th><th className="py-1 pr-3">Note</th></tr></thead>
                <tbody>{data.runs.map((r) => (
                  <tr key={r.id} className="border-t border-[var(--spr-border)]">
                    <td className="py-1.5 pr-3 whitespace-nowrap text-[var(--spr-text-muted)]">{new Date(r.startedAt).toLocaleString()}</td>
                    <td className="py-1.5 pr-3 text-[var(--spr-text)]">{r.discovered}</td>
                    <td className="py-1.5 pr-3 text-[var(--spr-text)]">{r.enqueued}</td>
                    <td className="py-1.5 pr-3 text-[var(--spr-text-muted)]">{r.skipped}</td>
                    <td className={`py-1.5 pr-3 ${r.error ? 'text-[var(--spr-red)]' : 'text-[var(--spr-text-muted)]'}`}>{r.error ?? r.note ?? (r.finishedAt ? '' : 'running')}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
