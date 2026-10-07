import { useEffect, useState } from 'react';
import { Activity, RefreshCw, ShieldCheck, Swords } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

type Mission = {
  id: string;
  objective: string;
  state: 'UNKNOWN' | 'HOLD' | 'READY_FOR_EXECUTION';
  advisoryStrategyId: string | null;
  authorityLevel: 'NONE' | 'AGENT' | 'CONSTELLATION' | 'HUMAN';
  strategies: { id: string; label: string; probability: number | null }[];
  redTeamFindings: { id: string; severity: string; statement: string }[];
  shadowAssessment?: { advisoryReason?: string };
  updatedAt: string;
};

type Payload = {
  mode: 'SHADOW';
  missionCount: number;
  receiptCount: number;
  states: Record<string, number>;
  missions: Mission[];
  policy: string;
  generatedAt: string;
};

function percent(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 100)}%` : 'UNKNOWN';
}

export default function FounderQLegionPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
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

  return <section id="founder-q-legion" className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--spr-highlight)]"><Swords className="h-4 w-4" /> Q-LEGION</div>
        <h2 className="mt-2 text-lg font-semibold">Governed shadow swarm</h2>
        <p className="mt-1 max-w-3xl text-sm text-[var(--spr-text-muted)]">Competing commercial strategies over observed MSP research. Shadow mode can rank and red-team; it cannot send, buy, change pricing, or self-authorize.</p>
      </div>
      <div className="flex gap-2">
        <button type="button" className="spr-btn spr-btn-secondary" disabled={loading} onClick={() => void load()}><RefreshCw className={`mr-2 inline h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
        <button type="button" className="spr-btn spr-btn-primary" disabled={loading} onClick={() => void backfill()}>Build from observed prospects</button>
      </div>
    </div>

    {error && <div role="alert" className="mt-4 rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 p-3 text-sm text-[var(--spr-red)]">{error}</div>}

    <div className="mt-4 grid gap-3 sm:grid-cols-4">
      <div className="rounded-md border border-[var(--spr-border)] p-3"><span className="text-xs text-[var(--spr-text-muted)]">Mode</span><strong className="mt-1 block">SHADOW</strong></div>
      <div className="rounded-md border border-[var(--spr-border)] p-3"><span className="text-xs text-[var(--spr-text-muted)]">Missions</span><strong className="mt-1 block">{data?.missionCount ?? 'UNKNOWN'}</strong></div>
      <div className="rounded-md border border-[var(--spr-border)] p-3"><span className="text-xs text-[var(--spr-text-muted)]">Receipts</span><strong className="mt-1 block">{data?.receiptCount ?? 'UNKNOWN'}</strong></div>
      <div className="rounded-md border border-[var(--spr-border)] p-3"><span className="text-xs text-[var(--spr-text-muted)]">Execution authority</span><strong className="mt-1 block">NONE</strong></div>
    </div>

    <div className="mt-4 space-y-3">
      {(data?.missions ?? []).slice(0, 12).map((mission) => {
        const chosen = mission.strategies?.find((strategy) => strategy.id === mission.advisoryStrategyId);
        const blockers = (mission.redTeamFindings ?? []).filter((finding) => finding.severity === 'BLOCKER');
        return <article key={mission.id} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0"><strong className="block text-sm">{mission.objective}</strong><span className="mt-1 block text-xs text-[var(--spr-text-muted)]">Updated {new Date(mission.updatedAt).toLocaleString()}</span></div>
            <span className="rounded-full border border-[var(--spr-border)] px-2 py-1 text-xs font-semibold">{mission.state}</span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div><span className="text-xs text-[var(--spr-text-muted)]">Advisory winner</span><div className="mt-1 text-sm font-medium">{chosen?.label ?? 'UNKNOWN'}</div></div>
            <div><span className="text-xs text-[var(--spr-text-muted)]">Advisory probability</span><div className="mt-1 text-sm font-medium">{percent(chosen?.probability)}</div></div>
            <div><span className="text-xs text-[var(--spr-text-muted)]">Red-team blockers</span><div className="mt-1 text-sm font-medium">{blockers.length}</div></div>
          </div>
          <p className="mt-3 text-xs text-[var(--spr-text-muted)]">{mission.shadowAssessment?.advisoryReason ?? 'No shadow assessment recorded.'}</p>
        </article>;
      })}
      {data && data.missions.length === 0 && <div className="rounded-md border border-dashed border-[var(--spr-border)] p-5 text-sm text-[var(--spr-text-muted)]"><Activity className="mr-2 inline h-4 w-4" />No Q-LEGION missions are persisted yet. Build from observed prospects or wait for new research jobs.</div>}
    </div>

    <div className="mt-4 flex items-start gap-2 rounded-md border border-[var(--spr-border)] p-3 text-xs text-[var(--spr-text-muted)]"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><span>{data?.policy ?? 'Probabilities are advisory, not evidence. UNKNOWN remains UNKNOWN. No execution authority exists in shadow mode.'}</span></div>
  </section>;
}
