import { useEffect, useState } from 'react';
import { Activity, RefreshCw, ShieldCheck, Swords, Trophy } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

type Outcome = {
  sent: number;
  replied: number;
  demos: number;
  checkouts: number;
  pilots: number;
  customers: number;
  lost: number;
  firstSentAt: string | null;
  lastOutcomeAt: string | null;
};

type Mission = {
  id: string;
  objective: string;
  mode: 'SHADOW' | 'ACTIVE';
  state: 'UNKNOWN' | 'HOLD' | 'READY_FOR_EXECUTION';
  advisoryStrategyId: string | null;
  authorityLevel: 'NONE' | 'AGENT' | 'CONSTELLATION' | 'HUMAN';
  evidence: { id: string; state: string; observedAt: string | null; source: string }[];
  strategies: { id: string; label: string; probability: number | null; hypothesis?: string }[];
  redTeamFindings: { id: string; severity: string; statement: string }[];
  shadowAssessment?: { advisoryReason?: string };
  outcome: Outcome;
  recommendedNextMove: string;
  updatedAt: string;
};

type StrategyPerformance = {
  strategyId: string;
  missions: number;
  sent: number;
  replied: number;
  demos: number;
  checkouts: number;
  customers: number;
  lost: number;
  avgProbability: number | null;
  replyRate: number | null;
  demoRate: number | null;
  checkoutRate: number | null;
  customerRate: number | null;
};

type Payload = {
  mode: 'SHADOW' | 'ACTIVE_GUIDANCE';
  strategyExecutionEnabled: boolean;
  missionCount: number;
  receiptCount: number;
  states: Record<string, number>;
  totals: { sent: number; replied: number; demos: number; checkouts: number; customers: number; lost: number };
  strategyPerformance: StrategyPerformance[];
  missions: Mission[];
  policy: string;
  generatedAt: string;
};

const strategyNames: Record<string, string> = {
  proof_first: 'Proof-first',
  revenue_first: 'Recurring revenue',
  compliance_first: 'Compliance evidence',
  baseline: 'Baseline',
  unknown: 'UNKNOWN',
};

function percent(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 100)}%` : 'UNKNOWN';
}

function num(value: unknown) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

export default function FounderQLegionPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await apiFetch('/api/founder/q-legion');
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || `Q-LEGION request failed (${res.status})`);
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Q-LEGION request failed');
    } finally {
      setLoading(false);
    }
  };

  const backfill = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/founder/q-legion/shadow/backfill', { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok && res.status !== 207) throw new Error(body?.error || `Q-LEGION backfill failed (${res.status})`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Q-LEGION backfill failed');
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const totals = data?.totals;
  const ranked = [...(data?.strategyPerformance ?? [])].sort((a, b) => {
    const aScore = a.customerRate ?? a.checkoutRate ?? a.demoRate ?? a.replyRate ?? -1;
    const bScore = b.customerRate ?? b.checkoutRate ?? b.demoRate ?? b.replyRate ?? -1;
    return bScore - aScore || b.sent - a.sent || a.strategyId.localeCompare(b.strategyId);
  });

  return <section id="founder-q-legion" className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--spr-highlight)]"><Swords className="h-4 w-4" /> Q-LEGION Command Center</div>
        <h2 className="mt-2 text-xl font-semibold">Strategy → outreach → outcome</h2>
        <p className="mt-1 max-w-4xl text-sm text-[var(--spr-text-muted)]">
          Q-LEGION ranks competing MSP approaches, attacks weak evidence, and attributes downstream results to the strategy actually used. SPR Distribution remains the bounded sender.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <span className="rounded-full border border-[var(--spr-border)] px-3 py-2 text-xs font-semibold">{data?.mode ?? 'UNKNOWN'}</span>
        <button type="button" className="spr-btn spr-btn-secondary" disabled={loading} onClick={() => void load()}><RefreshCw className={`mr-2 inline h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
        <button type="button" className="spr-btn spr-btn-primary" disabled={loading || !data} onClick={() => void backfill()}>Rebuild observed missions</button>
      </div>
    </div>

    {error && <div role="alert" className="mt-4 rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 p-3 text-sm text-[var(--spr-red)]">{error}</div>}

    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-8">
      {[
        ['Missions', data?.missionCount ?? 'UNKNOWN'],
        ['Receipts', data?.receiptCount ?? 'UNKNOWN'],
        ['Sent', totals?.sent ?? 'UNKNOWN'],
        ['Replies', totals?.replied ?? 'UNKNOWN'],
        ['Demos', totals?.demos ?? 'UNKNOWN'],
        ['Checkouts', totals?.checkouts ?? 'UNKNOWN'],
        ['Customers', totals?.customers ?? 'UNKNOWN'],
        ['Lost', totals?.lost ?? 'UNKNOWN'],
      ].map(([label, value]) => <div key={String(label)} className="rounded-md border border-[var(--spr-border)] p-3">
        <span className="text-xs text-[var(--spr-text-muted)]">{label}</span>
        <strong className="mt-1 block text-lg">{value}</strong>
      </div>)}
    </div>

    <div className="mt-5 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4">
      <div className="flex items-center gap-2">
        <Trophy className="h-4 w-4 text-[var(--spr-highlight)]" />
        <h3 className="font-semibold">Strategy leaderboard</h3>
      </div>
      <p className="mt-1 text-xs text-[var(--spr-text-muted)]">Rates are calculated only from observed attributed sends. Zero data stays zero/UNKNOWN; Q-LEGION does not manufacture a winner.</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="text-[var(--spr-text-muted)]">
            <tr className="border-b border-[var(--spr-border)]">
              <th className="py-2 pr-3">Strategy</th><th className="py-2 pr-3">Missions</th><th className="py-2 pr-3">Sent</th>
              <th className="py-2 pr-3">Reply</th><th className="py-2 pr-3">Demo</th><th className="py-2 pr-3">Checkout</th>
              <th className="py-2 pr-3">Customer</th><th className="py-2 pr-3">Lost</th><th className="py-2">Model probability</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((item, index) => <tr key={item.strategyId} className="border-b border-[var(--spr-border)]/60">
              <td className="py-2 pr-3 font-medium">{index === 0 && item.sent > 0 ? '★ ' : ''}{strategyNames[item.strategyId] ?? item.strategyId}</td>
              <td className="py-2 pr-3">{item.missions}</td><td className="py-2 pr-3">{item.sent}</td>
              <td className="py-2 pr-3">{item.replied} · {percent(item.replyRate)}</td>
              <td className="py-2 pr-3">{item.demos} · {percent(item.demoRate)}</td>
              <td className="py-2 pr-3">{item.checkouts} · {percent(item.checkoutRate)}</td>
              <td className="py-2 pr-3">{item.customers} · {percent(item.customerRate)}</td>
              <td className="py-2 pr-3">{item.lost}</td><td className="py-2">{percent(item.avgProbability)}</td>
            </tr>)}
            {ranked.length === 0 && <tr><td colSpan={9} className="py-4 text-[var(--spr-text-muted)]">{data ? 'No attributed outreach has been observed yet.' : 'Strategy outcomes are unavailable until Q-LEGION data loads.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>

    <div className="mt-5 space-y-3">
      {(data?.missions ?? []).slice(0, 30).map((mission) => {
        const chosen = mission.strategies?.find((strategy) => strategy.id === mission.advisoryStrategyId);
        const blockers = (mission.redTeamFindings ?? []).filter((finding) => finding.severity === 'BLOCKER');
        const evidenceStates = Object.entries((mission.evidence ?? []).reduce((acc: Record<string, number>, item) => {
          acc[item.state] = (acc[item.state] ?? 0) + 1;
          return acc;
        }, {}));
        return <article key={mission.id} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <strong className="block text-sm">{mission.objective}</strong>
              <span className="mt-1 block text-xs text-[var(--spr-text-muted)]">Updated {new Date(mission.updatedAt).toLocaleString()} · {mission.mode}</span>
            </div>
            <span className="rounded-full border border-[var(--spr-border)] px-2 py-1 text-xs font-semibold">{mission.state}</span>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <div><span className="text-xs text-[var(--spr-text-muted)]">Chosen strategy</span><div className="mt-1 text-sm font-medium">{chosen?.label ?? 'UNKNOWN'}</div></div>
            <div><span className="text-xs text-[var(--spr-text-muted)]">Advisory probability</span><div className="mt-1 text-sm font-medium">{percent(chosen?.probability)}</div></div>
            <div><span className="text-xs text-[var(--spr-text-muted)]">Red-team blockers</span><div className="mt-1 text-sm font-medium">{blockers.length}</div></div>
            <div><span className="text-xs text-[var(--spr-text-muted)]">Observed evidence</span><div className="mt-1 text-sm font-medium">{evidenceStates.length ? evidenceStates.map(([state,count]) => `${state} ${count}`).join(' · ') : 'UNKNOWN'}</div></div>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-7">
            {[
              ['Sent', num(mission.outcome?.sent)], ['Reply', num(mission.outcome?.replied)], ['Demo', num(mission.outcome?.demos)],
              ['Checkout', num(mission.outcome?.checkouts)], ['Pilot', num(mission.outcome?.pilots)], ['Customer', num(mission.outcome?.customers)], ['Lost', num(mission.outcome?.lost)],
            ].map(([label,value]) => <div key={String(label)} className="rounded border border-[var(--spr-border)] px-2 py-2">
              <span className="block text-[10px] uppercase tracking-[0.12em] text-[var(--spr-text-muted)]">{label}</span>
              <strong className="text-sm">{value}</strong>
            </div>)}
          </div>

          {blockers.length > 0 && <div className="mt-3 rounded-md border border-[var(--spr-red)]/30 bg-[var(--spr-red)]/10 p-3 text-xs">
            {blockers.map((finding) => <div key={finding.id}><strong>BLOCKER:</strong> {finding.statement}</div>)}
          </div>}

          <div className="mt-3 rounded-md border border-[var(--spr-border)] p-3">
            <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--spr-text-muted)]">Next best move</span>
            <p className="mt-1 text-sm font-medium">{mission.recommendedNextMove}</p>
          </div>
        </article>;
      })}
      {data && data.missions.length === 0 && <div className="rounded-md border border-dashed border-[var(--spr-border)] p-5 text-sm text-[var(--spr-text-muted)]"><Activity className="mr-2 inline h-4 w-4" />No Q-LEGION missions are persisted yet.</div>}
    </div>

    <div className="mt-4 flex items-start gap-2 rounded-md border border-[var(--spr-border)] p-3 text-xs text-[var(--spr-text-muted)]">
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{data?.policy ?? 'Probabilities are advisory, not evidence. UNKNOWN remains UNKNOWN.'}</span>
    </div>
  </section>;
}
