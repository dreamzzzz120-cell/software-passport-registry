import { useEffect, useState } from 'react';
import { apiFetch } from '../utils/apiClient';

type Candidate = {
  id: string; clientId: string | null; passportId: string; findingId: string;
  title: string; severity: string; evidenceIds: string[]; observedAt: string;
  suggestedService: string; estimatedValue: null; limitation: string;
};
type Response = { opportunities: Candidate[]; incomplete: boolean; generatedAt: string };
type Review = { findingId: string; action: 'ACCEPTED_FOR_REVIEW' | 'DISMISSED' };

export default function RevenueReviewPanel({ onOpenClient, onOpenPassport }: {
  onOpenClient: (id: string) => void; onOpenPassport: (id: string) => void;
}) {
  const [result, setResult] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      apiFetch('/api/agent/v1/revenue/opportunities?limit=25'),
      apiFetch('/api/revenue/reviews')
    ]).then(async ([candidates, history]) => {
      if (!candidates.ok || !history.ok) throw new Error(`Could not load review candidates (${candidates.status}, ${history.status}).`);
      return [await candidates.json() as Response, await history.json() as { reviews: Review[] }] as const;
    }).then(([body, history]) => { if (active) { setResult(body); setReviews(history.reviews); setError(null); } })
      .catch((cause: Error) => { if (active) { setResult(null); setError(cause.message); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);

  const decide = async (item: Candidate, action: Review['action']) => {
    if (saving) return;
    setSaving(item.findingId); setError(null);
    try {
      const response = await apiFetch('/api/revenue/reviews', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ findingId: item.findingId, action, idempotencyKey: crypto.randomUUID() }) });
      if (!response.ok) throw new Error(`Could not save review (${response.status}). Refresh and check the evidence.`);
      setRevision(n => n + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save review.'); }
    finally { setSaving(null); }
  };

  return <section className="rounded-[26px] border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5 md:p-6">
    <div className="flex items-start justify-between gap-4">
      <div><div className="text-xs font-bold uppercase tracking-[.18em] text-[var(--spr-highlight)]">Revenue intelligence</div>
        <h2 className="mt-2 text-xl font-bold text-[var(--spr-text)]">Evidence-backed service review</h2>
        <p className="mt-1 text-xs leading-5 text-[var(--spr-text-muted)]">Open high or critical findings with linked recent evidence. These are review candidates, not sales or forecasts.</p></div>
      <button type="button" onClick={() => setRevision(n => n + 1)} disabled={loading} className="spr-btn shrink-0">Refresh</button>
    </div>
    {loading && <p className="mt-5 text-sm text-[var(--spr-text-muted)]">Checking current evidence…</p>}
    {error && <p role="alert" className="mt-5 text-sm text-[var(--spr-red)]">{error}</p>}
    {!loading && result && <>
      <p className="mt-4 text-xs text-[var(--spr-text-muted)]">{result.opportunities.length} review candidate{result.opportunities.length === 1 ? '' : 's'} in this bounded view · Estimated value: unknown{result.incomplete ? ' · More records may exist' : ''}</p>
      {result.opportunities.length === 0 && <p className="mt-4 text-sm text-[var(--spr-text-muted)]">No qualifying candidate found in this view. This does not mean every client has been assessed.</p>}
      <div className="mt-4 grid gap-3 md:grid-cols-2">{result.opportunities.map(item => <article key={item.id} className="rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface)] p-4">
        <div className="text-[11px] font-semibold uppercase text-[var(--spr-amber)]">{item.severity} · review needed</div>
        <h3 className="mt-1 text-sm font-semibold text-[var(--spr-text)]">{item.title}</h3>
        <p className="mt-2 text-xs text-[var(--spr-text-muted)]">{item.suggestedService}</p>
        <p className="mt-2 text-[11px] text-[var(--spr-text-faint)]">Finding {item.findingId} · {item.evidenceIds.length} linked evidence record{item.evidenceIds.length === 1 ? '' : 's'} · observed {new Date(item.observedAt).toLocaleDateString()}</p>
        <div className="mt-3 flex gap-3 text-xs font-semibold text-[var(--spr-highlight)]">
          {item.clientId && <button type="button" onClick={() => onOpenClient(item.clientId!)}>Open client</button>}
          <button type="button" onClick={() => onOpenPassport(item.passportId)}>Open passport</button>
        </div>
        <p className="mt-3 text-[11px] text-[var(--spr-text-muted)]">Latest review: {reviews.find(review => review.findingId === item.findingId)?.action.replaceAll('_', ' ').toLowerCase() ?? 'not reviewed'}</p>
        <div className="mt-2 flex gap-3 text-xs font-semibold text-[var(--spr-highlight)]">
          <button type="button" disabled={saving === item.findingId} onClick={() => void decide(item, 'ACCEPTED_FOR_REVIEW')}>Accept for review</button>
          <button type="button" disabled={saving === item.findingId} onClick={() => void decide(item, 'DISMISSED')}>Dismiss</button>
        </div>
      </article>)}</div>
      <p className="mt-4 text-[11px] text-[var(--spr-text-faint)]">An MSP member must inspect the finding and evidence before proposing work. SPR does not send a quote or message from this panel.</p>
    </>}
  </section>;
}
