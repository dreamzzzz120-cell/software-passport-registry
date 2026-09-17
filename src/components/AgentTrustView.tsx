import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertCircle, ArrowRight, Bot, CheckCircle2, Clock3, Copy, FileText, Loader, Monitor, ShieldCheck, Sparkles, XCircle } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

const tools = [
  ['verify_software', 'Verify a Software Passport and its current evidence-backed status.'],
  ['get_passport', 'Retrieve the machine-readable public Passport.'],
  ['get_trust_evidence', 'Retrieve evidence supporting a trust determination.'],
  ['get_security_status', 'Return observed security evidence and status.'],
  ['get_compliance_status', 'Return only compliance claims supported by evidence.'],
  ['check_freshness', 'Check evidence freshness and staleness.'],
  ['verify_claim', 'Check a claim and return VERIFIED, CONTRADICTED, or UNVERIFIED.'],
] as const;

type AgentStatus = 'LIVE' | 'NEXT';
type AgentState = 'idle' | 'loading' | 'done' | 'error';

interface AgentResult { status: string; [key: string]: unknown; }

interface AgentDef {
  name: string;
  status: AgentStatus;
  description: string;
  action: string;
  icon: typeof ShieldCheck;
  endpoint: string;
  method?: 'GET' | 'POST';
  body?: (input: string) => Record<string, unknown>;
  inputPlaceholder?: string;
  inputLabel?: string;
}

const agents: AgentDef[] = [
  {
    name: 'Trust Agent',
    status: 'LIVE',
    description: 'Answers software-trust questions from observed SPR evidence.',
    action: 'Verify software',
    icon: ShieldCheck,
    endpoint: '/api/agent/v1/verify-software',
    method: 'POST',
    body: (input) => ({ query: input }),
    inputPlaceholder: 'Enter a software name or passport ID',
    inputLabel: 'Software name or passport ID',
  },
  {
    name: 'Distribution Agent',
    status: 'LIVE',
    description: 'Discovers and researches potential MSP opportunities using evidence-first workflows.',
    action: 'Open distribution',
    icon: Activity,
    endpoint: '/api/founder/distribution/status',
    method: 'GET',
  },
  {
    name: 'Vendor Risk Agent',
    status: 'LIVE',
    description: 'Turns vendor evidence, findings, freshness and completeness into a deterministic operational review.',
    action: 'Run vendor risk review',
    icon: ShieldCheck,
    endpoint: '/api/agent/v1/vendor-risk',
    method: 'POST',
    body: (input) => ({ passportId: input, staleAfterDays: 30 }),
    inputPlaceholder: 'Enter a passport ID',
    inputLabel: 'Passport ID',
  },
  {
    name: 'Compliance Agent',
    status: 'LIVE',
    description: 'Maps observed evidence to supported controls and surfaces evidence gaps without inventing compliance.',
    action: 'View compliance schedules',
    icon: CheckCircle2,
    endpoint: '/api/compliance/schedules',
    method: 'GET',
  },
  {
    name: 'Monitoring Agent',
    status: 'LIVE',
    description: 'Continuously watches passports and evidence for material changes and prepares alerts.',
    action: 'View monitoring configs',
    icon: Monitor,
    endpoint: '/api/monitoring/monitoring-configurations',
    method: 'GET',
  },
  {
    name: 'Report Agent',
    status: 'LIVE',
    description: 'Turns verified evidence and findings into customer-ready reports.',
    action: 'View report schedules',
    icon: FileText,
    endpoint: '/api/report-schedules',
    method: 'GET',
  },
  {
    name: 'Revenue Agent',
    status: 'LIVE',
    description: 'Identifies observable service opportunities an MSP can package and sell to clients.',
    action: 'View savings report',
    icon: Sparkles,
    endpoint: '/api/savings/report',
    method: 'GET',
  },
];

export default function AgentTrustView() {
  const [passport, setPassport] = useState('');
  const [claim, setClaim] = useState('');
  const [copied, setCopied] = useState(false);
  const [mcpAvailable, setMcpAvailable] = useState<boolean | null>(null);
  const [distributionStatus, setDistributionStatus] = useState<Record<string, number> | null>(null);
  const [outreach, setOutreach] = useState<{ enabled: boolean; verification: null | { fromAddress: string; toAddress: string; status: string; providerMessageId: string | null; error: string | null; sentAt: string } } | null>(null);
  const [agentStates, setAgentStates] = useState<Record<string, { state: AgentState; result: AgentResult | null; input: string }>>({});
  const [claimVerifying, setClaimVerifying] = useState(false);
  const [claimResult, setClaimResult] = useState<{ status: string; reason: string } | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/health').then(r => r.json()).then(d => { if (!cancelled) setMcpAvailable(Boolean(d?.mcpAvailable)); }).catch(() => { if (!cancelled) setMcpAvailable(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/founder/distribution/status').then(async response => {
      if (!response.ok) return null;
      const data = await response.json().catch(() => null);
      if (!cancelled && data?.counts) setDistributionStatus(data.counts);
      if (!cancelled && data) setOutreach({ enabled: data.autonomousOutreachEnabled === true, verification: data.senderVerification ?? null });
      return data;
    }).catch(() => null);
    return () => { cancelled = true; };
  }, []);

  const endpoint = useMemo(() => `${window.location.origin}/mcp`, []);
  const example = useMemo(() => JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'verify_software', arguments: { passport: passport || 'YOUR_SIGNED_PASSPORT' } } }, null, 2), [passport]);
  const copy = async (value: string) => { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1500); };

  const runAgent = useCallback(async (agent: AgentDef) => {
    const current = agentStates[agent.name];
    const inputVal = current?.input ?? '';
    setAgentStates(prev => ({ ...prev, [agent.name]: { state: 'loading', result: prev[agent.name]?.result ?? null, input: inputVal } }));
    try {
      const opts: RequestInit = agent.method === 'POST' ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(agent.body ? agent.body(inputVal) : {}) } : {};
      const response = await apiFetch(agent.endpoint, opts);
      if (!response.ok) {
        const errBody = await response.json().catch(() => null);
        throw new Error(errBody?.error || errBody?.message || `HTTP ${response.status}`);
      }
      const data = await response.json();
      setAgentStates(prev => ({ ...prev, [agent.name]: { state: 'done', result: data, input: inputVal } }));
    } catch (err) {
      setAgentStates(prev => ({ ...prev, [agent.name]: { state: 'error', result: { status: 'error', message: err instanceof Error ? err.message : 'Request failed' }, input: inputVal } }));
    }
  }, [agentStates]);

  const setAgentInput = (name: string, value: string) => {
    setAgentStates(prev => ({ ...prev, [name]: { state: 'idle', result: prev[name]?.result ?? null, input: value } }));
  };

  const verifyClaim = async () => {
    if (!claim.trim() || !passport.trim()) return;
    setClaimVerifying(true); setClaimError(null); setClaimResult(null);
    try {
      const response = await apiFetch('/api/agent/v1/verify-claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passport: passport.trim(), claim: claim.trim() }),
      });
      if (!response.ok) {
        const errBody = await response.json().catch(() => null);
        throw new Error(String(errBody?.error || errBody?.message || `HTTP ${response.status}`));
      }
      const data = await response.json();
      setClaimResult({ status: String(data?.status || 'UNVERIFIED'), reason: String(data?.reason || 'No reason returned.') });
    } catch (err) {
      setClaimError(err instanceof Error ? err.message : 'Verification request failed.');
    } finally {
      setClaimVerifying(false);
    }
  };

  const claimStatusColor = claimResult?.status === 'VERIFIED' ? 'text-[var(--spr-green)]' : claimResult?.status === 'CONTRADICTED' ? 'text-[var(--spr-red)]' : 'text-[var(--spr-amber)]';
  const ClaimIcon = claimResult?.status === 'VERIFIED' ? CheckCircle2 : claimResult?.status === 'CONTRADICTED' ? XCircle : AlertCircle;

  const renderAgentResult = (agent: AgentDef, state: { state: AgentState; result: AgentResult | null }) => {
    if (state.state === 'loading') return <div className="mt-4 flex items-center gap-2 text-sm text-[var(--spr-text-muted)]"><Loader className="h-4 w-4 animate-spin" /> Running…</div>;
    if (state.state === 'error') return <div className="mt-4 flex items-start gap-2 rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 p-3 text-xs text-[var(--spr-red)]"><AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /><div>{String(state.result?.message || 'Request failed')}</div></div>;
    if (state.state === 'done' && state.result) return <div className="mt-4 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-3"><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[var(--spr-green)]"><CheckCircle2 className="h-3.5 w-3.5" /> Result</div><pre className="max-h-64 overflow-auto text-xs text-[var(--spr-text)]">{JSON.stringify(state.result, null, 2)}</pre></div>;
    return null;
  };

  return <div className="mx-auto max-w-7xl space-y-8">
    <section className="spr-panel overflow-hidden p-6 md:p-8">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.25em] text-[var(--spr-highlight)]"><Bot className="h-4 w-4" /> AUTONOMOUS TRUST OPERATIONS</div>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">SPR Agents</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--spr-text-muted)]">SPR does the evidence work, then agents use that evidence to perform repeatable trust operations. Agents never turn missing evidence into a positive claim.</p>
        </div>
        <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] px-4 py-3 text-sm"><div className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4" /> Core rule</div><div className="mt-1 text-[var(--spr-text-muted)]">If SPR cannot observe it, SPR does not claim it.</div></div>
      </div>
      {mcpAvailable === false && <div className="mt-6 rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 p-4 text-sm text-[var(--spr-red)]">The MCP endpoint is not currently enabled on this server. Agent requests through /mcp will fail until its server-side configuration is enabled.</div>}
    </section>

    <section>
      <div className="mb-4 flex items-end justify-between gap-4"><div><h2 className="text-xl font-semibold">Agent workforce</h2><p className="mt-1 text-sm text-[var(--spr-text-muted)]">One SPR evidence layer. Specialized workers on top.</p></div><div className="text-xs text-[var(--spr-text-faint)]">Every agent runs against live SPR evidence — no mock data, no inferred results.</div></div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {agents.map((agent) => {
          const Icon = agent.icon;
          const agentState = agentStates[agent.name] ?? { state: 'idle' as AgentState, result: null, input: '' };
          const needsInput = agent.method === 'POST' && agent.body;
          return <article key={agent.name} className="spr-panel flex flex-col p-5">
            <div className="flex items-start justify-between gap-3"><div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-2"><Icon className="h-5 w-5" /></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[.16em] ${agent.status === 'LIVE' ? 'bg-[var(--spr-green)]/15 text-[var(--spr-green)]' : 'bg-[var(--spr-surface-alt)] text-[var(--spr-text-faint)]'}`}>{agent.status}</span></div>
            <h3 className="mt-5 font-semibold">{agent.name}</h3>
            <p className="mt-2 min-h-10 text-sm leading-5 text-[var(--spr-text-muted)]">{agent.description}</p>
            {needsInput && <div className="mt-4"><label className="block text-xs font-medium text-[var(--spr-text-muted)]">{agent.inputLabel || 'Input'}</label><input value={agentState.input} onChange={e => setAgentInput(agent.name, e.target.value.slice(0, 500))} placeholder={agent.inputPlaceholder || 'Enter value'} className="mt-1 w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-sm outline-none focus:border-[var(--spr-highlight)]" /></div>}
            {renderAgentResult(agent, agentState)}
            <div className="mt-auto pt-5">
              <button onClick={() => void runAgent(agent)} disabled={agentState.state === 'loading' || (needsInput && !agentState.input.trim())} className="spr-btn spr-btn-primary inline-flex w-full items-center justify-center gap-2 text-sm">
                {agentState.state === 'loading' ? <Loader className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                {agent.action}
              </button>
            </div>
          </article>;
        })}
      </div>
    </section>

    <section className="grid gap-4 md:grid-cols-3">
      <div className="spr-panel p-5"><div className="text-xs font-semibold uppercase tracking-[.18em] text-[var(--spr-text-muted)]">Trust transport</div><div className="mt-2 text-xl font-semibold">MCP / JSON-RPC</div><div className="mt-1 text-xs text-[var(--spr-text-muted)]">Read-only agent surface</div></div>
      <div className="spr-panel p-5"><div className="text-xs font-semibold uppercase tracking-[.18em] text-[var(--spr-text-muted)]">Distribution jobs</div><div className="mt-2 text-xl font-semibold">{distributionStatus ? Object.values(distributionStatus).reduce((sum, value) => sum + value, 0) : 'Not verified'}</div><div className="mt-1 text-xs text-[var(--spr-text-muted)]">Only shown when the founder distribution endpoint authorizes this session.</div>{outreach && <div className="mt-2 border-t border-[var(--spr-border)] pt-2 text-xs text-[var(--spr-text-muted)]"><div>Autonomous outreach: <b className="text-[var(--spr-text)]">{outreach.enabled ? 'enabled' : 'disabled'}</b></div><div className="mt-1">Sender verification: {outreach.verification ? <>{outreach.verification.status === 'sent' ? <span className="text-[var(--spr-green)]">sent</span> : <span className="text-[var(--spr-red)]">failed</span>} from <code>{outreach.verification.fromAddress}</code> to <code>{outreach.verification.toAddress}</code> at {new Date(outreach.verification.sentAt).toLocaleString()}{outreach.verification.providerMessageId ? <> · provider id <code>{outreach.verification.providerMessageId}</code></> : null}{outreach.verification.error ? <> · {outreach.verification.error}</> : null}</> : 'none recorded'}</div></div>}</div>
      <div className="spr-panel p-5"><div className="text-xs font-semibold uppercase tracking-[.18em] text-[var(--spr-text-muted)]">Evidence policy</div><div className="mt-2 text-xl font-semibold">Evidence first</div><div className="mt-1 text-xs text-[var(--spr-text-muted)]">Unknown remains unknown.</div></div>
    </section>

    <section className="spr-panel p-5"><div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-lg font-semibold">Agent tools</h2><p className="mt-1 text-sm text-[var(--spr-text-muted)]">External agents can use these read-only trust capabilities through MCP.</p></div><button onClick={() => void copy(endpoint)} className="spr-btn spr-btn-secondary inline-flex items-center gap-2"><Copy className="h-4 w-4" />{copied ? 'Copied' : 'Copy MCP endpoint'}</button></div><div className="mt-4 grid gap-3 md:grid-cols-2">{tools.map(([name, description]) => <div key={name} className="rounded-md border border-[var(--spr-border)] p-4"><div className="font-mono text-sm text-[var(--spr-highlight)]">{name}</div><p className="mt-1 text-sm text-[var(--spr-text-muted)]">{description}</p></div>)}</div></section>

    <section className="grid gap-5 lg:grid-cols-2">
      <div className="spr-panel p-5"><div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-[var(--spr-green)]" /><h2 className="text-lg font-semibold">Verify a Passport</h2></div><p className="mt-1 text-sm text-[var(--spr-text-muted)]">Prepare a machine-readable verification request for an external agent.</p><input value={passport} onChange={e => setPassport(e.target.value.slice(0, 512))} placeholder="Signed Passport token or URL" className="mt-4 w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-sm outline-none focus:border-[var(--spr-highlight)]" /><pre className="mt-4 max-h-64 overflow-auto rounded-md bg-[var(--spr-surface-sunken)] p-4 text-xs text-[var(--spr-text)]">{example}</pre><button onClick={() => void copy(example)} className="spr-btn spr-btn-primary mt-3 inline-flex items-center gap-2"><ArrowRight className="h-4 w-4" />{copied ? 'Copied' : 'Copy verification request'}</button></div>
      <div className="spr-panel p-5"><div className="flex items-center gap-2"><Bot className="h-5 w-5 text-[var(--spr-highlight)]" /><h2 className="text-lg font-semibold">Verify a claim</h2></div><p className="mt-1 text-sm text-[var(--spr-text-muted)]">SPR deliberately returns UNVERIFIED when observed evidence does not support the claim. Enter a signed passport above and a claim to verify it.</p><input value={claim} onChange={e => { setClaim(e.target.value.slice(0, 2000)); setClaimResult(null); setClaimError(null); }} placeholder="Example: this software has current security evidence" className="mt-4 w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-sm outline-none focus:border-[var(--spr-highlight)]" /><div className="mt-4 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4 text-sm text-[var(--spr-amber)]">Claim: {claim || 'Enter a claim to verify against SPR evidence.'}</div>{claimError && <div className="mt-3 flex items-start gap-2 rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 p-3 text-xs text-[var(--spr-red)]"><AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /><div>{claimError}</div></div>}{claimResult && <div className={`mt-3 flex items-start gap-2 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-4 text-sm ${claimStatusColor}`}><ClaimIcon className="h-4 w-4 mt-0.5 shrink-0" /><div><div className="font-bold">{claimResult.status}</div><div className="mt-1 text-xs text-[var(--spr-text-muted)]">{claimResult.reason}</div></div></div>}<button onClick={() => void verifyClaim()} disabled={claimVerifying || !claim.trim() || !passport.trim()} className="spr-btn spr-btn-primary mt-4 inline-flex items-center gap-2">{claimVerifying ? <Loader className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}{claimVerifying ? 'Verifying…' : 'Verify claim against SPR evidence'}</button>{!passport.trim() && <p className="mt-2 text-xs text-[var(--spr-text-faint)]">Enter a signed passport in the Verify a Passport panel above to enable claim verification.</p>}</div>
    </section>

    <section className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5 text-sm text-[var(--spr-text-muted)]"><strong className="text-[var(--spr-text)]">Architecture:</strong> Agent → SPR evidence → authoritative verification → action. The agent layer is an extension of SPR, not a second trust database.</section>
  </div>;
}
