import { useEffect, useMemo, useRef, useState } from 'react';
import { auth } from '../lib/firebase';
import { apiFetch } from '../utils/apiClient';

type AgentResult = { status?: string; trustDecision?: { status?: string; reason?: string }; evidence?: { count?: number; latestObservationAt?: string | null; latestHash?: string | null }; findings?: { open?: number; criticalOrHigh?: number }; sources?: Array<{ evidenceId?: string; provider?: string | null; sourceUrl?: string | null; observedAt?: string | null; verificationMethod?: string | null; evidenceHash?: string | null; limitation?: string | null }>; provenance?: { tenantScoped?: boolean; findingRecords?: { findingIds?: string[] }; evidenceRecords?: { evidenceIds?: string[] }; observationRecords?: { observationIds?: string[] } } };
type CommandResponse = { reply?: string; path?: string; action?: { type?: string; endpoint?: string; payload?: Record<string, unknown> }; data?: { counts?: Record<string, number>; topPassports?: Array<{ passport_id: string; name: string; open_findings: number; critical_high: number; finding_ids?: string[] }> }; provenance?: { generatedAt?: string; tenantScoped?: boolean; sources?: Array<{ table: string; fields: string[]; observation: string; filter: string }> }; actions?: Array<{ label: string; command?: string; path?: string }> };
type Message = { role: 'user' | 'agent'; text: string; result?: AgentResult; data?: CommandResponse['data']; provenance?: CommandResponse['provenance']; actions?: CommandResponse['actions'] };

const QUICK_ACTIONS = [
  { label: 'What can you do?', value: 'What can you do?' },
  { label: 'My biggest risk', value: 'What is my biggest risk today?' },
  { label: 'Show clients', value: 'Show clients' },
  { label: 'Show passports', value: 'Show passports' },
  { label: 'Vendor risk', value: 'Show vendor risk' },
];

function navigate(path: string) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export default function ExperienceAgent() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([{ role: 'agent', text: 'I’m your SPR Agent. I only report information I can retrieve from your authorized SPR workspace. Factual answers include where the information came from.' }]);
  const inputRef = useRef<HTMLInputElement>(null);
  const signedIn = Boolean(auth.currentUser);
  const canSubmit = useMemo(() => Boolean(input.trim()) && !busy && signedIn, [input, busy, signedIn]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); setOpen(true); window.setTimeout(() => inputRef.current?.focus(), 0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!signedIn) return null;

  async function submit(raw?: string) {
    const text = (raw ?? input).trim();
    if (!text || busy) return;
    setInput(''); setMessages((current) => [...current, { role: 'user', text }]); setBusy(true);
    try {
      const response = await apiFetch('/api/agent/v1/command', { method: 'POST', body: JSON.stringify({ input: text, context: { path: window.location.pathname } }), timeout: 30_000 });
      const payload = await response.json().catch(() => ({})) as CommandResponse;
      if (!response.ok) throw new Error(typeof payload.reply === 'string' ? payload.reply : 'SPR Agent could not complete the request.');
      setMessages((current) => [...current, { role: 'agent', text: payload.reply || 'The request completed without a factual response.', data: payload.data, provenance: payload.provenance, actions: payload.actions }]);
      if (payload.path) { navigate(payload.path); setOpen(false); return; }
      if (payload.action?.type === 'verify' && payload.action.endpoint && payload.action.payload) {
        const verify = await apiFetch(payload.action.endpoint, { method: 'POST', body: JSON.stringify(payload.action.payload), timeout: 30_000 });
        const result = await verify.json().catch(() => ({})) as AgentResult;
        const textResult = verify.status === 404 ? 'That software is UNKNOWN because no matching passport record was observed in your authorized workspace. No negative trust claim was made.' : verify.ok ? `I observed ${result.evidence?.count ?? 0} evidence record(s). I am not assigning a separate trust decision.` : 'Verification could not be completed. No factual claim was made.';
        setMessages((current) => [...current, { role: 'agent', text: textResult, result }]);
      }
    } catch (error) {
      console.error('[SPR Agent] command failed', error);
      setMessages((current) => [...current, { role: 'agent', text: error instanceof Error ? error.message : 'The agent service could not be reached. No factual claim was made.' }]);
    } finally { setBusy(false); }
  }

  return (
    <>
      <button type="button" aria-label="Open SPR Agent" onClick={() => { setOpen(true); window.setTimeout(() => inputRef.current?.focus(), 0); }} className="fixed bottom-5 right-5 z-[80] rounded-full border border-[var(--spr-border)] bg-[var(--spr-surface)] px-5 py-3 text-sm font-semibold text-[var(--spr-text)] shadow-2xl transition hover:-translate-y-0.5">SPR Agent <span className="ml-2 text-xs text-[var(--spr-text-faint)]">Ctrl K</span></button>
      {open && <div className="fixed inset-0 z-[90] bg-black/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
        <section role="dialog" aria-modal="true" aria-label="SPR Agent" className="mx-auto mt-[8vh] flex max-h-[78vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface)] shadow-2xl">
          <header className="flex items-center justify-between border-b border-[var(--spr-border)] px-5 py-4"><div><div className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--spr-text-faint)]">SPR</div><h2 className="text-lg font-semibold text-[var(--spr-text)]">Agent</h2></div><button type="button" onClick={() => setOpen(false)} className="spr-btn spr-btn-secondary">Close</button></header>
          <div className="flex-1 space-y-3 overflow-y-auto p-5">
            {messages.map((message, index) => <div key={`${message.role}-${index}`} className={message.role === 'user' ? 'ml-10 rounded-xl border border-[var(--spr-border)] p-3 text-sm text-[var(--spr-text)]' : 'mr-10 rounded-xl bg-[var(--spr-surface-deep)] p-3 text-sm text-[var(--spr-text)]'}><div>{message.text}</div>{message.result && <div className="mt-3 space-y-2 text-xs text-[var(--spr-text-muted)]"><div className="grid gap-2 sm:grid-cols-3"><div><b>Observed:</b> {message.result.status || 'UNKNOWN'}</div><div><b>Findings:</b> {message.result.findings?.open ?? '—'} open / {message.result.findings?.criticalOrHigh ?? '—'} critical-high</div><div><b>Evidence:</b> {message.result.evidence?.count ?? '—'}</div></div><details><summary className="cursor-pointer font-semibold">Proof / provenance</summary><div className="mt-2 space-y-1"><div>Tenant scoped: {message.result.provenance?.tenantScoped ? 'yes' : 'not reported'}</div><div>Finding IDs observed: {message.result.provenance?.findingRecords?.findingIds?.join(', ') || 'none'}</div><div>Evidence IDs observed: {message.result.provenance?.evidenceRecords?.evidenceIds?.join(', ') || 'none'}</div><div>Observation IDs observed: {message.result.provenance?.observationRecords?.observationIds?.join(', ') || 'none'}</div>{message.result.sources?.slice(0,10).map((source) => <div key={source.evidenceId || `${source.provider}-${source.observedAt}`} className="rounded border border-[var(--spr-border)] p-2"><div><b>{source.evidenceId || 'Evidence record'}</b> · {source.provider || 'provider not recorded'} · observed {source.observedAt || 'time not recorded'}</div><div>Method: {source.verificationMethod || 'not recorded'}</div><div>Hash: {source.evidenceHash || 'not recorded'}</div><div>{source.sourceUrl ? <a href={source.sourceUrl} target="_blank" rel="noreferrer" className="underline">Open observed source</a> : 'No source URL recorded'}</div>{source.limitation ? <div>Limitation: {source.limitation}</div> : null}</div>)}</div></details></div>}{message.data?.counts && <div className="mt-3 grid gap-2 text-xs text-[var(--spr-text-muted)] sm:grid-cols-2"><div>Clients: <b>{message.data.counts.clients ?? 0}</b></div><div>Passports: <b>{message.data.counts.passports ?? 0}</b></div><div>Open findings: <b>{message.data.counts.openFindings ?? 0}</b></div><div>Critical/high: <b>{message.data.counts.criticalHighFindings ?? 0}</b></div></div>}{message.data?.topPassports?.length ? <div className="mt-3 text-xs text-[var(--spr-text-muted)]"><b>Highest observed passport finding counts:</b><ul className="mt-1 list-disc pl-4">{message.data.topPassports.slice(0,5).map((item) => <li key={item.passport_id}>{item.name}: {item.critical_high} critical/high, {item.open_findings} open · IDs: {item.finding_ids?.join(', ') || 'none'}</li>)}</ul></div> : null}{message.provenance && <details className="mt-3 text-xs text-[var(--spr-text-muted)]"><summary className="cursor-pointer font-semibold">Summary proof</summary><div className="mt-2">Generated: {message.provenance.generatedAt || 'not reported'} · Tenant scoped: {message.provenance.tenantScoped ? 'yes' : 'not reported'}</div>{message.provenance.sources?.map((source) => <div key={source.table} className="mt-1 rounded border border-[var(--spr-border)] p-2"><b>{source.table}</b> · {source.observation} · fields: {source.fields.join(', ')} · {source.filter}</div>)}</details>}{message.actions?.length ? <div className="mt-3 flex flex-wrap gap-2">{message.actions.map((action) => <button key={`${action.label}-${action.path || action.command || ''}`} type="button" disabled={busy} onClick={() => action.path ? (navigate(action.path), setOpen(false)) : action.command ? void submit(action.command) : undefined} className="rounded-full border border-[var(--spr-border)] px-3 py-1.5 text-xs font-medium text-[var(--spr-text-muted)] hover:text-[var(--spr-text)]">{action.label}</button>)}</div> : null}</div>)}
            {busy && <div className="mr-10 rounded-xl bg-[var(--spr-surface-deep)] p-3 text-sm text-[var(--spr-text-muted)]">Working from observed SPR data…</div>}
          </div>
          <div className="border-t border-[var(--spr-border)] p-4"><div className="mb-3 flex flex-wrap gap-2">{QUICK_ACTIONS.map((action) => <button key={action.value} type="button" disabled={busy} onClick={() => void submit(action.value)} className="rounded-full border border-[var(--spr-border)] px-3 py-1.5 text-xs text-[var(--spr-text-muted)] hover:text-[var(--spr-text)]">{action.label}</button>)}</div><form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="flex gap-2"><input ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} placeholder="Tell SPR what you need…" aria-label="Ask SPR Agent" className="min-w-0 flex-1 rounded-xl border border-[var(--spr-border)] bg-transparent px-4 py-3 text-sm text-[var(--spr-text)] outline-none" maxLength={500} disabled={busy} /><button type="submit" disabled={!canSubmit} className="spr-btn spr-btn-primary">{busy ? 'Working…' : 'Send'}</button></form><p className="mt-2 text-[11px] text-[var(--spr-text-faint)]">Hard rule: no evidence, no claim. Every factual result exposes its source records, timestamps, IDs, and hashes where available.</p></div>
        </section>
      </div>}
    </>
  );
}
