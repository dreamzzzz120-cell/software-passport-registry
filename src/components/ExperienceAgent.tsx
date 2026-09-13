import { useEffect, useMemo, useRef, useState } from 'react';
import { auth } from '../lib/firebase';
import { apiFetch } from '../utils/apiClient';

type AgentResult = {
  status?: string;
  reason?: string;
  evidence?: { count?: number; completeness?: number | null; latestObservationAt?: string | null };
  findings?: { total?: number; open?: number; criticalOrHigh?: number };
  policy?: { rule?: string };
};

type Message = { role: 'user' | 'agent'; text: string; result?: AgentResult };

const QUICK_ACTIONS = [
  ['What can you do?', 'What can you do?'],
  ['Open Command Center', 'Open Command Center'],
  ['Show clients', 'Show clients'],
  ['Show passports', 'Show passports'],
  ['Show vendor risk', 'Show vendor risk'],
] as const;

function navigate(path: string) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function localIntent(input: string): { path?: string; reply?: string } {
  const q = input.trim().toLowerCase();
  if (/what can you do|help|how do you work/.test(q)) return { reply: 'I am the SPR front door. I can take you to the right workspace and run evidence-backed passport verification. I do not invent evidence or change trust decisions.' };
  if (/command center|dashboard|home/.test(q)) return { path: '/dashboard', reply: 'Opening the Command Center.' };
  if (/client/.test(q)) return { path: '/clients', reply: 'Opening Clients.' };
  if (/passport|registry|software/.test(q)) return { path: '/passports', reply: 'Opening Passports.' };
  if (/vendor|third.?party risk/.test(q)) return { path: '/vendors', reply: 'Opening Vendor Risk.' };
  if (/monitor|alert/.test(q)) return { path: '/monitoring', reply: 'Opening Monitoring.' };
  if (/compliance|governance/.test(q)) return { path: '/compliance', reply: 'Opening Compliance.' };
  if (/report/.test(q)) return { path: '/reports', reply: 'Opening Reports.' };
  if (/billing|subscription|plan/.test(q)) return { path: '/billing', reply: 'Opening Billing.' };
  if (/setting/.test(q)) return { path: '/settings', reply: 'Opening Settings.' };
  return {};
}

export default function ExperienceAgent() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([{ role: 'agent', text: 'I’m your SPR Agent. Tell me what you need, or ask me to verify a passport.' }]);
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
    setInput('');
    setMessages((current) => [...current, { role: 'user', text }]);
    const intent = localIntent(text);
    if (intent.path) {
      setMessages((current) => [...current, { role: 'agent', text: intent.reply || 'Opening the requested workspace.' }]);
      navigate(intent.path); setOpen(false); return;
    }
    if (/what can you do|help|how do you work/i.test(text)) {
      setMessages((current) => [...current, { role: 'agent', text: intent.reply! }]); return;
    }
    const verifyMatch = text.match(/(?:verify|check|assess)\s+(?:passport|software)?\s*[:#]?\s*(.+)$/i);
    if (verifyMatch) {
      setBusy(true);
      try {
        const response = await apiFetch('/api/agent/v1/verify-software', { method: 'POST', body: JSON.stringify({ query: verifyMatch[1].trim() }), timeout: 30_000 });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const message = response.status === 404 ? 'SPR could not find that software in your workspace. That is UNKNOWN, not a negative trust decision.' : payload?.error || 'SPR could not complete the verification request.';
          setMessages((current) => [...current, { role: 'agent', text: message, result: payload }]);
        } else {
          setMessages((current) => [...current, { role: 'agent', text: `Evidence-backed result: ${payload.status || 'UNKNOWN'}.`, result: payload }]);
        }
      } catch (error) {
        console.error('[SPR Agent] verification request failed', error);
        setMessages((current) => [...current, { role: 'agent', text: 'The verification service could not be reached. No trust claim was made.' }]);
      } finally { setBusy(false); }
      return;
    }
    setMessages((current) => [...current, { role: 'agent', text: 'I can navigate the SPR workspace and run evidence-backed passport verification. Try “verify passport: <name>” or use a quick action below.' }]);
  }

  return <>
    <button type="button" aria-label="Open SPR Agent" onClick={() => { setOpen(true); window.setTimeout(() => inputRef.current?.focus(), 0); }} className="fixed bottom-5 right-5 z-[80] rounded-full border border-[var(--spr-border)] bg-[var(--spr-surface)] px-5 py-3 text-sm font-semibold text-[var(--spr-text)] shadow-2xl transition hover:-translate-y-0.5">
      SPR Agent <span className="ml-2 text-xs text-[var(--spr-text-faint)]">Ctrl K</span>
    </button>
    {open && <div className="fixed inset-0 z-[90] bg-black/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-label="SPR Agent" className="mx-auto mt-[8vh] flex max-h-[78vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface)] shadow-2xl">
        <header className="flex items-center justify-between border-b border-[var(--spr-border)] px-5 py-4"><div><div className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--spr-text-faint)]">SPR</div><h2 className="text-lg font-semibold text-[var(--spr-text)]">Agent</h2></div><button type="button" onClick={() => setOpen(false)} className="spr-btn spr-btn-secondary">Close</button></header>
        <div className="flex-1 space-y-3 overflow-y-auto p-5">{messages.map((message, index) => <div key={`${message.role}-${index}`} className={message.role === 'user' ? 'ml-10 rounded-xl border border-[var(--spr-border)] p-3 text-sm text-[var(--spr-text)]' : 'mr-10 rounded-xl bg-[var(--spr-surface-deep)] p-3 text-sm text-[var(--spr-text)]'}><div>{message.text}</div>{message.result && <div className="mt-3 grid gap-2 text-xs text-[var(--spr-text-muted)] sm:grid-cols-3"><div><b>Status:</b> {message.result.status || 'UNKNOWN'}</div><div><b>Findings:</b> {message.result.findings?.open ?? '—'} open / {message.result.findings?.criticalOrHigh ?? '—'} critical-high</div><div><b>Evidence:</b> {message.result.evidence?.count ?? '—'}</div></div>}</div>)}{busy && <div className="mr-10 rounded-xl bg-[var(--spr-surface-deep)] p-3 text-sm text-[var(--spr-text-muted)]">Checking observed evidence…</div>}</div>
        <div className="border-t border-[var(--spr-border)] p-4"><div className="mb-3 flex flex-wrap gap-2">{QUICK_ACTIONS.map(([label, value]) => <button key={value} type="button" disabled={busy} onClick={() => void submit(value)} className="rounded-full border border-[var(--spr-border)] px-3 py-1.5 text-xs text-[var(--spr-text-muted)] hover:text-[var(--spr-text)]">{label}</button>)}</div><form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="flex gap-2"><input ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} placeholder="Tell SPR what you need…" aria-label="Ask SPR Agent" className="min-w-0 flex-1 rounded-xl border border-[var(--spr-border)] bg-transparent px-4 py-3 text-sm text-[var(--spr-text)] outline-none" maxLength={500} disabled={busy} /><button type="submit" disabled={!canSubmit} className="spr-btn spr-btn-primary">{busy ? 'Working…' : 'Send'}</button></form><p className="mt-2 text-[11px] text-[var(--spr-text-faint)]">Trust decisions remain evidence-first and server-authoritative. The agent cannot manufacture evidence or silently change scores.</p></div>
      </section>
    </div>}
  </>;
}
