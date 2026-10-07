import { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged } from '../lib/supabase-auth';
import { auth } from '../lib/supabase-auth';
import { apiFetch } from '../utils/apiClient';

type AgentResult = { status?: string; trustDecision?: { status?: string; reason?: string }; evidence?: { count?: number; latestObservationAt?: string | null; latestHash?: string | null }; findings?: { open?: number; criticalOrHigh?: number }; sources?: Array<{ evidenceId?: string; provider?: string | null; sourceUrl?: string | null; observedAt?: string | null; verificationMethod?: string | null; evidenceHash?: string | null; limitation?: string | null }>; provenance?: { tenantScoped?: boolean; findingRecords?: { findingIds?: string[] }; evidenceRecords?: { evidenceIds?: string[] }; observationRecords?: { observationIds?: string[] } } };
type CommandResponse = { reply?: string; path?: string; stuck?: boolean; nextMove?: { label: string; command?: string; path?: string; reason?: string }; proposedAction?: { id: string; type: string; endpoint: string; method: 'POST' | 'PATCH'; requiresConfirmation: true; description: string; payload: Record<string, unknown>; evidence?: Record<string, unknown> }; action?: { type?: string; endpoint?: string; payload?: Record<string, unknown> }; data?: { counts?: Record<string, number>; topPassports?: Array<{ passport_id: string; name: string; open_findings: number; critical_high: number; finding_ids?: string[] }>; portfolioCommercial?: { generatedAt?: string; opportunityCount?: number; configuredValue?: number; opportunities?: Array<{ passportId: string; passportName: string; clientId?: string | null; clientName?: string | null; kind: string; priority: number; value?: number | null; reason: string; nextActionLabel: string; command: string }>; policy?: string }; commercial?: { generatedAt?: string; discovery?: { state?: string; stateReason?: string; runningNow?: number; last24h?: Record<string, number>; lastCompletedAt?: string | null }; qualification?: { state?: string; stateReason?: string; runningNow?: number; last24h?: Record<string, number>; lastCompletedAt?: string | null }; outreach?: { state?: string; stateReason?: string; runningNow?: number; last24h?: Record<string, number>; lastCompletedAt?: string | null } }; customerManagement?: { generatedAt?: string; activeProspects?: number; dueFollowups?: number; replied?: number; demos?: number; pilots?: number; priorities?: Array<{ contactId: string; company?: string | null; pipelineStage: string; priority: number; reason: string; action: string; lastContactedAt?: string | null; nextFollowupAt?: string | null; followupCount?: number; commands?: Array<{ label: string; command?: string; path?: string }> }>; policy?: string } }; provenance?: { generatedAt?: string; tenantScoped?: boolean; sources?: Array<{ table: string; fields: string[]; observation: string; filter: string }> }; actions?: Array<{ label: string; command?: string; path?: string }> };
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

const STARTER_MESSAGE: Message = { role: 'agent', text: 'SPR Intelligence is online. Ask about risk, evidence, clients, monitoring, reports, or the next best action. Workspace claims stay evidence-backed and tenant-scoped; anything unobserved remains UNKNOWN.' };

const OPERATING_MODES = [
  { label: 'Investigate', command: 'Investigate my workspace and prioritize the most important observed risk' },
  { label: 'Client brief', command: 'Give me a client-ready brief using only observed evidence' },
  { label: 'Revenue', command: 'Show me the highest priority observed income opportunities and configured service value' },
  { label: 'Operations', command: 'Show monitoring, scans, and operational items that need attention' },
  { label: 'White label', command: 'Show my white-label setup status and take me through anything incomplete' },
] as const;

const QUICK_ACTIONS = [
  { label: 'Risk brief', value: 'What is my biggest risk today?' },
  { label: 'Evidence status', value: 'Show me the evidence status of my workspace' },
  { label: 'Client priorities', value: 'Show clients and tell me which needs attention first' },
  { label: 'Passport health', value: 'Show passports and the highest observed finding counts' },
  { label: 'Monitoring', value: 'Show monitoring status and what needs attention' },
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
  const launcherRef = useRef<HTMLButtonElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);
  const [messages, setMessages] = useState<Message[]>([STARTER_MESSAGE]);
  const [lastCommand, setLastCommand] = useState('');
  const [copied, setCopied] = useState(false);
  const [activeMode, setActiveMode] = useState<string>('Investigate');
  const inputRef = useRef<HTMLInputElement>(null);
  const canSubmit = useMemo(() => Boolean(input.trim()) && !busy && signedIn, [input, busy, signedIn]);
  const latestAgentText = useMemo(() => [...messages].reverse().find((message) => message.role === 'agent')?.text ?? '', [messages]);
  const observedSummary = useMemo(() => {
    const latest = [...messages].reverse().find((message) => message.role === 'agent' && (message.result || message.data?.counts));
    return {
      evidence: latest?.result?.evidence?.count,
      openFindings: latest?.result?.findings?.open ?? latest?.data?.counts?.openFindings,
      criticalHigh: latest?.result?.findings?.criticalOrHigh ?? latest?.data?.counts?.criticalHighFindings,
      status: latest?.result?.status,
    };
  }, [messages]);

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
        event.preventDefault();
        setOpen((current) => !current);
        return;
      }
      if (event.key === 'Escape' && open) {
        event.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open) {
      recognitionRef.current?.abort();
      window.speechSynthesis?.cancel();
      if (wasOpenRef.current) window.setTimeout(() => launcherRef.current?.focus(), 0);
      wasOpenRef.current = false;
      return;
    }
    wasOpenRef.current = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    messagesEndRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages, busy, open]);

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
    setVoiceError('');
    setCopied(false);
    setLastCommand(text);
    setInput(''); setMessages((current) => [...current, { role: 'user', text }]); setBusy(true);
    try {
      const history = messages.slice(-12).map(({ role, text: messageText }) => ({ role, text: messageText }));
      const response = await apiFetch('/api/agent/v1/command', { method: 'POST', body: JSON.stringify({ input: text, context: { path: window.location.pathname, history } }), timeout: 30_000 });
      const payload = await response.json().catch(() => ({})) as CommandResponse;
      if (!response.ok) throw new Error(typeof payload.reply === 'string' ? payload.reply : 'SPR Agent could not complete the request.');
      const replyText = payload.reply || 'The request completed without a factual response.';
      const responseActions = Array.from(new Map([
        ...(payload.actions ?? []),
        ...(payload.path && SAFE_NAV_PATHS.has(payload.path) ? [{ label: 'Open suggested page', path: payload.path }] : []),
      ].map((action) => [`${action.label}|${action.path ?? ''}|${action.command ?? ''}`, action])).values());
      setMessages((current) => [...current, { role: 'agent', text: replyText, data: payload.data, provenance: payload.provenance, actions: responseActions, nextMove: payload.nextMove, proposedAction: payload.proposedAction, stuck: payload.stuck }]);
      speak(replyText);
      if (payload.path && !SAFE_NAV_PATHS.has(payload.path)) {
        setMessages((current) => [...current, { role: 'agent', text: REFUSED_PATH_MESSAGE }]);
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
      setMessages((current) => [...current, { role: 'agent', text: errorText, actions: [{ label: 'Retry', command: text }] }]);
      speak(errorText);
    } finally {
      setBusy(false);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  function clearConversation() {
    setMessages([STARTER_MESSAGE]);
    setInput('');
    setLastCommand('');
    setVoiceError('');
    setCopied(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function copyLatestReply() {
    if (!latestAgentText || !navigator.clipboard?.writeText) return;
    await navigator.clipboard.writeText(latestAgentText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      <button ref={launcherRef} type="button" aria-label="Open SPR Agent" aria-expanded={open} onClick={() => setOpen(true)} className="group fixed bottom-6 right-6 z-[80] flex items-center gap-3 rounded-2xl border border-[var(--spr-accent)]/35 bg-[var(--spr-surface-deep)] px-4 py-3 text-sm font-semibold text-[var(--spr-text)] shadow-2xl shadow-black/40 transition hover:-translate-y-0.5 hover:border-[var(--spr-accent)]"><span className="relative grid h-9 w-9 place-items-center rounded-xl border border-[var(--spr-accent)]/35 bg-[var(--spr-surface)] text-[11px] font-black tracking-[.08em]"><span className="absolute right-0 top-0 h-2 w-2 -translate-y-1 translate-x-1 rounded-full bg-emerald-500 ring-2 ring-[var(--spr-surface-deep)]" />SPR</span><span className="text-left"><span className="block leading-4">SPR Intelligence</span><span className="mt-0.5 block text-[10px] font-medium uppercase tracking-[.14em] text-[var(--spr-text-faint)]">Evidence command center · Ctrl K</span></span></button>
      {open && <div className="fixed inset-0 z-[90] bg-black/70 p-0 backdrop-blur-sm sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
        <section role="dialog" aria-modal="true" aria-label="SPR Agent" className="mx-auto flex h-[100dvh] max-h-none w-full max-w-6xl flex-col overflow-hidden bg-[var(--spr-surface)] shadow-2xl shadow-black/60 sm:mt-[2vh] sm:h-[92vh] sm:max-h-[980px] sm:rounded-[28px] sm:border sm:border-[var(--spr-border)]">
          <header className="flex items-center justify-between gap-3 border-b border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-4 py-3 sm:px-6 sm:py-4"><div className="flex min-w-0 items-center gap-3"><div className="relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-[var(--spr-accent)]/40 bg-[var(--spr-surface)] text-xs font-black tracking-[.12em] text-[var(--spr-text)]"><span className="absolute inset-1 rounded-xl border border-[var(--spr-accent)]/15" />SPR</div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold tracking-tight text-[var(--spr-text)]">SPR Intelligence</h2><span className="rounded-full border border-[var(--spr-accent)]/30 bg-[var(--spr-accent)]/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[.14em] text-[var(--spr-text-muted)]">Evidence command center</span><span className="inline-flex items-center gap-1.5 text-xs text-[var(--spr-text-muted)]"><span className="h-2 w-2 rounded-full bg-emerald-500" />Ready</span></div><p className="mt-0.5 hidden truncate text-sm text-[var(--spr-text-muted)] sm:block">Investigate evidence, prioritize risk, and prepare governed actions from one workspace.</p><p className="mt-0.5 text-xs text-[var(--spr-text-faint)]">Current page: {window.location.pathname}</p></div></div><div className="hidden items-center gap-2 xl:flex"><div className="rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface)] px-3 py-2"><div className="text-[9px] font-bold uppercase tracking-[.14em] text-[var(--spr-text-faint)]">Evidence</div><div className="mt-0.5 text-sm font-semibold text-[var(--spr-text)]">{observedSummary.evidence ?? '—'}</div></div><div className="rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface)] px-3 py-2"><div className="text-[9px] font-bold uppercase tracking-[.14em] text-[var(--spr-text-faint)]">Open findings</div><div className="mt-0.5 text-sm font-semibold text-[var(--spr-text)]">{observedSummary.openFindings ?? '—'}</div></div><div className="rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface)] px-3 py-2"><div className="text-[9px] font-bold uppercase tracking-[.14em] text-[var(--spr-text-faint)]">Critical / high</div><div className="mt-0.5 text-sm font-semibold text-[var(--spr-text)]">{observedSummary.criticalHigh ?? '—'}</div></div><div className="rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface)] px-3 py-2"><div className="text-[9px] font-bold uppercase tracking-[.14em] text-[var(--spr-text-faint)]">Observed state</div><div className="mt-0.5 max-w-24 truncate text-sm font-semibold text-[var(--spr-text)]">{observedSummary.status ?? 'UNKNOWN'}</div></div></div><div className="flex shrink-0 items-center gap-2"><button type="button" onClick={() => void copyLatestReply()} disabled={!latestAgentText} className="rounded-xl border border-[var(--spr-border)] px-3 py-2 text-xs font-medium text-[var(--spr-text-muted)] hover:text-[var(--spr-text)] disabled:opacity-40">{copied ? 'Copied' : 'Copy reply'}</button><button type="button" onClick={clearConversation} className="rounded-xl border border-[var(--spr-border)] px-3 py-2 text-xs font-medium text-[var(--spr-text-muted)] hover:text-[var(--spr-text)]">Clear</button><button type="button" onClick={() => setOpen(false)} className="spr-btn spr-btn-secondary">Close</button></div></header>
          <div className="flex min-h-0 flex-1">
            <aside className="hidden w-64 shrink-0 flex-col border-r border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-5 lg:flex">
              <div className="text-[10px] font-bold uppercase tracking-[.18em] text-[var(--spr-text-faint)]">Operating mode</div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {OPERATING_MODES.map((mode) => <button key={mode.label} type="button" disabled={busy} onClick={() => { setActiveMode(mode.label); void submit(mode.command); }} className={`rounded-xl border px-2.5 py-2 text-left text-[11px] font-semibold transition ${activeMode === mode.label ? 'border-[var(--spr-accent)]/45 bg-[var(--spr-accent)]/5 text-[var(--spr-text)]' : 'border-[var(--spr-border)] text-[var(--spr-text-muted)] hover:text-[var(--spr-text)]'}`}>{mode.label}</button>)}
              </div>
              <div className="mt-6 text-[10px] font-bold uppercase tracking-[.18em] text-[var(--spr-text-faint)]">Investigate</div>
              <div className="mt-3 space-y-2">
                {QUICK_ACTIONS.map((action, index) => <button key={`rail-${action.value}`} type="button" disabled={busy} onClick={() => void submit(action.value)} className="group flex w-full items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-left text-sm text-[var(--spr-text-muted)] transition hover:border-[var(--spr-border)] hover:bg-[var(--spr-surface)] hover:text-[var(--spr-text)]"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg border border-[var(--spr-border)] text-[10px] font-bold text-[var(--spr-text-faint)]">{String(index + 1).padStart(2, '0')}</span>{action.label}</button>)}
              </div>
              <div className="mt-auto rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface)] p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--spr-text)]"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Evidence boundary active</div>
                <p className="mt-2 text-[11px] leading-5 text-[var(--spr-text-muted)]">Tenant-scoped claims only. Unobserved state remains UNKNOWN. Production actions still require explicit confirmation.</p>
              </div>
            </aside>
            <div role="log" aria-live="polite" aria-relevant="additions text" className="flex-1 space-y-6 overflow-y-auto bg-[var(--spr-surface)] px-4 py-6 sm:px-8 sm:py-7">
            {messages.length === 1 ? <div className="mx-auto mt-4 w-full max-w-3xl rounded-3xl border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-6 sm:p-8"><div className="text-[10px] font-bold uppercase tracking-[.18em] text-[var(--spr-text-faint)]">Start with an outcome</div><h3 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--spr-text)]">What do you need to know or do?</h3><p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--spr-text-muted)]">Choose an operating mode or ask naturally. SPR will separate observed evidence from UNKNOWN state and keep production actions behind confirmation.</p><div className="mt-5 grid gap-3 sm:grid-cols-2">{OPERATING_MODES.map((mode) => <button key={`empty-${mode.label}`} type="button" disabled={busy} onClick={() => { setActiveMode(mode.label); void submit(mode.command); }} className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface)] p-4 text-left transition hover:-translate-y-0.5 hover:border-[var(--spr-accent)]/45"><div className="text-sm font-semibold text-[var(--spr-text)]">{mode.label}</div><div className="mt-1 text-xs leading-5 text-[var(--spr-text-muted)]">{mode.label === 'Investigate' ? 'Find the most important observed risk and its evidence.' : mode.label === 'Client brief' ? 'Turn observed state into a clear client-facing explanation.' : mode.label === 'Revenue' ? 'Surface evidence-backed commercial opportunities.' : 'Review monitoring, scans, and operational attention items.'}</div></button>)}</div></div> : null}
            {messages.map((message, index) => <div key={`${message.role}-${index}`} className={message.role === 'user' ? 'ml-auto max-w-[78%] rounded-2xl border border-[var(--spr-accent)]/30 bg-[var(--spr-surface-deep)] px-4 py-3.5 text-[15px] leading-7 text-[var(--spr-text)] shadow-sm' : 'mr-auto w-full max-w-[94%] border-l-2 border-[var(--spr-accent)]/45 bg-[var(--spr-surface-deep)] px-5 py-4 text-[15px] leading-7 text-[var(--spr-text)] shadow-sm sm:px-6'}><div className="mb-1.5 text-[10px] font-bold uppercase tracking-[.15em] text-[var(--spr-text-faint)]">{message.role === 'user' ? 'You' : 'SPR Intelligence · observed workspace context'}</div>{message.role === 'agent' && index > 0 ? <div className="mb-3 flex flex-wrap gap-2"><span className="rounded-full border border-[var(--spr-border)] bg-[var(--spr-surface)] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[.14em] text-[var(--spr-text-faint)]">Observed response</span>{message.stuck ? <span className="rounded-full border border-amber-500/30 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[.14em] text-[var(--spr-text-muted)]">Needs intervention</span> : null}{message.proposedAction ? <span className="rounded-full border border-[var(--spr-accent)]/30 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[.14em] text-[var(--spr-text-muted)]">Action available</span> : null}</div> : null}<div className="whitespace-pre-wrap break-words">{message.text}</div>{message.result && <div className="mt-4 space-y-3 rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface)] p-4 text-sm leading-6 text-[var(--spr-text-muted)]"><div className="grid gap-2 sm:grid-cols-3"><div className="rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-3"><div className="text-[9px] font-bold uppercase tracking-[.14em] text-[var(--spr-text-faint)]">Observed state</div><div className="mt-1 font-semibold text-[var(--spr-text)]">{message.result.status || 'UNKNOWN'}</div></div><div className="rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-3"><div className="text-[9px] font-bold uppercase tracking-[.14em] text-[var(--spr-text-faint)]">Findings</div><div className="mt-1 font-semibold text-[var(--spr-text)]">{message.result.findings?.open ?? '—'} open · {message.result.findings?.criticalOrHigh ?? '—'} critical/high</div></div><div className="rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-3"><div className="text-[9px] font-bold uppercase tracking-[.14em] text-[var(--spr-text-faint)]">Evidence records</div><div className="mt-1 font-semibold text-[var(--spr-text)]">{message.result.evidence?.count ?? '—'}</div></div></div><details className="rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-3"><summary className="cursor-pointer text-xs font-semibold uppercase tracking-[.12em] text-[var(--spr-text)]">Inspect proof & provenance</summary><div className="mt-2 space-y-1"><div>Tenant scoped: {message.result.provenance?.tenantScoped ? 'yes' : 'not reported'}</div><div>Finding IDs observed: {message.result.provenance?.findingRecords?.findingIds?.join(', ') || 'none'}</div><div>Evidence IDs observed: {message.result.provenance?.evidenceRecords?.evidenceIds?.join(', ') || 'none'}</div><div>Observation IDs observed: {message.result.provenance?.observationRecords?.observationIds?.join(', ') || 'none'}</div>{message.result.sources?.slice(0,10).map((source) => <div key={source.evidenceId || `${source.provider}-${source.observedAt}`} className="rounded border border-[var(--spr-border)] p-2"><div><b>{source.evidenceId || 'Evidence record'}</b> · {source.provider || 'provider not recorded'} · observed {source.observedAt || 'time not recorded'}</div><div>Method: {source.verificationMethod || 'not recorded'}</div><div>Hash: {source.evidenceHash || 'not recorded'}</div><div>{source.sourceUrl ? <a href={source.sourceUrl} target="_blank" rel="noreferrer" className="underline">Open observed source</a> : 'No source URL recorded'}</div>{source.limitation ? <div>Limitation: {source.limitation}</div> : null}</div>)}</div></details></div>}{message.data?.counts && <div className="mt-4 grid gap-3 rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface)] p-4 text-sm text-[var(--spr-text-muted)] sm:grid-cols-2"><div>Clients: <b>{message.data.counts.clients ?? 0}</b></div><div>Passports: <b>{message.data.counts.passports ?? 0}</b></div><div>Open findings: <b>{message.data.counts.openFindings ?? 0}</b></div><div>Critical/high: <b>{message.data.counts.criticalHighFindings ?? 0}</b></div></div>}{message.data?.portfolioCommercial?.opportunities?.length ? <div className="mt-4 rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface)] p-4 text-sm leading-6 text-[var(--spr-text-muted)]"><div className="flex flex-wrap items-end justify-between gap-3"><div><div className="text-[10px] font-bold uppercase tracking-[.15em] text-[var(--spr-text-faint)]">Commercial intelligence</div><div className="mt-1 font-semibold text-[var(--spr-text)]">Evidence-backed income opportunities</div></div><div className="text-right"><div className="text-[9px] font-bold uppercase tracking-[.14em] text-[var(--spr-text-faint)]">Configured opportunity value</div><div className="mt-1 text-xl font-semibold text-[var(--spr-text)]">{typeof message.data.portfolioCommercial.configuredValue === 'number' ? new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(message.data.portfolioCommercial.configuredValue) : 'UNKNOWN'}</div></div></div><div className="mt-4 grid grid-cols-3 gap-2"><div className="rounded-xl border border-[var(--spr-border)] p-3"><div className="text-[9px] uppercase tracking-[.12em] text-[var(--spr-text-faint)]">Total</div><div className="mt-1 text-lg font-semibold text-[var(--spr-text)]">{message.data.portfolioCommercial.opportunityCount ?? message.data.portfolioCommercial.opportunities.length}</div></div><div className="rounded-xl border border-[var(--spr-border)] p-3"><div className="text-[9px] uppercase tracking-[.12em] text-[var(--spr-text-faint)]">Remediation</div><div className="mt-1 text-lg font-semibold text-[var(--spr-text)]">{message.data.portfolioCommercial.opportunities.filter((item) => item.kind === 'REMEDIATION').length}</div></div><div className="rounded-xl border border-[var(--spr-border)] p-3"><div className="text-[9px] uppercase tracking-[.12em] text-[var(--spr-text-faint)]">Monitoring</div><div className="mt-1 text-lg font-semibold text-[var(--spr-text)]">{message.data.portfolioCommercial.opportunities.filter((item) => item.kind === 'MONITORING').length}</div></div></div><div className="mt-3 flex h-20 items-end gap-1 rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-3" aria-label="Opportunity priority chart">{message.data.portfolioCommercial.opportunities.slice(0,12).map((item) => { const max = Math.max(...message.data!.portfolioCommercial!.opportunities!.slice(0,12).map((opportunity) => opportunity.priority), 1); return <div key={`bar-${item.passportId}-${item.kind}`} title={`${item.passportName}: priority ${item.priority}`} className="min-w-1 flex-1 rounded-t bg-[var(--spr-accent)]/60" style={{ height: `${Math.max(8, Math.round((item.priority / max) * 100))}%` }} />; })}</div><div className="mt-1 text-[10px] text-[var(--spr-text-faint)]">Observed opportunity priority · highest first · not forecast revenue</div><div className="mt-3 space-y-2">{message.data.portfolioCommercial.opportunities.slice(0,5).map((item) => <div key={`${item.passportId}-${item.kind}`} className="rounded border border-[var(--spr-border)] p-2"><div className="font-medium text-[var(--spr-text)]">{item.clientName ? `${item.clientName} · ` : ''}{item.passportName} · {item.kind.replaceAll('_',' ').toLowerCase()}</div><div className="mt-1">{item.reason}</div><button type="button" disabled={busy} onClick={() => void submit(item.command)} className="mt-3 rounded-xl border border-[var(--spr-accent)]/50 bg-[var(--spr-surface-deep)] px-4 py-2.5 font-semibold text-[var(--spr-text)] transition hover:border-[var(--spr-accent)]">Inspect opportunity</button></div>)}</div><div className="mt-3 text-xs leading-5 text-[var(--spr-text-muted)]">{message.data.portfolioCommercial.policy}</div></div> : null}{message.data?.customerManagement ? <div className="mt-4 rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface)] p-4 text-sm leading-6 text-[var(--spr-text-muted)]"><div className="font-semibold text-[var(--spr-text)]">Customer-management priority queue</div><div className="mt-2 grid gap-2 sm:grid-cols-4"><div>Active: <b>{message.data.customerManagement.activeProspects ?? 0}</b></div><div>Follow-ups due: <b>{message.data.customerManagement.dueFollowups ?? 0}</b></div><div>Replies: <b>{message.data.customerManagement.replied ?? 0}</b></div><div>Demos / pilots: <b>{(message.data.customerManagement.demos ?? 0) + (message.data.customerManagement.pilots ?? 0)}</b></div></div>{message.data.customerManagement.priorities?.length ? <div className="mt-2 space-y-2">{message.data.customerManagement.priorities.slice(0,5).map((item) => <div key={item.contactId} className="rounded border border-[var(--spr-border)] p-2"><div className="font-medium text-[var(--spr-text)]">{item.company || item.contactId} · {item.pipelineStage}</div><div className="mt-1">{item.reason}</div>{item.nextFollowupAt ? <div className="mt-1 text-[11px] text-[var(--spr-text-faint)]">Next follow-up: {item.nextFollowupAt}</div> : null}{item.commands?.length ? <div className="mt-2 flex flex-wrap gap-2">{item.commands.map((command) => <button key={`${item.contactId}-${command.label}`} type="button" disabled={busy} onClick={() => command.command ? void submit(command.command) : command.path ? (navigate(command.path) ? setOpen(false) : setMessages((current) => [...current, { role: 'agent', text: REFUSED_PATH_MESSAGE }])) : undefined} className="rounded-full border border-[var(--spr-border)] px-3 py-1.5 text-xs font-medium text-[var(--spr-text)]">{command.label}</button>)}</div> : null}</div>)}</div> : null}<div className="mt-3 text-xs leading-5 text-[var(--spr-text-muted)]">{message.data.customerManagement.policy}</div></div> : null}{message.data?.commercial ? <div className="mt-4 rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface)] p-4 text-sm leading-6 text-[var(--spr-text-muted)]"><div className="font-semibold text-[var(--spr-text)]">MSP acquisition engine</div><div className="mt-2 grid gap-2 sm:grid-cols-3">{(['discovery','qualification','outreach'] as const).map((key) => { const item = message.data?.commercial?.[key]; if (!item) return null; const activity = Object.values(item.last24h || {}).reduce((sum, value) => sum + Number(value || 0), 0); return <div key={key} className="rounded border border-[var(--spr-border)] p-2"><div className="font-medium capitalize text-[var(--spr-text)]">{key}</div><div>{item.state || 'unknown'} · {activity} job(s) touched in 24h</div><div className="mt-1">{item.stateReason || 'No state reason reported.'}</div></div>; })}</div></div> : null}{message.data?.topPassports?.length ? <div className="mt-4 rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface)] p-4 text-sm leading-6 text-[var(--spr-text-muted)]"><b>Highest observed passport finding counts:</b><ul className="mt-1 list-disc pl-4">{message.data.topPassports.slice(0,5).map((item) => <li key={item.passport_id}>{item.name}: {item.critical_high} critical/high, {item.open_findings} open · IDs: {item.finding_ids?.join(', ') || 'none'}</li>)}</ul></div> : null}{message.provenance && <details className="mt-4 rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface)] p-4 text-sm leading-6 text-[var(--spr-text-muted)]"><summary className="cursor-pointer font-semibold">Summary proof</summary><div className="mt-2">Generated: {message.provenance.generatedAt || 'not reported'} · Tenant scoped: {message.provenance.tenantScoped ? 'yes' : 'not reported'}</div>{message.provenance.sources?.map((source) => <div key={source.table} className="mt-1 rounded border border-[var(--spr-border)] p-2"><b>{source.table}</b> · {source.observation} · fields: {source.fields.join(', ')} · {source.filter}</div>)}</details>}{message.proposedAction ? <div className="mt-4 rounded-2xl border border-[var(--spr-accent)]/35 bg-[var(--spr-surface)] p-4 text-sm leading-6"><div className="flex items-center justify-between gap-3"><div className="font-semibold text-[var(--spr-text)]">Governed action</div><span className="rounded-full border border-[var(--spr-accent)]/30 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[.14em] text-[var(--spr-text-faint)]">Confirmation required</span></div><div className="mt-1 text-[var(--spr-text-muted)]">{message.proposedAction.description}</div><div className="mt-2 text-[11px] leading-5 text-[var(--spr-text-faint)]">No mutation has occurred. SPR will persist a confirmation receipt before the authorized route executes.</div><button type="button" disabled={busy} onClick={() => void executeProposedAction(message.proposedAction!)} className="mt-3 rounded-xl border border-[var(--spr-accent)]/50 bg-[var(--spr-surface-deep)] px-4 py-2.5 font-semibold text-[var(--spr-text)] transition hover:border-[var(--spr-accent)]">Confirm and run</button></div> : null}{message.nextMove ? <div className="mt-4 rounded-2xl border border-[var(--spr-accent)]/35 bg-[var(--spr-surface)] p-4 text-sm leading-6"><div className="text-[10px] font-bold uppercase tracking-[.16em] text-[var(--spr-text-faint)]">{message.stuck ? 'Recovery path' : 'Recommended next move'}</div><div className="mt-1 text-[var(--spr-text-muted)]">{message.nextMove.label}{message.nextMove.reason ? ` — ${message.nextMove.reason}` : ''}</div>{(message.nextMove.path || message.nextMove.command) ? <button type="button" disabled={busy} onClick={() => message.nextMove?.path ? (navigate(message.nextMove.path) ? setOpen(false) : setMessages((current) => [...current, { role: 'agent', text: REFUSED_PATH_MESSAGE }])) : message.nextMove?.command ? void submit(message.nextMove.command) : undefined} className="mt-3 rounded-xl border border-[var(--spr-accent)]/50 bg-[var(--spr-surface-deep)] px-4 py-2.5 font-semibold text-[var(--spr-text)] transition hover:border-[var(--spr-accent)]">Do this next</button> : null}</div> : null}{message.actions?.length ? <div className="mt-3 flex flex-wrap gap-2">{message.actions.map((action) => <button key={`${action.label}-${action.path || action.command || ''}`} type="button" disabled={busy} onClick={() => action.path ? (navigate(action.path) ? setOpen(false) : setMessages((current) => [...current, { role: 'agent', text: REFUSED_PATH_MESSAGE }])) : action.command ? void submit(action.command) : undefined} className="rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface)] px-3.5 py-2 text-sm font-medium text-[var(--spr-text-muted)] transition hover:border-[var(--spr-accent)]/50 hover:text-[var(--spr-text)]">{action.label}</button>)}</div> : null}</div>)}
            {busy && <div role="status" aria-live="polite" className="mr-auto max-w-[92%] rounded-2xl rounded-bl-md border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-5 py-4 text-[15px] text-[var(--spr-text-muted)]"><span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--spr-accent)]" />Working from observed SPR data…</div>}
            <div ref={messagesEndRef} aria-hidden="true" />
            </div>
          </div>
          <div className="border-t border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-4 sm:p-5"><div className="mb-3 flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.14em] text-[var(--spr-text-faint)]"><span>Mode</span><span className="rounded-full border border-[var(--spr-accent)]/30 bg-[var(--spr-accent)]/5 px-2 py-1 text-[var(--spr-text-muted)]">{activeMode}</span></div><div className="hidden text-[10px] uppercase tracking-[.12em] text-[var(--spr-text-faint)] sm:block">Evidence → interpretation → governed action</div></div><div className="mb-4 flex flex-wrap items-center gap-2"><button type="button" onClick={() => { const next = !handsFree; setHandsFree(next); handsFreeRef.current = next; if (next) window.setTimeout(() => listen(), 50); else { recognitionRef.current?.abort(); window.speechSynthesis?.cancel(); } }} className={`rounded-full border px-3 py-1.5 text-xs font-medium ${handsFree ? 'border-[var(--spr-accent)] text-[var(--spr-text)]' : 'border-[var(--spr-border)] text-[var(--spr-text-muted)]'}`}>{handsFree ? 'Hands-free on' : 'Hands-free'}</button><button type="button" disabled={busy || listening || !recognitionRef.current} onClick={listen} className="rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface)] px-3.5 py-2 text-sm text-[var(--spr-text-muted)] transition hover:border-[var(--spr-accent)]/50 hover:text-[var(--spr-text)]">{listening ? 'Listening…' : 'Speak'}</button>{voiceError ? <span className="text-xs text-[var(--spr-text-faint)]">{voiceError}</span> : null}</div><div className="mb-4 flex flex-wrap gap-2 lg:hidden">{QUICK_ACTIONS.map((action) => <button key={action.value} type="button" disabled={busy} onClick={() => void submit(action.value)} className="rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface)] px-3.5 py-2 text-sm text-[var(--spr-text-muted)] transition hover:border-[var(--spr-accent)]/50 hover:text-[var(--spr-text)]">{action.label}</button>)}</div><form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="flex items-stretch gap-3"><input ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'ArrowUp' && !input && lastCommand) { event.preventDefault(); setInput(lastCommand); } }} placeholder={activeMode === 'Client brief' ? 'Ask for a client-ready explanation…' : activeMode === 'Revenue' ? 'Ask about opportunities, follow-ups, or next commercial action…' : activeMode === 'Operations' ? 'Ask about monitoring, scans, failures, or system state…' : 'Investigate risk, evidence, findings, or a Passport…'} aria-label="Ask SPR Agent" className="min-w-0 flex-1 rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface)] px-4 py-3.5 text-[15px] leading-6 text-[var(--spr-text)] outline-none transition placeholder:text-[var(--spr-text-faint)] focus:border-[var(--spr-accent)]" maxLength={500} disabled={busy} /><button type="submit" disabled={!canSubmit} className="spr-btn spr-btn-primary">{busy ? 'Working…' : 'Send'}</button></form><div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-[var(--spr-text-faint)]"><span>↑ recalls your last command · Esc closes · Ctrl/Cmd K toggles</span><span className={input.length > 450 ? 'font-semibold text-[var(--spr-text)]' : ''}>{input.length}/500</span></div><p className="mt-2 text-xs leading-5 text-[var(--spr-text-muted)]">SPR Intelligence can explain, investigate, navigate, and prepare governed actions. Hard rule: no evidence, no tenant-specific claim. UNKNOWN stays UNKNOWN.</p></div>
        </section>
      </div>}
    </>
  );
}
