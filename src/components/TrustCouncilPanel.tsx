/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Evidence reasoning over one passport: the AI explanation, the Trust
 * Council (four specialist reviews + chair) and grounded Q&A. Every answer
 * shown here came back from the server with the evidence ids it cites, and
 * the panel says plainly when the deployment has no AI provider instead of
 * showing buttons that would fail.
 */

import { useCallback, useEffect, useState } from 'react';
import { Gavel, MessageSquare, Sparkles } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

type PassportLite = { id: string; name: string; version?: string };
type AiStatus = { available: boolean; provider: string | null; model: string | null; trustCouncil: boolean; ask: boolean };
type Explanation = { summary: string; keyFindings: Array<{ statement: string; evidenceIds: string[] }>; unknowns: string[]; recommendedNextSteps: string[]; evidenceIds: string[] };
type Seat = { seat: string; title: string; status: 'reviewed' | 'discarded' | 'failed'; reason: string | null; review: null | { verdict: string; rationale: string; concerns: Array<{ statement: string; severity: string; evidenceIds: string[] }>; unknowns: string[]; citedIds: string[] } };
type Council = { verdict: string; chair: null | { verdict: string; summary: string; conditions: string[]; disagreements: string[]; citedIds: string[] }; seats: Seat[]; evidenceCount: number; findingCount: number; citedIds: string[]; policy: string };
type Turn = { role: 'user' | 'assistant'; content: string; citedIds?: string[]; unknowns?: string[] };

const VERDICT_STYLE: Record<string, string> = {
  APPROVE: 'bg-[var(--spr-green)]/15 text-[var(--spr-green)]',
  CONDITIONAL: 'bg-[var(--spr-amber)]/15 text-[var(--spr-amber)]',
  REJECT: 'bg-[var(--spr-red)]/15 text-[var(--spr-red)]',
  INSUFFICIENT_EVIDENCE: 'bg-[var(--spr-surface-sunken)] text-[var(--spr-text-muted)]',
};

export default function TrustCouncilPanel({ passports }: { passports: PassportLite[] }) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [passportId, setPassportId] = useState(passports[0]?.id ?? '');
  const [busy, setBusy] = useState<'explain' | 'council' | 'ask' | null>(null);
  const [error, setError] = useState('');
  const [explanation, setExplanation] = useState<{ explanation: Explanation; provenance: { model: string; modelVersion: string } } | null>(null);
  const [council, setCouncil] = useState<{ council: Council; chairNote: string | null; provenance: { modelVersion: string; generatedAt: string } } | null>(null);
  const [history, setHistory] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');

  useEffect(() => { if (!passportId && passports[0]) setPassportId(passports[0].id); }, [passports, passportId]);
  useEffect(() => {
    apiFetch('/api/ai-trust/ai-status').then(async (r) => { if (r.ok) setStatus(await r.json()); else setStatus({ available: false, provider: null, model: null, trustCouncil: false, ask: false }); }).catch(() => setStatus({ available: false, provider: null, model: null, trustCouncil: false, ask: false }));
  }, []);
  useEffect(() => { setExplanation(null); setCouncil(null); setHistory([]); setError(''); }, [passportId]);

  const call = useCallback(async (kind: 'explain' | 'council' | 'ask', path: string, body: unknown) => {
    setBusy(kind); setError('');
    try {
      const response = await apiFetch(path, { method: 'POST', body: JSON.stringify(body), timeout: 120_000 });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data?.message || data?.error || `HTTP ${response.status}`); return null; }
      return data;
    } catch (err) { setError(err instanceof Error ? err.message : 'Network error.'); return null; }
    finally { setBusy(null); }
  }, []);

  const explain = async () => { const data = await call('explain', '/api/ai-trust/explain-passport', { passportId }); if (data) setExplanation(data); };
  const convene = async () => { const data = await call('council', '/api/ai-trust/trust-council', { passportId }); if (data) setCouncil(data); };
  const ask = async () => {
    const q = question.trim(); if (!q) return;
    const priorTurns = history.map((t) => ({ role: t.role, content: t.content })).slice(-8);
    const data = await call('ask', '/api/ai-trust/ask', { passportId, question: q, history: priorTurns });
    if (data) { setHistory((h) => [...h, { role: 'user', content: q }, { role: 'assistant', content: data.answer, citedIds: data.citedIds, unknowns: data.unknowns }]); setQuestion(''); }
  };

  const unavailable = status !== null && !status.available;

  return (
    <section className="spr-panel p-6 space-y-5" aria-labelledby="trust-council-title">
      <div>
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.06em] text-[var(--spr-highlight)]"><Gavel className="h-4 w-4" /> Evidence reasoning &amp; Trust Council</div>
        <h2 id="trust-council-title" className="mt-1 text-xl font-semibold">AI reads the evidence; it never writes it.</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--spr-text-muted)]">Each answer is generated from a read-only snapshot of one passport's evidence and findings, must cite the ids it used, and is rejected if it cites anything else. Nothing here changes a score, finding or trust state.</p>
        <p className="mt-2 text-xs text-[var(--spr-text-faint)]">
          {status === null ? 'Checking AI availability…' : status.available ? `Provider: ${status.provider} (${status.model}).${status.trustCouncil ? '' : ' Trust Council and Q&A need Anthropic Claude; only the explanation is available with the current provider.'}` : 'No AI provider is configured on this deployment (ANTHROPIC_API_KEY is not set), so none of these actions can run. Nothing is simulated in their place.'}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs font-semibold text-[var(--spr-text-muted)]">Passport
          <select value={passportId} onChange={(e) => setPassportId(e.target.value)} className="ml-2 rounded border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2 py-1.5 text-xs text-[var(--spr-text)]">
            {passports.length === 0 && <option value="">No passports in this workspace</option>}
            {passports.map((p) => <option key={p.id} value={p.id}>{p.name}{p.version ? ` v${p.version}` : ''}</option>)}
          </select>
        </label>
        <button disabled={unavailable || !passportId || busy !== null} onClick={explain} className="inline-flex items-center gap-1.5 spr-btn spr-btn-secondary text-xs disabled:opacity-50"><Sparkles className="h-3.5 w-3.5" /> {busy === 'explain' ? 'Explaining…' : 'Explain evidence'}</button>
        <button disabled={unavailable || !status?.trustCouncil || !passportId || busy !== null} onClick={convene} className="inline-flex items-center gap-1.5 spr-btn spr-btn-primary text-xs disabled:opacity-50"><Gavel className="h-3.5 w-3.5" /> {busy === 'council' ? 'Council in session…' : 'Convene Trust Council'}</button>
      </div>
      {error && <p role="alert" className="rounded-md border border-[var(--spr-red)]/30 bg-[var(--spr-red)]/10 px-3 py-2 text-xs text-[var(--spr-red)]">{error}</p>}

      {explanation && (
        <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4 text-sm">
          <div className="text-[11px] uppercase tracking-wide text-[var(--spr-text-faint)]">Explanation · {explanation.provenance.model} · {explanation.provenance.modelVersion} · not authoritative</div>
          <p className="mt-2 leading-6">{explanation.explanation.summary}</p>
          {explanation.explanation.keyFindings.length > 0 && <ul className="mt-3 space-y-1.5">{explanation.explanation.keyFindings.map((f, i) => <li key={i} className="text-xs leading-5">{f.statement} <span className="text-[var(--spr-text-faint)]">[{f.evidenceIds.join(', ')}]</span></li>)}</ul>}
          {explanation.explanation.unknowns.length > 0 && <div className="mt-3 text-xs"><span className="font-semibold text-[var(--spr-amber)]">Unknown from the evidence:</span> {explanation.explanation.unknowns.join(' · ')}</div>}
          {explanation.explanation.recommendedNextSteps.length > 0 && <div className="mt-2 text-xs"><span className="font-semibold">Next steps:</span> {explanation.explanation.recommendedNextSteps.join(' · ')}</div>}
        </div>
      )}

      {council && (
        <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4 text-sm space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-xs font-bold ${VERDICT_STYLE[council.council.verdict] ?? ''}`}>{council.council.verdict.replace('_', ' ')}</span>
            <span className="text-[11px] text-[var(--spr-text-faint)]">Trust Council · {council.provenance.modelVersion} · {new Date(council.provenance.generatedAt).toLocaleString()} · {council.council.evidenceCount} evidence, {council.council.findingCount} findings in snapshot · not authoritative</span>
          </div>
          {council.council.chair ? (
            <div>
              <p className="leading-6">{council.council.chair.summary}</p>
              {council.council.chair.conditions.length > 0 && <div className="mt-2 text-xs"><span className="font-semibold">Conditions:</span><ul className="mt-1 list-disc pl-5">{council.council.chair.conditions.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
              {council.council.chair.disagreements.length > 0 && <div className="mt-2 text-xs"><span className="font-semibold text-[var(--spr-amber)]">Disagreements:</span><ul className="mt-1 list-disc pl-5">{council.council.chair.disagreements.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
            </div>
          ) : <p className="text-xs text-[var(--spr-amber)]">No chair synthesis was accepted; the verdict shown is the reviewers' floor.</p>}
          {council.chairNote && <p className="text-xs text-[var(--spr-amber)]">{council.chairNote}</p>}
          <div className="grid gap-3 md:grid-cols-2">
            {council.council.seats.map((s) => (
              <div key={s.seat} className="rounded border border-[var(--spr-border)] bg-[var(--spr-surface)] p-3 text-xs">
                <div className="flex items-center justify-between gap-2"><span className="font-semibold">{s.title}</span>{s.review ? <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${VERDICT_STYLE[s.review.verdict] ?? ''}`}>{s.review.verdict.replace('_', ' ')}</span> : <span className="text-[11px] text-[var(--spr-red)]">{s.status}</span>}</div>
                {s.review ? (
                  <>
                    <p className="mt-1.5 leading-5">{s.review.rationale}</p>
                    {s.review.concerns.length > 0 && <ul className="mt-1.5 space-y-1">{s.review.concerns.map((c, i) => <li key={i}><span className="font-semibold uppercase text-[10px] text-[var(--spr-text-faint)]">{c.severity}</span> {c.statement} <span className="text-[var(--spr-text-faint)]">[{c.evidenceIds.join(', ')}]</span></li>)}</ul>}
                    {s.review.unknowns.length > 0 && <p className="mt-1.5 text-[var(--spr-text-muted)]"><span className="font-semibold">Unknown:</span> {s.review.unknowns.join(' · ')}</p>}
                  </>
                ) : <p className="mt-1.5 text-[var(--spr-red)]">{s.reason}</p>}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-[var(--spr-text-faint)]">{council.council.policy}</p>
        </div>
      )}

      <div className="rounded-md border border-[var(--spr-border)] p-4">
        <div className="flex items-center gap-2 text-xs font-semibold"><MessageSquare className="h-3.5 w-3.5 text-[var(--spr-highlight)]" /> Ask about this passport</div>
        <div className="mt-3 space-y-2">
          {history.map((t, i) => (
            <div key={i} className={`rounded px-3 py-2 text-xs leading-5 ${t.role === 'user' ? 'bg-[var(--spr-accent-soft)] text-[var(--spr-text)]' : 'bg-[var(--spr-surface-sunken)] text-[var(--spr-text)]'}`}>
              <span className="mr-1 font-semibold">{t.role === 'user' ? 'You' : 'Assistant'}:</span>{t.content}
              {t.citedIds && t.citedIds.length > 0 && <div className="mt-1 text-[var(--spr-text-faint)]">Cites: {t.citedIds.join(', ')}</div>}
              {t.unknowns && t.unknowns.length > 0 && <div className="mt-1 text-[var(--spr-amber)]">Not established by the evidence: {t.unknowns.join(' · ')}</div>}
            </div>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); void ask(); }} className="mt-3 flex gap-2">
          <input value={question} onChange={(e) => setQuestion(e.target.value)} disabled={unavailable || !status?.ask || !passportId || busy !== null} placeholder="e.g. Which open findings have a fixed version available?" className="flex-1 rounded border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-xs text-[var(--spr-text)] disabled:opacity-50" maxLength={2000} />
          <button type="submit" disabled={unavailable || !status?.ask || !passportId || busy !== null || question.trim().length < 3} className="spr-btn spr-btn-secondary text-xs disabled:opacity-50">{busy === 'ask' ? 'Thinking…' : 'Ask'}</button>
        </form>
      </div>
    </section>
  );
}
