import { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged } from '../lib/supabase-auth';
import { auth } from '../lib/supabase-auth';
import { apiFetch } from '../utils/apiClient';

type AgentResult = { status?: string; trustDecision?: { status?: string; reason?: string }; evidence?: { count?: number; latestObservationAt?: string | null; latestHash?: string | null }; findings?: { open?: number; criticalOrHigh?: number }; sources?: Array<{ evidenceId?: string; provider?: string | null; sourceUrl?: string | null; observedAt?: string | null; verificationMethod?: string | null; evidenceHash?: string | null; limitation?: string | null }>; provenance?: { tenantScoped?: boolean; findingRecords?: { findingIds?: string[] }; evidenceRecords?: { evidenceIds?: string[] }; observationRecords?: { observationIds?: string[] } } };
type CommandResponse = { reply?: string; path?: string; stuck?: boolean; nextMove?: { label: string; command?: string; path?: string; reason?: string }; proposedAction?: { id: string; type: string; endpoint: string; method: 'POST' | 'PATCH'; requiresConfirmation: true; description: string; payload: Record<string, unknown>; evidence?: Record<string, unknown> }; action?: { type?: string; endpoint?: string; payload?: Record<string, unknown> }; data?: { counts?: Record<string, number>; topPassports?: Array<{ passport_id: string; name: string; open_findings: number; critical_high: number; finding_ids?: string[] }>; portfolioCommercial?: { generatedAt?: string; opportunityCount?: number; opportunities?: Array<{ passportId: string; passportName: string; clientId?: string | null; clientName?: string | null; kind: string; priority: number; reason: string; nextActionLabel: string; command: string }>; policy?: string }; commercial?: { generatedAt?: string; discovery?: { state?: string; stateReason?: string; runningNow?: number; last24h?: Record<string, number>; lastCompletedAt?: string | null }; qualification?: { state?: string; stateReason?: string; runningNow?: number; last24h?: Record<string, number>; lastCompletedAt?: string | null }; outreach?: { state?: string; stateReason?: string; runningNow?: number; last24h?: Record<string, number>; lastCompletedAt?: string | null } }; customerManagement?: { generatedAt?: string; activeProspects?: number; dueFollowups?: number; replied?: number; demos?: number; pilots?: number; priorities?: Array<{ contactId: string; company?: string | null; pipelineStage: string; priority: number; reason: string; action: string; lastContactedAt?: string | null; nextFollowupAt?: string | null; followupCount?: number; commands?: Array<{ label: string; command?: string; path?: string }> }>; policy?: string } }; provenance?: { generatedAt?: string; tenantScoped?: boolean; sources?: Array<{ table: string; fields: string[]; observation: string; filter: string }> }; actions?: Array<{ label: string; command?: string; path?: string }> };
type Message = { role: 'user' | 'agent'; text: string; result?: AgentResult; data?: CommandResponse['data']; provenance?: CommandResponse['provenance']; actions?: CommandResponse['actions']; nextMove?: CommandResponse['nextMove']; proposedAction?: CommandResponse['proposedAction']; stuck?: boolean };

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
};

const QUICK_ACTIONS = [
  { label: 'What can you do?', value: 'What can you do?' },
  { label: 'My biggest risk', value: 'What is my biggest risk today?' },
  { label: 'Show clients', value: 'Show clients' },
  { label: 'Show passports', value: 'Show passports' },
  { label: 'Vendor risk', value: 'Show vendor risk' },
];

const SAFE_NAV_PATHS = new Set(['/dashboard', '/clients', '/passports', '/vendors', '/monitoring', '/compliance', '/reports', '/billing', '/settings', '/founder']);
const SAFE_ACTION_ENDPOINTS = new Set(['/api/agent/v1/verify-software']);
const SAFE_CONFIRMED_ACTION_ENDPOINTS = new Set(['/api/scans', '/api/report-schedules', '/api/founder/distribution/discovery/run', '/api/founder/distribution/qualify-lead']);
function isConfirmedActionEndpoint(endpoint: string) {
  return SAFE_CONFIRMED_ACTION_ENDPOINTS.has(endpoint)
    || /^\/api\/monitoring\/monitoring-configurations\/[A-Za-z0-9._:-]{1,200}\/run$/.test(endpoint)
    || /^\/api\/founder\/distribution\/contacts\/[A-Za-z0-9._:-]{1,128}\/stage$/.test(endpoint);
}

// Returns whether navigation actually happened. A path outside the fixed
// allowlist is refused here regardless of what the server (or anything that
// tampered with a response) sent; the caller tells the user rather than
// silently closing the dialog.
function navigate(path: string): boolean {
  if (!SAFE_NAV_PATHS.has(path)) return false;
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
  return true;
}
const REFUSED_PATH_MESSAGE = 'That destination is not on the agent’s approved navigation list, so I did not open it.';

export default function ExperienceAgent() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [signedIn, setSignedIn] = useState(Boolean(auth.currentUser));
  const [handsFree, setHandsFree] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const handsFreeRef = useRef(false);
  const [messages, setMessages] = useState<Message[]>([{ role: 'agent', text: 'I’m your SPR Agent. Talk to me normally. I’ll answer, notice when you’re stuck, and keep giving you the clearest next move. When I talk about your workspace, I only use information I can actually retrieve from your authorized SPR tenant.' }]);
  const inputRef = useRef<HTMLInputElement>(null);
  const canSubmit = useMemo(() => Boolean(input.trim()) && !busy && signedIn, [input, busy, signedIn]);

  useEffect(() => onAuthStateChanged(auth, (user) => setSignedIn(Boolean(user))), []);

  useEffect(() => {
    handsFreeRef.current = handsFree;
  }, [handsFree]);

  useEffect(() => {
    const w = window as typeof window & {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Recognition = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.lang = navigator.language || 'en-CA';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onstart = () => { setListening(true); setVoiceError(''); };
    recognition.onend = () => setListening(false);
    recognition.onerror = (event) => {
      setListening(false);
      const error = event?.error || 'voice input failed';
      if (error !== 'aborted' && error !== 'no-speech') setVoiceError(`Voice input: ${error}`);
    };
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim();
      if (transcript) void submit(transcript);
    };
    recognitionRef.current = recognition;
    return () => {
      recognition.abort();
      recognitionRef.current = null;
      window.speechSynthesis?.cancel();
    };
  }, []);

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

  function listen() {
    if (!recognitionRef.current || busy) return;
    window.speechSynthesis?.cancel();
    try { recognitionRef.current.start(); } catch { /* browser may already be listening */ }
  }

  function speak(text: string) {
    if (!handsFreeRef.current || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = navigator.language || 'en-CA';
    utterance.rate = 1;
    utterance.onend = () => {
      if (handsFreeRef.current) window.setTimeout(() => listen(), 250);
    };
    window.speechSynthesis.speak(utterance);
  }

  async function executeProposedAction(action: NonNullable<CommandResponse['proposedAction']>) {
    if (busy || !auth.currentUser) return;
    if (!action.requiresConfirmation || !['POST', 'PATCH'].includes(action.method) || !isConfirmedActionEndpoint(action.endpoint)) {
      setMessages((current) => [...current, { role: 'agent', text: 'That proposed action is not on the agent’s approved confirmed-action allowlist. Nothing was executed.' }]);
      return;
    }
    setBusy(true);
    let confirmationReceiptId: string | null = null;
    try {
      const confirmationResponse = await apiFetch('/api/agent/v1/receipts/confirmation', {
        method: 'POST',
        body: JSON.stringify({ action }),
        timeout: 30_000,
      });
      const confirmationPayload = await confirmationResponse.json().catch(() => ({})) as Record<string, unknown>;
      if (!confirmationResponse.ok || typeof confirmationPayload.receiptId !== 'string') {
        throw new Error('SPR could not persist the confirmation receipt, so the production action was not executed.');
      }
      confirmationReceiptId = confirmationPayload.receiptId;

      const response = await apiFetch(action.endpoint, { method: action.method, body: JSON.stringify(action.payload), timeout: 30_000 });
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      const ok = response.ok;
      const outcomeResponse = await apiFetch('/api/agent/v1/receipts/outcome', {
        method: 'POST',
        body: JSON.stringify({
          parentReceiptId: confirmationReceiptId,
          action,
          ok,
          httpStatus: response.status,
          result: payload,
          ...(ok ? {} : { error: typeof payload.error === 'string' ? payload.error : 'Authorized route rejected the action.' }),
        }),
        timeout: 30_000,
      });
      const outcomePayload = await outcomeResponse.json().catch(() => ({})) as Record<string, unknown>;
      if (!ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'The confirmed action was rejected by SPR.');

      const receiptBits = [
        typeof payload.id === 'string' ? `id ${payload.id}` : null,
        typeof payload.jobId === 'string' ? `job ${payload.jobId}` : null,
        typeof payload.status === 'string' ? `status ${payload.status}` : null,
        typeof payload.state === 'string' ? `state ${payload.state}` : null,
        typeof payload.cadence === 'string' ? `cadence ${payload.cadence}` : null,
        typeof payload.nextRunAt === 'string' ? `next ${payload.nextRunAt}` : null,
        typeof outcomePayload.receiptId === 'string' ? `audit ${outcomePayload.receiptId}` : null,
      ].filter(Boolean).join(' · ');

      const auditWarning = outcomeResponse.ok ? '' : ' The action succeeded, but SPR could not persist its outcome receipt; treat audit state as incomplete until repaired.';
      setMessages((current) => [...current, {
        role: 'agent',
        text: `Confirmed action executed through SPR’s existing authorized route.${receiptBits ? ` Receipt: ${receiptBits}.` : ''}${auditWarning} NEXT MOVE: verify the resulting job, schedule, or report state before making any downstream claim.`,
        actions: [{ label: 'Open Passports', path: '/passports' }],
      }]);
    } catch (error) {
      const errorText = error instanceof Error ? error.message : 'The confirmed action failed. No success claim was made.';
      setMessages((current) => [...current, { role: 'agent', text: errorText }]);
    } finally {
      setBusy(false);
    }
  }

  async function submit(raw?: string) {
    const text = (raw ?? input).trim();
    if (!text || busy || !auth.currentUser) return;
    setInput(''); setMessages((current) => [...current, { role: 'user', text }]); setBusy(true);
    try {
      const history = messages.slice(-12).map(({ role, text: messageText }) => ({ role, text: messageText }));
      const response = await apiFetch('/api/agent/v1/command', { method: 'POST', body: JSON.stringify({ input: text, context: { path: window.location.pathname, history } }), timeout: 30_000 });
      const payload = await response.json().catch(() => ({})) as CommandResponse;
      if (!response.ok) throw new Error(typeof payload.reply === 'string' ? payload.reply : 'SPR Agent could not complete the request.');
      const replyText = payload.reply || 'The request completed without a factual response.';
      setMessages((current) => [...current, { role: 'agent', text: replyText, data: payload.data, provenance: payload.provenance, actions: payload.actions, nextMove: payload.nextMove, proposedAction: payload.proposedAction, stuck: payload.stuck }]);
      speak(replyText);
      if (payload.path) {
        if (navigate(payload.path)) { setOpen(false); return; }
        setMessages((current) => [...current, { role: 'agent', text: REFUSED_PATH_MESSAGE }]);
        return;
      }
      if (payload.action?.type === 'verify' && payload.action.endpoint && SAFE_ACTION_ENDPOINTS.has(payload.action.endpoint) && payload.action.payload) {
        const verify = await apiFetch(payload.action.endpoint, { method: 'POST', body: JSON.stringify(payload.action.payload), timeout: 30_000 });
        const result = await verify.json().catch(() => ({})) as AgentResult;
        const textResult = verify.status === 404 ? 'That software is UNKNOWN because no matching passport record was observed in your authorized workspace. No negative trust claim was made.' : verify.ok ? `I observed ${result.evidence?.count ?? 0} evidence record(s). I am not assigning a separate trust decision.` : 'Verification could not be completed. No factual claim was made.';
        setMessages((current) => [...current, { role: 'agent', text: textResult, result }]);
      } else if (payload.action?.type) {
        setMessages((current) => [...current, { role: 'agent', text: 'The requested action was not in the agent’s approved action allowlist. No action was executed and no factual claim was made.' }]);
      }
    } catch (error) {
      console.error('[SPR Agent] command failed', error);
      const errorText = error instanceof Error ? error.message : 'The agent service could not be reached. No factual claim was made.';
      setMessages((current) => [...current, { role: 'agent', text: errorText }]);
      speak(errorText);
    } finally { setBusy(false); }
  }

  return (
    <>
      <button type="button" aria-label="Open SPR Agent" onClick={() => { setOpen(true); window.setTimeout(() => inputRef.current?.focus(), 0); }} className="fixed bottom-5 right-5 z-[80] rounded-full border border-[var(--spr-border)] bg-[var(--spr-surface)] px-5 py-3 text-sm font-semibold text-[var(--spr-text)] shadow-2xl transition hover:-translate-y-0.5">SPR Agent <span className="ml-2 text-xs text-[var(--spr-text-faint)]">Ctrl K</span></button>
      {open && <div className="fixed inset-0 z-[90] bg-black/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
        <section role="dialog" aria-modal="true" aria-label="SPR Agent" className="mx-auto mt-[8vh] flex max-h-[78vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface)] shadow-2xl">
          <header className="flex items-center justify-between border-b border-[var(--spr-border)] px-5 py-4"><div><div className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--spr-text-faint)]">SPR</div><h2 className="text-lg font-semibold text-[var(--spr-text)]">Agent</h2></div><button type="button" onClick={() => setOpen(false)} className="spr-btn spr-btn-secondary">Close</button></header>
          <div className="flex-1 space-y-3 overflow-y-auto p-5">
            {messages.map((message, index) => <div key={`${message.role}-${index}`} className={message.role === 'user' ? 'ml-10 rounded-xl border border-[var(--spr-border)] p-3 text-sm text-[var(--spr-text)]' : 'mr-10 rounded-xl bg-[var(--spr-surface-deep)] p-3 text-sm text-[var(--spr-text)]'}><div>{message.text}</div>{message.result && <div className="mt-3 space-y-2 text-xs text-[var(--spr-text-muted)]"><div className="grid gap-2 sm:grid-cols-3"><div><b>Observed:</b> {message.result.status || 'UNKNOWN'}</div><div><b>Findings:</b> {message.result.findings?.open ?? '—'} open / {message.result.findings?.criticalOrHigh ?? '—'} critical-high</div><div><b>Evidence:</b> {message.result.evidence?.count ?? '—'}</div></div><details><summary className="cursor-pointer font-semibold">Proof / provenance</summary><div className="mt-2 space-y-1"><div>Tenant scoped: {message.result.provenance?.tenantScoped ? 'yes' : 'not reported'}</div><div>Finding IDs observed: {message.result.provenance?.findingRecords?.findingIds?.join(', ') || 'none'}</div><div>Evidence IDs observed: {message.result.provenance?.evidenceRecords?.evidenceIds?.join(', ') || 'none'}</div><div>Observation IDs observed: {message.result.provenance?.observationRecords?.observationIds?.join(', ') || 'none'}</div>{message.result.sources?.slice(0,10).map((source) => <div key={source.evidenceId || `${source.provider}-${source.observedAt}`} className="rounded border border-[var(--spr-border)] p-2"><div><b>{source.evidenceId || 'Evidence record'}</b> · {source.provider || 'provider not recorded'} · observed {source.observedAt || 'time not recorded'}</div><div>Method: {source.verificationMethod || 'not recorded'}</div><div>Hash: {source.evidenceHash || 'not recorded'}</div><div>{source.sourceUrl ? <a href={source.sourceUrl} target="_blank" rel="noreferrer" className="underline">Open observed source</a> : 'No source URL recorded'}</div>{source.limitation ? <div>Limitation: {source.limitation}</div> : null}</div>)}</div></details></div>}{message.data?.counts && <div className="mt-3 grid gap-2 text-xs text-[var(--spr-text-muted)] sm:grid-cols-2"><div>Clients: <b>{message.data.counts.clients ?? 0}</b></div><div>Passports: <b>{message.data.counts.passports ?? 0}</b></div><div>Open findings: <b>{message.data.counts.openFindings ?? 0}</b></div><div>Critical/high: <b>{message.data.counts.criticalHighFindings ?? 0}</b></div></div>}{message.data?.portfolioCommercial?.opportunities?.length ? <div className="mt-3 rounded-xl border border-[var(--spr-border)] p-3 text-xs text-[var(--spr-text-muted)]"><div className="font-semibold text-[var(--spr-text)]">Income opportunities</div><div className="mt-2 space-y-2">{message.data.portfolioCommercial.opportunities.slice(0,5).map((item) => <div key={`${item.passportId}-${item.kind}`} className="rounded border border-[var(--spr-border)] p-2"><div className="font-medium text-[var(--spr-text)]">{item.clientName ? `${item.clientName} · ` : ''}{item.passportName} · {item.kind.replaceAll('_',' ').toLowerCase()}</div><div className="mt-1">{item.reason}</div><button type="button" disabled={busy} onClick={() => void submit(item.command)} className="mt-2 rounded-full border border-[var(--spr-border)] px-3 py-1.5 font-medium text-[var(--spr-text)]">Inspect opportunity</button></div>)}</div><div className="mt-2 text-[11px] text-[var(--spr-text-faint)]">{message.data.portfolioCommercial.policy}</div></div> : null}{message.data?.customerManagement ? <div className="mt-3 rounded-xl border border-[var(--spr-border)] p-3 text-xs text-[var(--spr-text-muted)]"><div className="font-semibold text-[var(--spr-text)]">Customer-management priority queue</div><div className="mt-2 grid gap-2 sm:grid-cols-4"><div>Active: <b>{message.data.customerManagement.activeProspects ?? 0}</b></div><div>Follow-ups due: <b>{message.data.customerManagement.dueFollowups ?? 0}</b></div><div>Replies: <b>{message.data.customerManagement.replied ?? 0}</b></div><div>Demos / pilots: <b>{(message.data.customerManagement.demos ?? 0) + (message.data.customerManagement.pilots ?? 0)}</b></div></div>{message.data.customerManagement.priorities?.length ? <div className="mt-2 space-y-2">{message.data.customerManagement.priorities.slice(0,5).map((item) => <div key={item.contactId} className="rounded border border-[var(--spr-border)] p-2"><div className="font-medium text-[var(--spr-text)]">{item.company || item.contactId} · {item.pipelineStage}</div><div className="mt-1">{item.reason}</div>{item.nextFollowupAt ? <div className="mt-1 text-[11px] text-[var(--spr-text-faint)]">Next follow-up: {item.nextFollowupAt}</div> : null}{item.commands?.length ? <div className="mt-2 flex flex-wrap gap-2">{item.commands.map((command) => <button key={`${item.contactId}-${command.label}`} type="button" disabled={busy} onClick={() => command.command ? void submit(command.command) : command.path ? (navigate(command.path) ? setOpen(false) : setMessages((current) => [...current, { role: 'agent', text: REFUSED_PATH_MESSAGE }])) : undefined} className="rounded-full border border-[var(--spr-border)] px-3 py-1.5 text-xs font-medium text-[var(--spr-text)]">{command.label}</button>)}</div> : null}</div>)}</div> : null}<div className="mt-2 text-[11px] text-[var(--spr-text-faint)]">{message.data.customerManagement.policy}</div></div> : null}{message.data?.commercial ? <div className="mt-3 rounded-xl border border-[var(--spr-border)] p-3 text-xs text-[var(--spr-text-muted)]"><div className="font-semibold text-[var(--spr-text)]">MSP acquisition engine</div><div className="mt-2 grid gap-2 sm:grid-cols-3">{(['discovery','qualification','outreach'] as const).map((key) => { const item = message.data?.commercial?.[key]; if (!item) return null; const activity = Object.values(item.last24h || {}).reduce((sum, value) => sum + Number(value || 0), 0); return <div key={key} className="rounded border border-[var(--spr-border)] p-2"><div className="font-medium capitalize text-[var(--spr-text)]">{key}</div><div>{item.state || 'unknown'} · {activity} job(s) touched in 24h</div><div className="mt-1">{item.stateReason || 'No state reason reported.'}</div></div>; })}</div></div> : null}{message.data?.topPassports?.length ? <div className="mt-3 text-xs text-[var(--spr-text-muted)]"><b>Highest observed passport finding counts:</b><ul className="mt-1 list-disc pl-4">{message.data.topPassports.slice(0,5).map((item) => <li key={item.passport_id}>{item.name}: {item.critical_high} critical/high, {item.open_findings} open · IDs: {item.finding_ids?.join(', ') || 'none'}</li>)}</ul></div> : null}{message.provenance && <details className="mt-3 text-xs text-[var(--spr-text-muted)]"><summary className="cursor-pointer font-semibold">Summary proof</summary><div className="mt-2">Generated: {message.provenance.generatedAt || 'not reported'} · Tenant scoped: {message.provenance.tenantScoped ? 'yes' : 'not reported'}</div>{message.provenance.sources?.map((source) => <div key={source.table} className="mt-1 rounded border border-[var(--spr-border)] p-2"><b>{source.table}</b> · {source.observation} · fields: {source.fields.join(', ')} · {source.filter}</div>)}</details>}{message.proposedAction ? <div className="mt-3 rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface)] p-3 text-xs"><div className="font-semibold text-[var(--spr-text)]">Proposed action</div><div className="mt-1 text-[var(--spr-text-muted)]">{message.proposedAction.description}</div><div className="mt-1 text-[11px] text-[var(--spr-text-faint)]">Not executed yet · explicit confirmation required</div><button type="button" disabled={busy} onClick={() => void executeProposedAction(message.proposedAction!)} className="mt-2 rounded-full border border-[var(--spr-border)] px-3 py-1.5 font-medium text-[var(--spr-text)]">Confirm and run</button></div> : null}{message.nextMove ? <div className="mt-3 rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface)] p-3 text-xs"><div className="font-semibold text-[var(--spr-text)]">{message.stuck ? 'You look stuck — next move' : 'Next move'}</div><div className="mt-1 text-[var(--spr-text-muted)]">{message.nextMove.label}{message.nextMove.reason ? ` — ${message.nextMove.reason}` : ''}</div>{(message.nextMove.path || message.nextMove.command) ? <button type="button" disabled={busy} onClick={() => message.nextMove?.path ? (navigate(message.nextMove.path) ? setOpen(false) : setMessages((current) => [...current, { role: 'agent', text: REFUSED_PATH_MESSAGE }])) : message.nextMove?.command ? void submit(message.nextMove.command) : undefined} className="mt-2 rounded-full border border-[var(--spr-border)] px-3 py-1.5 font-medium text-[var(--spr-text)]">Do this next</button> : null}</div> : null}{message.actions?.length ? <div className="mt-3 flex flex-wrap gap-2">{message.actions.map((action) => <button key={`${action.label}-${action.path || action.command || ''}`} type="button" disabled={busy} onClick={() => action.path ? (navigate(action.path) ? setOpen(false) : setMessages((current) => [...current, { role: 'agent', text: REFUSED_PATH_MESSAGE }])) : action.command ? void submit(action.command) : undefined} className="rounded-full border border-[var(--spr-border)] px-3 py-1.5 text-xs font-medium text-[var(--spr-text-muted)] hover:text-[var(--spr-text)]">{action.label}</button>)}</div> : null}</div>)}
            {busy && <div className="mr-10 rounded-xl bg-[var(--spr-surface-deep)] p-3 text-sm text-[var(--spr-text-muted)]">Working from observed SPR data…</div>}
          </div>
          <div className="border-t border-[var(--spr-border)] p-4"><div className="mb-3 flex flex-wrap items-center gap-2"><button type="button" onClick={() => { const next = !handsFree; setHandsFree(next); handsFreeRef.current = next; if (next) window.setTimeout(() => listen(), 50); else { recognitionRef.current?.abort(); window.speechSynthesis?.cancel(); } }} className={`rounded-full border px-3 py-1.5 text-xs font-medium ${handsFree ? 'border-[var(--spr-accent)] text-[var(--spr-text)]' : 'border-[var(--spr-border)] text-[var(--spr-text-muted)]'}`}>{handsFree ? 'Hands-free on' : 'Hands-free'}</button><button type="button" disabled={busy || listening || !recognitionRef.current} onClick={listen} className="rounded-full border border-[var(--spr-border)] px-3 py-1.5 text-xs text-[var(--spr-text-muted)]">{listening ? 'Listening…' : 'Speak'}</button>{voiceError ? <span className="text-xs text-[var(--spr-text-faint)]">{voiceError}</span> : null}</div><div className="mb-3 flex flex-wrap gap-2">{QUICK_ACTIONS.map((action) => <button key={action.value} type="button" disabled={busy} onClick={() => void submit(action.value)} className="rounded-full border border-[var(--spr-border)] px-3 py-1.5 text-xs text-[var(--spr-text-muted)] hover:text-[var(--spr-text)]">{action.label}</button>)}</div><form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="flex gap-2"><input ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} placeholder="Tell SPR what you need…" aria-label="Ask SPR Agent" className="min-w-0 flex-1 rounded-xl border border-[var(--spr-border)] bg-transparent px-4 py-3 text-sm text-[var(--spr-text)] outline-none" maxLength={500} disabled={busy} /><button type="submit" disabled={!canSubmit} className="spr-btn spr-btn-primary">{busy ? 'Working…' : 'Send'}</button></form><p className="mt-2 text-[11px] text-[var(--spr-text-faint)]">Talk normally. The agent can explain, guide, detect when you’re stuck, and keep surfacing the next move. Hard rule: no evidence, no tenant-specific claim.</p></div>
        </section>
      </div>}
    </>
  );
}
