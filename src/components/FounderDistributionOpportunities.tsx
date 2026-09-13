import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../utils/apiClient';

type Opportunity = {
  jobId: string;
  kind: string;
  score: number | null;
  company: string | null;
  url: string | null;
  leadId: string | null;
  businessEmail: boolean | null;
  signals: Record<string, boolean> | null;
  observedAt: string | null;
  jobUpdatedAt: string;
};

export default function FounderDistributionOpportunities() {
  const [items, setItems] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/founder/distribution/opportunities');
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      const body = await res.json();
      setItems(Array.isArray(body.opportunities) ? body.opportunities : []);
    } catch {
      setError('Opportunity data could not be observed right now.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-5">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.24em] font-semibold text-[var(--spr-text-muted)]">Distribution</p>
          <h2 className="mt-1 text-lg font-semibold text-[var(--spr-text)]">Founder Opportunity Queue</h2>
          <p className="mt-1 text-xs text-[var(--spr-text-muted)]">Ranked observations from stored research evidence. Candidates are not verified MSPs.</p>
        </div>
        <button onClick={() => void load()} className="spr-btn spr-btn-secondary text-xs" disabled={loading}>Refresh</button>
      </div>

      {loading && <p className="text-sm text-[var(--spr-text-muted)]">Observing opportunity data…</p>}
      {error && <p className="text-sm text-[var(--spr-red)]">{error}</p>}
      {!loading && !error && items.length === 0 && <p className="text-sm text-[var(--spr-text-muted)]">No scored opportunities observed yet.</p>}

      <div className="space-y-3">
        {items.map((item, index) => (
          <article key={item.jobId} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--spr-text-muted)]">#{index + 1} · {item.kind.replace('_', ' ')}</p>
                <h3 className="mt-1 font-semibold text-[var(--spr-text)]">{item.company || 'Company not observed'}</h3>
                {item.url ? <a className="block truncate text-xs text-[var(--spr-highlight)] hover:underline" href={item.url} target="_blank" rel="noreferrer">{item.url}</a> : <p className="text-xs text-[var(--spr-text-muted)]">URL not observed</p>}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--spr-text-muted)]">Opportunity score</p>
                <p className="text-2xl font-bold text-[var(--spr-text)]">{item.score ?? 'Not verified'}</p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {Object.entries(item.signals || {}).map(([name, observed]) => (
                <span key={name} className="rounded-full border border-[var(--spr-border)] px-2 py-1 text-[11px] text-[var(--spr-text-muted)]">
                  {name}: {observed ? 'observed' : 'not observed'}
                </span>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--spr-text-muted)]">
              <span>Business email: {item.businessEmail === null ? 'Not verified' : item.businessEmail ? 'observed' : 'not observed'}</span>
              <span>Observed: {item.observedAt || 'Not verified'}</span>
            </div>
          </article>
        ))}
      </div>

      <p className="mt-4 border-t border-[var(--spr-border)] pt-3 text-[11px] text-[var(--spr-text-muted)]">Evidence policy: scores are heuristic observations from stored job results. Review the source evidence before contacting anyone. SPR does not automatically send unsolicited outreach.</p>
    </section>
  );
}
