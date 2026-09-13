import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowRight, Bot, CheckCircle2, Clock3, Copy, ShieldCheck, Sparkles } from 'lucide-react';

const tools = [
  ['verify_software', 'Verify a Software Passport and its current evidence-backed status.'],
  ['get_passport', 'Retrieve the machine-readable public Passport.'],
  ['get_trust_evidence', 'Retrieve evidence supporting a trust determination.'],
  ['get_security_status', 'Return observed security evidence and status.'],
  ['get_compliance_status', 'Return only compliance claims supported by evidence.'],
  ['check_freshness', 'Check evidence freshness and staleness.'],
  ['verify_claim', 'Check a claim and return VERIFIED, CONTRADICTED, or UNVERIFIED.'],
] as const;

const agents = [
  { name: 'Trust Agent', status: 'LIVE', description: 'Answers software-trust questions from observed SPR evidence.', action: 'Verify software', icon: ShieldCheck },
  { name: 'Distribution Agent', status: 'LIVE', description: 'Discovers and researches potential MSP opportunities using evidence-first workflows.', action: 'Open distribution', icon: Activity },
  { name: 'Vendor Risk Agent', status: 'LIVE', description: 'Turns vendor evidence, findings, freshness and completeness into a deterministic operational review.', action: 'Run vendor risk review', icon: ShieldCheck },
  { name: 'Compliance Agent', status: 'NEXT', description: 'Will map observed evidence to supported controls and surface evidence gaps without inventing compliance.', action: 'Planned', icon: CheckCircle2 },
  { name: 'Monitoring Agent', status: 'NEXT', description: 'Will continuously watch passports and evidence for material changes and prepare alerts.', action: 'Planned', icon: Activity },
  { name: 'Report Agent', status: 'NEXT', description: 'Will turn verified evidence and findings into customer-ready reports.', action: 'Planned', icon: Copy },
  { name: 'Revenue Agent', status: 'NEXT', description: 'Will identify observable service opportunities an MSP can package and sell to clients.', action: 'Planned', icon: Sparkles },
] as const;

export default function AgentTrustView() {
  const [passport, setPassport] = useState('');
  const [claim, setClaim] = useState('');
  const [copied, setCopied] = useState(false);
  const [mcpAvailable, setMcpAvailable] = useState<boolean | null>(null);
  const [distributionStatus, setDistributionStatus] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/health').then(r => r.json()).then(d => { if (!cancelled) setMcpAvailable(Boolean(d?.mcpAvailable)); }).catch(() => { if (!cancelled) setMcpAvailable(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/founder/distribution/status', { credentials: 'include' }).then(async response => {
      if (!response.ok) return null;
      const data = await response.json().catch(() => null);
      if (!cancelled && data?.counts) setDistributionStatus(data.counts);
      return data;
    }).catch(() => null);
    return () => { cancelled = true; };
  }, []);

  const endpoint = useMemo(() => `${window.location.origin}/mcp`, []);
  const example = useMemo(() => JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'verify_software', arguments: { passport: passport || 'YOUR_SIGNED_PASSPORT' } } }, null, 2), [passport]);
  const copy = async (value: string) => { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1500); };

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
      <div className="mb-4 flex items-end justify-between gap-4"><div><h2 className="text-xl font-semibold">Agent workforce</h2><p className="mt-1 text-sm text-[var(--spr-text-muted)]">One SPR evidence layer. Specialized workers on top.</p></div><div className="text-xs text-[var(--spr-text-faint)]">Live means backed by current repository functionality; Next means intentionally not presented as active yet.</div></div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {agents.map(({ name, status, description, action, icon: Icon }) => <article key={name} className="spr-panel p-5">
          <div className="flex items-start justify-between gap-3"><div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-2"><Icon className="h-5 w-5" /></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[.16em] ${status === 'LIVE' ? 'bg-[var(--spr-green)]/15 text-[var(--spr-green)]' : 'bg-[var(--spr-surface-alt)] text-[var(--spr-text-faint)]'}`}>{status}</span></div>
          <h3 className="mt-5 font-semibold">{name}</h3><p className="mt-2 min-h-12 text-sm leading-5 text-[var(--spr-text-muted)]">{description}</p>
          <div className="mt-5 flex items-center gap-2 text-xs font-semibold text-[var(--spr-text-faint)]">{status === 'LIVE' ? <CheckCircle2 className="h-4 w-4 text-[var(--spr-green)]" /> : <Clock3 className="h-4 w-4" />}{action}</div>
        </article>)}
      </div>
    </section>

    <section className="grid gap-4 md:grid-cols-3">
      <div className="spr-panel p-5"><div className="text-xs font-semibold uppercase tracking-[.18em] text-[var(--spr-text-muted)]">Trust transport</div><div className="mt-2 text-xl font-semibold">MCP / JSON-RPC</div><div className="mt-1 text-xs text-[var(--spr-text-muted)]">Read-only agent surface</div></div>
      <div className="spr-panel p-5"><div className="text-xs font-semibold uppercase tracking-[.18em] text-[var(--spr-text-muted)]">Distribution jobs</div><div className="mt-2 text-xl font-semibold">{distributionStatus ? Object.values(distributionStatus).reduce((sum, value) => sum + value, 0) : 'Not verified'}</div><div className="mt-1 text-xs text-[var(--spr-text-muted)]">Only shown when the founder distribution endpoint authorizes this session.</div></div>
      <div className="spr-panel p-5"><div className="text-xs font-semibold uppercase tracking-[.18em] text-[var(--spr-text-muted)]">Evidence policy</div><div className="mt-2 text-xl font-semibold">Evidence first</div><div className="mt-1 text-xs text-[var(--spr-text-muted)]">Unknown remains unknown.</div></div>
    </section>

    <section className="spr-panel p-5"><div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-lg font-semibold">Agent tools</h2><p className="mt-1 text-sm text-[var(--spr-text-muted)]">External agents can use these read-only trust capabilities through MCP.</p></div><button onClick={() => void copy(endpoint)} className="spr-btn spr-btn-secondary inline-flex items-center gap-2"><Copy className="h-4 w-4" />{copied ? 'Copied' : 'Copy MCP endpoint'}</button></div><div className="mt-4 grid gap-3 md:grid-cols-2">{tools.map(([name, description]) => <div key={name} className="rounded-md border border-[var(--spr-border)] p-4"><div className="font-mono text-sm text-[var(--spr-highlight)]">{name}</div><p className="mt-1 text-sm text-[var(--spr-text-muted)]">{description}</p></div>)}</div></section>

    <section className="grid gap-5 lg:grid-cols-2">
      <div className="spr-panel p-5"><div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-[var(--spr-green)]" /><h2 className="text-lg font-semibold">Verify a Passport</h2></div><p className="mt-1 text-sm text-[var(--spr-text-muted)]">Prepare a machine-readable verification request for an external agent.</p><input value={passport} onChange={e => setPassport(e.target.value.slice(0, 512))} placeholder="Signed Passport token or URL" className="mt-4 w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-sm outline-none focus:border-[var(--spr-highlight)]" /><pre className="mt-4 max-h-64 overflow-auto rounded-md bg-[var(--spr-surface-sunken)] p-4 text-xs text-[var(--spr-text)]">{example}</pre><button onClick={() => void copy(example)} className="spr-btn spr-btn-primary mt-3 inline-flex items-center gap-2"><ArrowRight className="h-4 w-4" />{copied ? 'Copied' : 'Copy verification request'}</button></div>
      <div className="spr-panel p-5"><div className="flex items-center gap-2"><Bot className="h-5 w-5 text-[var(--spr-highlight)]" /><h2 className="text-lg font-semibold">Verify a claim</h2></div><p className="mt-1 text-sm text-[var(--spr-text-muted)]">SPR deliberately returns UNVERIFIED when observed evidence does not support the claim.</p><input value={claim} onChange={e => setClaim(e.target.value.slice(0, 2000))} placeholder="Example: this software has current security evidence" className="mt-4 w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-sm outline-none focus:border-[var(--spr-highlight)]" /><div className="mt-4 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4 text-sm text-[var(--spr-amber)]">Claim: {claim || 'Enter a claim to prepare an agent verification request.'}</div></div>
    </section>

    <section className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5 text-sm text-[var(--spr-text-muted)]"><strong className="text-[var(--spr-text)]">Architecture:</strong> Agent → SPR evidence → authoritative verification → action. The agent layer is an extension of SPR, not a second trust database.</section>
  </div>;
}
