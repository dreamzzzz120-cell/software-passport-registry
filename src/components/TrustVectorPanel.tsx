/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The 12-dimension Trust Vector for one passport, exactly as the server
 * computed it: value or UNKNOWN per dimension, the record ids each reading
 * rests on, and the time of the underlying observation.
 */

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Radar } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

type Reading = { id: string; label: string; value: number | null; status: 'observed' | 'unknown'; detail: string; basisIds: string[]; observedAt: string | null };
type Vector = { id: string; version: string; computedAt: string; dimensions: Reading[]; observedCount: number; unknownCount: number; policy: string };

function tone(value: number | null): string {
  if (value === null) return 'bg-[var(--spr-surface-sunken)] text-[var(--spr-text-faint)]';
  if (value >= 75) return 'bg-[var(--spr-green)]/15 text-[var(--spr-green)]';
  if (value >= 45) return 'bg-[var(--spr-amber)]/15 text-[var(--spr-amber)]';
  return 'bg-[var(--spr-red)]/15 text-[var(--spr-red)]';
}

export default function TrustVectorPanel({ passportId }: { passportId: string }) {
  const [vector, setVector] = useState<Vector | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const response = await apiFetch(`/api/trust-vector/${encodeURIComponent(passportId)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data?.error || `HTTP ${response.status}`); setVector(null); return; }
      setVector(data);
    } catch (err) { setError(err instanceof Error ? err.message : 'Network error.'); }
    finally { setBusy(false); }
  }, [passportId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="spr-panel p-5" aria-labelledby="trust-vector-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.06em] text-[var(--spr-highlight)]"><Radar className="h-4 w-4" /> 12-dimension Trust Vector</div>
          <h3 id="trust-vector-title" className="mt-1 text-sm font-semibold text-[var(--spr-text)]">{vector ? `${vector.observedCount} of 12 dimensions observed · computed ${new Date(vector.computedAt).toLocaleString()}` : busy ? 'Computing…' : 'Not computed'}</h3>
        </div>
        <button onClick={() => void load()} disabled={busy} className="inline-flex items-center gap-1 rounded border border-[var(--spr-border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--spr-text)] hover:bg-[var(--spr-surface-hover)] disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} /> Recompute</button>
      </div>
      {error && <p role="alert" className="mt-3 text-xs text-[var(--spr-red)]">{error}</p>}
      {vector && (
        <>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {vector.dimensions.map((d) => (
              <button key={d.id} onClick={() => setOpen(open === d.id ? null : d.id)} className={`rounded border border-[var(--spr-border)] p-3 text-left ${open === d.id ? 'bg-[var(--spr-surface-hover)]' : 'bg-[var(--spr-surface-alt)]'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[var(--spr-text)]">{d.label}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${tone(d.value)}`}>{d.value === null ? 'UNKNOWN' : d.value}</span>
                </div>
                <p className="mt-1 text-[11px] leading-4 text-[var(--spr-text-muted)]">{d.detail}</p>
                {open === d.id && (
                  <div className="mt-2 border-t border-[var(--spr-border)] pt-2 text-[11px] text-[var(--spr-text-faint)]">
                    <div>Observed: {d.observedAt ? new Date(d.observedAt).toLocaleString() : 'not observed'}</div>
                    <div className="mt-1 break-all">Basis: {d.basisIds.length ? `${d.basisIds.length} record(s) — ${d.basisIds.slice(0, 6).join(', ')}${d.basisIds.length > 6 ? '…' : ''}` : 'no records (derived from timestamps or absent inputs)'}</div>
                  </div>
                )}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-[var(--spr-text-faint)]">{vector.policy}</p>
        </>
      )}
    </section>
  );
}
