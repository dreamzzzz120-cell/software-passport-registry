import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bot, Cable, GitBranch, KeyRound, Network, ShieldCheck, TerminalSquare } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import type { SoftwarePassport } from '../types';

type Summary = {
  passportId: string;
  coverage: {
    agents: number;
    mcpServers: number;
    mcpTools: number;
    capabilities: number;
    boundaries: number;
    handoffs: number;
    unknownBoundaries: number;
    unverifiedHandoffs: number;
  };
  agents: Array<Record<string, unknown>>;
  boundaries: Array<Record<string, unknown>>;
  capabilities: Array<Record<string, unknown>>;
  mcpServers: Array<Record<string, unknown>>;
  mcpTools: Array<Record<string, unknown>>;
  handoffs: Array<Record<string, unknown>>;
  changes: Array<Record<string, unknown>>;
  snapshots: Array<Record<string, unknown>>;
};

const stateClass = (state: unknown) => {
  const value = String(state || 'UNKNOWN').toUpperCase();
  if (value === 'VERIFIED' || value === 'OBSERVED') return 'text-[var(--spr-green)]';
  if (value === 'UNVERIFIED') return 'text-[var(--spr-red)]';
  return 'text-[var(--spr-amber)]';
};

export default function AgentEvidencePanel({ passports }: { passports: SoftwarePassport[] }) {
  const [passportId, setPassportId] = useState(passports[0]?.id || '');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [state, setState] = useState<'idle'|'loading'|'ready'|'error'>('idle');

  useEffect(() => {
    if (!passportId && passports[0]?.id) setPassportId(passports[0].id);
  }, [passportId, passports]);

  useEffect(() => {
    if (!passportId) { setSummary(null); setState('idle'); return; }
    let cancelled = false;
    setState('loading');
    apiFetch(`/api/ai-trust/passports/${encodeURIComponent(passportId)}/agent-trust`)
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(String(data?.error || 'Unable to load agent evidence.'));
        if (!cancelled) { setSummary(data); setState('ready'); }
      })
      .catch(() => { if (!cancelled) { setSummary(null); setState('error'); } });
    return () => { cancelled = true; };
  }, [passportId]);

  const cards = useMemo(() => summary ? [
    ['Agents', summary.coverage.agents, Bot],
    ['MCP servers', summary.coverage.mcpServers, Cable],
    ['Capabilities', summary.coverage.capabilities, TerminalSquare],
    ['Trust boundaries', summary.coverage.boundaries, Network],
    ['Unknown boundaries', summary.coverage.unknownBoundaries, AlertTriangle],
    ['Unverified handoffs', summary.coverage.unverifiedHandoffs, GitBranch],
  ] as const : [], [summary]);

  return <section className="spr-panel p-5">
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.08em] text-[var(--spr-highlight)]"><ShieldCheck className="h-4 w-4" /> Agent evidence</div>
        <h2 className="mt-2 text-xl font-semibold text-[var(--spr-text)]">AI & Agent Trust</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--spr-text-muted)]">Evidence coverage for agents, MCP servers, capabilities and handoffs. A missing record stays UNKNOWN; this surface never converts model choice into a safety claim.</p>
      </div>
      <select value={passportId} onChange={(event) => setPassportId(event.target.value)} className="min-w-64 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-sm text-[var(--spr-text)]">
        {passports.map((passport) => <option key={passport.id} value={passport.id}>{passport.name} {passport.version ? `· ${passport.version}` : ''}</option>)}
      </select>
    </div>

    {!passportId && <div className="mt-5 rounded-md border border-[var(--spr-border)] p-4 text-sm text-[var(--spr-text-muted)]">No Passport is available to scope agent evidence.</div>}
    {state === 'loading' && <div className="mt-5 text-sm text-[var(--spr-text-muted)]">Loading observed agent evidence…</div>}
    {state === 'error' && <div className="mt-5 rounded-md border border-[var(--spr-red)]/30 bg-[var(--spr-red)]/10 p-4 text-sm text-[var(--spr-red)]">Agent evidence could not be read. Nothing is being shown as empty or verified.</div>}

    {summary && <div className="mt-5 space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(([label, value, Icon]) => <div key={label} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-4"><div className="flex items-center gap-2 text-xs text-[var(--spr-text-muted)]"><Icon className="h-4 w-4" /> {label}</div><div className="mt-2 text-2xl font-semibold text-[var(--spr-text)]">{value}</div></div>)}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-md border border-[var(--spr-border)] p-4">
          <h3 className="text-sm font-semibold text-[var(--spr-text)]">Observed architecture</h3>
          <div className="mt-3 space-y-2">
            {summary.agents.map((agent: any) => <div key={String(agent.id)} className="rounded-md bg-[var(--spr-surface-deep)] p-3 text-xs"><div className="flex items-center justify-between gap-3"><span className="font-semibold text-[var(--spr-text)]">{String(agent.name)}</span><span className={stateClass(agent.observation_state)}>{String(agent.observation_state || 'UNKNOWN')}</span></div><div className="mt-1 text-[var(--spr-text-muted)]">{String(agent.agent_type || 'unknown')} · {String(agent.provider || 'provider unknown')} · {String(agent.model_family || 'model unknown')} {agent.model_version ? `· ${agent.model_version}` : ''}</div></div>)}
            {summary.agents.length === 0 && <p className="text-xs text-[var(--spr-text-muted)]">No agent assets have been observed for this Passport yet.</p>}
          </div>
        </div>

        <div className="rounded-md border border-[var(--spr-border)] p-4">
          <h3 className="text-sm font-semibold text-[var(--spr-text)]">Trust boundaries</h3>
          <div className="mt-3 space-y-2">
            {summary.boundaries.map((boundary: any) => <div key={String(boundary.id)} className="rounded-md bg-[var(--spr-surface-deep)] p-3 text-xs"><div className="flex items-center justify-between gap-3"><span className="font-semibold text-[var(--spr-text)]">{String(boundary.boundary_type)}</span><span className={stateClass(boundary.state)}>{String(boundary.state || 'UNKNOWN')}</span></div><div className="mt-1 text-[var(--spr-text-muted)]">{String(boundary.transport || 'transport unknown')} · verification {boundary.verification_present === true ? 'observed' : boundary.verification_present === false ? 'not observed' : 'UNKNOWN'}</div></div>)}
            {summary.boundaries.length === 0 && <p className="text-xs text-[var(--spr-text-muted)]">No trust-boundary evidence has been recorded. This is UNKNOWN, not a pass.</p>}
          </div>
        </div>
      </div>

      <div className="rounded-md border border-[var(--spr-border)] p-4">
        <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-[var(--spr-text)]">Observed changes</h3><span className="text-xs text-[var(--spr-text-faint)]">{summary.snapshots.length} snapshots</span></div>
        <div className="mt-3 space-y-2">
          {summary.changes.slice(0, 12).map((change: any) => <div key={String(change.id)} className="rounded-md bg-[var(--spr-surface-deep)] p-3 text-xs"><div className="flex items-center justify-between gap-3"><span className="font-semibold text-[var(--spr-text)]">{String(change.change_type).replaceAll('_', ' ')}</span><span className="text-[var(--spr-text-faint)]">{change.observed_at ? new Date(String(change.observed_at)).toLocaleString() : ''}</span></div><div className="mt-1 break-all text-[var(--spr-text-muted)]">{String(change.subject)}</div></div>)}
          {summary.changes.length === 0 && <p className="text-xs text-[var(--spr-text-muted)]">No change has been proven between settled agent-trust snapshots yet.</p>}
        </div>
      </div>

      <div className="rounded-md border border-[var(--spr-amber)]/30 bg-[var(--spr-amber)]/10 p-4 text-xs leading-5 text-[var(--spr-text-muted)]">
        <div className="flex items-center gap-2 font-semibold text-[var(--spr-amber)]"><KeyRound className="h-4 w-4" /> Evidence rule</div>
        <p className="mt-1">Agent output, MCP output and worker summaries are evidence inputs, not authority. Authorization and execution remain outside this evidence surface.</p>
      </div>
    </div>}
  </section>;
}
