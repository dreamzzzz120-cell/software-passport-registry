import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, Bot, Bug, ChevronRight, Database, Globe2,
  CreditCard, Megaphone, Play, RefreshCw, ShieldCheck, Wrench,
} from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

type RepairTask = {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  clientId?: string | null;
  passportId?: string | null;
  collectorJobId?: string | null;
  verificationFailureReason?: string | null;
  updatedAt?: string | null;
};

type Campaign = {
  discoveryEnabled?: boolean;
  outreachEnabled?: boolean;
  dailySendCap?: number;
  followupDelayDays?: number;
  maxFollowups?: number;
};

type RealityIncident = {
  id: string;
  contractId: string;
  component: string;
  severity: string;
  status: string;
  rootCause?: string | null;
  repairClass?: number;
  repairAction?: string | null;
  lastSeenAt?: string | null;
};

type RealityData = {
  systemState?: { healthy?: number; degrading?: number; failed?: number; unknown?: number; activeIncidents?: number; observabilityCompromised?: boolean };
  incidents?: RealityIncident[];
};

type FounderBusinessMetrics = {
  organizationCount?: number | null;
  userCount?: number | null;
  mrrCents?: number | null;
  stripeCustomerCount?: number | null;
  activeSubscriptionCount?: number | null;
  successfulPaymentCount30d?: number | null;
  successfulPaymentAmount30dCents?: number | null;
};

type FounderCommand = {
  businessMetrics?: FounderBusinessMetrics;
  connections?: Array<{ key:string; name:string; status:'ok'|'error'|'not_configured'; detail?:string }>;
};

type BillingState = {
  billingConfigured?: boolean;
  billingConfigurationError?: string | null;
  subscription?: { plan?: string | null; status?: string | null; clientLimit?: number | null; currentPeriodEnd?: string | null };
  clientCount?: number;
  availablePlans?: string[];
  availableProducts?: string[];
  availableAddons?: string[];
};

type Growth = {
  settings?: Campaign;
  pipeline?: Record<string, number>;
  messages?: { sent?: number };
};

const STATUS_ORDER = ['OPEN','IN_PROGRESS','READY_FOR_VERIFICATION','VERIFICATION_QUEUED','VERIFYING','VERIFIED','CLOSED','BLOCKED','CANCELLED'];

function statusRank(status: string) {
  const i = STATUS_ORDER.indexOf(status);
  return i < 0 ? 99 : i;
}


function repairDecision(task: RepairTask) {
  if (task.status === 'OPEN') return {
    automation: 'SAFE TO START',
    why: task.description || 'SPR has an observed open finding with no completed remediation.',
    next: 'Start the remediation workflow. This does not claim the issue is fixed.',
    proof: 'Required before fixed',
  };
  if (task.status === 'IN_PROGRESS') return {
    automation: 'IN PROGRESS',
    why: task.description || 'A remediation task exists and is actively being worked.',
    next: 'When the repair action is actually complete, move it to evidence verification.',
    proof: 'Required before fixed',
  };
  if (task.status === 'READY_FOR_VERIFICATION') return {
    automation: 'NEEDS EVIDENCE',
    why: 'SPR will not convert a repair claim into a verified result without an enabled monitoring configuration.',
    next: 'Choose the matching monitoring evidence and queue verification.',
    proof: 'Collector evidence required',
  };
  if (task.status === 'VERIFICATION_QUEUED' || task.status === 'VERIFYING') return {
    automation: 'AUTOMATIC VERIFY',
    why: 'The repair is waiting on or running an evidence collector.',
    next: 'No manual success claim. Wait for the collector result or investigate a failed verification.',
    proof: 'Verification running',
  };
  if (task.status === 'BLOCKED') return {
    automation: 'NEEDS APPROVAL / INPUT',
    why: task.verificationFailureReason || 'SPR cannot safely complete this remediation automatically with the evidence currently available.',
    next: 'Investigate the blocker, supply the missing access/evidence, then retry.',
    proof: 'Still unverified',
  };
  return {
    automation: 'OBSERVE',
    why: task.verificationFailureReason || 'SPR is preserving the current workflow state.',
    next: 'Open the task details and inspect its evidence before changing state.',
    proof: 'State dependent',
  };
}

function badge(status: string) {
  if (status === 'VERIFIED' || status === 'CLOSED') return 'text-[var(--spr-green)]';
  if (status === 'BLOCKED' || status === 'CANCELLED') return 'text-[var(--spr-red)]';
  if (status === 'OPEN' || status === 'IN_PROGRESS' || status === 'READY_FOR_VERIFICATION') return 'text-[var(--spr-amber)]';
  return 'text-[var(--spr-text-muted)]';
}

export default function FounderControlPlane() {
  const [tasks, setTasks] = useState<RepairTask[]>([]);
  const [growth, setGrowth] = useState<Growth | null>(null);
  const [reality, setReality] = useState<RealityData | null>(null);
  const [command, setCommand] = useState<FounderCommand | null>(null);
  const [billing, setBilling] = useState<BillingState | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tasksRes, growthRes, realityRes, commandRes, billingRes] = await Promise.all([
        apiFetch('/api/remediation-tasks'),
        apiFetch('/api/founder/distribution/growth'),
        apiFetch('/api/founder/reality'),
        apiFetch('/api/founder/command-center'),
        apiFetch('/api/billing'),
      ]);
      if (!tasksRes.ok) throw new Error(`Repair queue unavailable (${tasksRes.status})`);
      const taskBody = await tasksRes.json().catch(() => []);
      setTasks(Array.isArray(taskBody) ? taskBody : []);
      if (growthRes.ok) setGrowth(await growthRes.json().catch(() => null));
      if (realityRes.ok) setReality(await realityRes.json().catch(() => null));
      if (commandRes.ok) setCommand(await commandRes.json().catch(() => null));
      if (billingRes.ok) setBilling(await billingRes.json().catch(() => null));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Founder control data could not be verified.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const activeRepairs = useMemo(
    () => tasks.filter((t) => !['VERIFIED','CLOSED','CANCELLED'].includes(t.status)).sort((a,b) => statusRank(a.status) - statusRank(b.status)),
    [tasks],
  );

  const runSafeRepair = async () => {
    setWorking('repair-all'); setNotice(null); setError(null);
    try {
      const bulk = await apiFetch('/api/remediation-tasks/bulk', { method: 'POST' });
      const body = await bulk.json().catch(() => null);
      if (!bulk.ok) throw new Error(body?.error || `Unable to create repair work (${bulk.status})`);
      const created = Array.isArray(body?.tasks) ? body.tasks : [];
      let started = 0;
      for (const item of created) {
        const start = await apiFetch(`/api/remediation-tasks/${encodeURIComponent(item.id)}/start`, { method: 'POST' });
        if (start.ok) started += 1;
      }
      setNotice(`Repair workflow opened ${body?.createdCount ?? 0} new task(s); ${started} started automatically. Nothing is marked fixed until verification succeeds.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start repair workflow.');
    } finally {
      setWorking(null);
    }
  };

  const advanceTask = async (task: RepairTask) => {
    const action = task.status === 'OPEN' ? 'start' : task.status === 'IN_PROGRESS' ? 'ready-for-verification' : null;
    if (!action) return;
    setWorking(task.id); setNotice(null); setError(null);
    try {
      const res = await apiFetch(`/api/remediation-tasks/${encodeURIComponent(task.id)}/${action}`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || `Repair action failed (${res.status})`);
      setNotice(task.status === 'OPEN' ? 'Repair task started.' : 'Repair marked ready for evidence verification.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to advance repair task.');
    } finally {
      setWorking(null);
    }
  };

  const repairIncident = async (incident: RealityIncident) => {
    setWorking(`incident:${incident.id}`); setNotice(null); setError(null);
    try {
      const res = await apiFetch(`/api/founder/reality/incidents/${encodeURIComponent(incident.id)}/repair`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message || body?.error || `Repair executor failed (${res.status})`);
      setNotice(`${incident.component}: ${body?.repair || 'repair accepted'} Verification is now required; SPR has not claimed success yet.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to execute incident repair.');
    } finally {
      setWorking(null);
    }
  };

  const saveCampaign = async (patch: Record<string, unknown>) => {
    setWorking('campaign'); setNotice(null); setError(null);
    try {
      const res = await apiFetch('/api/founder/distribution/campaign', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || `Campaign update failed (${res.status})`);
      setNotice('Campaign control updated and persisted.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update campaign.');
    } finally {
      setWorking(null);
    }
  };

  const settings = growth?.settings ?? {};
  const pipeline = growth?.pipeline ?? {};
  const incidents = Array.isArray(reality?.incidents) ? reality!.incidents!.filter((i) => !['PROVEN_FIXED','FAILED'].includes(i.status)) : [];
  const autoRepairable = (i: RealityIncident) => ['worker_queue_flow','scan_terminality'].includes(i.contractId);
  const metrics = command?.businessMetrics ?? {};
  const stripeConnection = command?.connections?.find((x) => x.key === 'stripe');
  const money = (cents?: number | null) => cents == null ? 'Not verified' : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(cents/100);

  return <section className="space-y-5 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-5" id="founder-control-plane">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[.22em] text-[var(--spr-highlight)]">Founder control plane</div>
        <h2 className="mt-1 text-2xl font-semibold text-[var(--spr-text)]">See it. Control it. Prove it.</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--spr-text-muted)]">
          One operating surface for repair, growth, distribution, traffic, registry, agents, infrastructure and evidence. Actions below use real SPR APIs; unavailable capabilities stay explicit instead of being simulated.
        </p>
      </div>
      <button onClick={() => void load()} disabled={loading} className="spr-btn spr-btn-secondary inline-flex items-center gap-2 text-xs">
        <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> Refresh controls
      </button>
    </div>

    {error && <div className="rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 p-3 text-sm text-[var(--spr-red)]">{error}</div>}
    {notice && <div className="rounded-md border border-[var(--spr-green)]/30 bg-[var(--spr-green)]/10 p-3 text-sm text-[var(--spr-text)]">{notice}</div>}

    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      <a href="#founder-repair" className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4 hover:border-[var(--spr-highlight)]">
        <Wrench className="h-5 w-5 text-[var(--spr-highlight)]" /><div className="mt-3 font-semibold text-[var(--spr-text)]">Repair system</div><div className="mt-1 text-xs text-[var(--spr-text-muted)]">{activeRepairs.length} active repair tasks</div>
      </a>
      <a href="#founder-growth" className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4 hover:border-[var(--spr-highlight)]">
        <Megaphone className="h-5 w-5 text-[var(--spr-highlight)]" /><div className="mt-3 font-semibold text-[var(--spr-text)]">Marketing & growth</div><div className="mt-1 text-xs text-[var(--spr-text-muted)]">{growth?.messages?.sent ?? 'Not verified'} observed messages sent</div>
      </a>
      <a href="#founder-connections" className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4 hover:border-[var(--spr-highlight)]">
        <Globe2 className="h-5 w-5 text-[var(--spr-highlight)]" /><div className="mt-3 font-semibold text-[var(--spr-text)]">Connections</div><div className="mt-1 text-xs text-[var(--spr-text-muted)]">Open every attached platform and its setup state</div>
      </a>
      <a href="#founder-agents" className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4 hover:border-[var(--spr-highlight)]">
        <Bot className="h-5 w-5 text-[var(--spr-highlight)]" /><div className="mt-3 font-semibold text-[var(--spr-text)]">Agents & automation</div><div className="mt-1 text-xs text-[var(--spr-text-muted)]">Inspect runtime state and automation evidence</div>
      </a>
      <a href="#founder-billing-control" className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4 hover:border-[var(--spr-highlight)]">
        <CreditCard className="h-5 w-5 text-[var(--spr-highlight)]" /><div className="mt-3 font-semibold text-[var(--spr-text)]">Billing & revenue</div><div className="mt-1 text-xs text-[var(--spr-text-muted)]">{money(metrics.mrrCents)} observed MRR</div>
      </a>
    </div>


    <div id="founder-billing-control" className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2"><CreditCard className="h-4 w-4 text-[var(--spr-highlight)]" /><h3 className="font-semibold text-[var(--spr-text)]">Billing & revenue control</h3></div>
          <p className="mt-1 text-xs text-[var(--spr-text-muted)]">Observed Stripe/business truth plus this workspace's plan state. Purchases and plan changes remain explicit customer-approved actions.</p>
        </div>
        <a href="/billing" className="spr-btn spr-btn-secondary text-xs">Open full billing</a>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded border border-[var(--spr-border)] bg-[var(--spr-surface)] p-3"><div className="text-[10px] uppercase tracking-wide text-[var(--spr-text-muted)]">MRR</div><div className="mt-1 text-lg font-semibold text-[var(--spr-text)]">{money(metrics.mrrCents)}</div></div>
        <div className="rounded border border-[var(--spr-border)] bg-[var(--spr-surface)] p-3"><div className="text-[10px] uppercase tracking-wide text-[var(--spr-text-muted)]">Active subscriptions</div><div className="mt-1 text-lg font-semibold text-[var(--spr-text)]">{metrics.activeSubscriptionCount ?? 'Not verified'}</div></div>
        <div className="rounded border border-[var(--spr-border)] bg-[var(--spr-surface)] p-3"><div className="text-[10px] uppercase tracking-wide text-[var(--spr-text-muted)]">30d successful payments</div><div className="mt-1 text-lg font-semibold text-[var(--spr-text)]">{metrics.successfulPaymentCount30d ?? 'Not verified'}</div><div className="text-xs text-[var(--spr-text-muted)]">{money(metrics.successfulPaymentAmount30dCents)}</div></div>
        <div className="rounded border border-[var(--spr-border)] bg-[var(--spr-surface)] p-3"><div className="text-[10px] uppercase tracking-wide text-[var(--spr-text-muted)]">Stripe connection</div><div className={`mt-1 text-sm font-semibold ${stripeConnection?.status === 'ok' ? 'text-[var(--spr-green)]' : stripeConnection?.status === 'error' ? 'text-[var(--spr-red)]' : 'text-[var(--spr-amber)]'}`}>{stripeConnection?.status ?? 'Not verified'}</div><div className="mt-1 text-xs text-[var(--spr-text-muted)]">{stripeConnection?.detail || 'No connection detail observed.'}</div></div>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className="rounded border border-[var(--spr-border)] bg-[var(--spr-surface)] p-3">
          <div className="text-xs font-semibold text-[var(--spr-text)]">This workspace</div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <div><span className="text-[var(--spr-text-muted)]">Plan</span><div className="font-medium text-[var(--spr-text)]">{billing?.subscription?.plan || 'No active plan observed'}</div></div>
            <div><span className="text-[var(--spr-text-muted)]">Status</span><div className="font-medium text-[var(--spr-text)]">{billing?.subscription?.status || 'Not verified'}</div></div>
            <div><span className="text-[var(--spr-text-muted)]">Clients</span><div className="font-medium text-[var(--spr-text)]">{billing?.clientCount ?? 'Not verified'} / {billing?.subscription?.clientLimit ?? 'Unlimited / not set'}</div></div>
            <div><span className="text-[var(--spr-text-muted)]">Period end</span><div className="font-medium text-[var(--spr-text)]">{billing?.subscription?.currentPeriodEnd ? new Date(billing.subscription.currentPeriodEnd).toLocaleDateString() : 'Not verified'}</div></div>
          </div>
        </div>
        <div className="rounded border border-[var(--spr-border)] bg-[var(--spr-surface)] p-3">
          <div className="text-xs font-semibold text-[var(--spr-text)]">Sellable catalogue</div>
          <div className="mt-2 text-xs text-[var(--spr-text-muted)]">Billing configured: <span className="font-semibold text-[var(--spr-text)]">{billing?.billingConfigured === true ? 'Yes' : billing?.billingConfigured === false ? 'No' : 'Not verified'}</span></div>
          {billing?.billingConfigurationError && <div className="mt-1 text-xs text-[var(--spr-red)]">{billing.billingConfigurationError}</div>}
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div className="rounded bg-[var(--spr-surface-alt)] p-2"><div className="text-lg font-semibold text-[var(--spr-text)]">{billing?.availablePlans?.length ?? '—'}</div><div className="text-[10px] text-[var(--spr-text-muted)]">plans</div></div>
            <div className="rounded bg-[var(--spr-surface-alt)] p-2"><div className="text-lg font-semibold text-[var(--spr-text)]">{billing?.availableProducts?.length ?? '—'}</div><div className="text-[10px] text-[var(--spr-text-muted)]">products</div></div>
            <div className="rounded bg-[var(--spr-surface-alt)] p-2"><div className="text-lg font-semibold text-[var(--spr-text)]">{billing?.availableAddons?.length ?? '—'}</div><div className="text-[10px] text-[var(--spr-text-muted)]">add-ons</div></div>
          </div>
        </div>
      </div>
    </div>

    <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[var(--spr-highlight)]" /><h3 className="font-semibold text-[var(--spr-text)]">Reality self-healing</h3></div>
          <p className="mt-1 text-xs text-[var(--spr-text-muted)]">Live incidents from SPR's reconciliation system. Safe executors repair bounded queue/scan failures; everything else stays approval-gated.</p>
        </div>
        <div className="text-xs text-[var(--spr-text-muted)]">
          {reality?.systemState ? `${reality.systemState.activeIncidents ?? incidents.length} active · ${reality.systemState.healthy ?? 0} healthy · ${reality.systemState.failed ?? 0} failed · ${reality.systemState.unknown ?? 0} unknown` : 'Reality state not verified'}
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {incidents.slice(0,20).map((incident) => <div key={incident.id} className="flex flex-col gap-3 rounded border border-[var(--spr-border)] bg-[var(--spr-surface)] p-3 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-[var(--spr-text)]">{incident.component}</span><span className="text-[10px] font-bold uppercase tracking-wide text-[var(--spr-amber)]">{incident.status}</span><span className="text-[10px] uppercase text-[var(--spr-text-muted)]">{incident.severity}</span></div>
            <div className="mt-1 text-xs text-[var(--spr-text-muted)]">{incident.rootCause || 'Root cause not yet proven.'}</div>
            <div className="mt-1 font-mono text-[10px] text-[var(--spr-text-faint)]">{incident.contractId} · {incident.id}</div>
          </div>
          {autoRepairable(incident)
            ? <button onClick={() => void repairIncident(incident)} disabled={working !== null} className="spr-btn spr-btn-primary text-xs">{working === `incident:${incident.id}` ? 'Repairing…' : 'Repair now'}</button>
            : <div className="max-w-xs text-xs text-[var(--spr-text-muted)]">Requires infrastructure/configuration access or approval. SPR will not auto-mutate this class.</div>}
        </div>)}
        {incidents.length === 0 && <div className="rounded border border-[var(--spr-border)] p-4 text-sm text-[var(--spr-text-muted)]">No active reality incidents are currently observed.</div>}
      </div>
    </div>

    <div id="founder-repair" className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2"><Bug className="h-4 w-4 text-[var(--spr-amber)]" /><h3 className="font-semibold text-[var(--spr-text)]">Repair command</h3></div>
          <p className="mt-1 text-xs text-[var(--spr-text-muted)]">Creates missing remediation work and starts what SPR can safely start. Verification remains a separate evidence-backed state.</p>
        </div>
        <button onClick={() => void runSafeRepair()} disabled={working !== null} className="spr-btn spr-btn-primary inline-flex items-center gap-2">
          <Play className="h-4 w-4" /> {working === 'repair-all' ? 'Starting…' : 'Fix what SPR can safely fix'}
        </button>
      </div>
      <div className="mt-4 overflow-x-auto rounded border border-[var(--spr-border)]">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-wide text-[var(--spr-text-muted)]"><th className="p-3">Issue / why</th><th className="p-3">State</th><th className="p-3">SPR decision</th><th className="p-3">Proof</th><th className="p-3 text-right">Action</th></tr></thead>
          <tbody>
            {activeRepairs.slice(0,25).map((task) => {
              const decision = repairDecision(task);
              return <tr key={task.id} className="border-t border-[var(--spr-border)] align-top">
                <td className="p-3 max-w-[26rem]"><div className="font-medium text-[var(--spr-text)]">{task.title}</div><div className="mt-1 text-xs leading-5 text-[var(--spr-text-muted)]">{decision.why}</div><div className="mt-1 font-mono text-[10px] text-[var(--spr-text-faint)]">{task.id}</div></td>
                <td className={`p-3 text-xs font-semibold ${badge(task.status)}`}><div>{task.status}</div><div className="mt-1 font-normal text-[10px] text-[var(--spr-text-muted)]">{task.updatedAt ? new Date(task.updatedAt).toLocaleString() : 'Not verified'}</div></td>
                <td className="p-3 max-w-[22rem]"><div className="text-[10px] font-bold uppercase tracking-wide text-[var(--spr-highlight)]">{decision.automation}</div><div className="mt-1 text-xs leading-5 text-[var(--spr-text-muted)]">{decision.next}</div></td>
                <td className="p-3 text-xs text-[var(--spr-text-muted)]">{decision.proof}</td>
                <td className="p-3 text-right">
                  {task.status === 'OPEN' || task.status === 'IN_PROGRESS' ? <button onClick={() => void advanceTask(task)} disabled={working !== null} className="spr-btn spr-btn-secondary text-xs">{task.status === 'OPEN' ? 'Start repair' : 'Send to verification'}</button> : <span className="text-xs text-[var(--spr-text-muted)]">{task.status === 'READY_FOR_VERIFICATION' ? 'Choose monitoring evidence to verify' : 'Awaiting system evidence'}</span>}
                </td>
              </tr>;
            })}
            {activeRepairs.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-sm text-[var(--spr-text-muted)]">No active remediation tasks are currently observed.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>

    <div id="founder-growth" className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4">
        <div className="flex items-center gap-2"><Megaphone className="h-4 w-4 text-[var(--spr-highlight)]" /><h3 className="font-semibold text-[var(--spr-text)]">Marketing & distribution controls</h3></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <button onClick={() => void saveCampaign({ discoveryEnabled: !settings.discoveryEnabled })} disabled={working !== null} className="spr-btn spr-btn-secondary justify-between">
            <span>Opportunity discovery</span><strong>{settings.discoveryEnabled ? 'ON' : 'OFF'}</strong>
          </button>
          <button onClick={() => void saveCampaign({ outreachEnabled: !settings.outreachEnabled })} disabled={working !== null} className="spr-btn spr-btn-secondary justify-between">
            <span>Outreach</span><strong>{settings.outreachEnabled ? 'ON' : 'OFF'}</strong>
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div><div className="text-[10px] uppercase text-[var(--spr-text-muted)]">Daily cap</div><div className="text-xl font-semibold">{settings.dailySendCap ?? '—'}</div></div>
          <div><div className="text-[10px] uppercase text-[var(--spr-text-muted)]">Follow-up days</div><div className="text-xl font-semibold">{settings.followupDelayDays ?? '—'}</div></div>
          <div><div className="text-[10px] uppercase text-[var(--spr-text-muted)]">Max follow-ups</div><div className="text-xl font-semibold">{settings.maxFollowups ?? '—'}</div></div>
          <div><div className="text-[10px] uppercase text-[var(--spr-text-muted)]">Sent</div><div className="text-xl font-semibold">{growth?.messages?.sent ?? '—'}</div></div>
        </div>
        <a href="#founder-growth-hub" className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-[var(--spr-highlight)]">Open full growth controls <ChevronRight className="h-3.5 w-3.5" /></a>
      </div>

      <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4">
        <div className="flex items-center gap-2"><Activity className="h-4 w-4 text-[var(--spr-highlight)]" /><h3 className="font-semibold text-[var(--spr-text)]">Pipeline command</h3></div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {['new','qualified','contacted','replied','demo','pilot','customer','lost'].map((stage) => <div key={stage} className="rounded border border-[var(--spr-border)] bg-[var(--spr-surface)] p-3"><div className="text-[10px] uppercase tracking-wide text-[var(--spr-text-muted)]">{stage}</div><div className="mt-1 text-xl font-bold text-[var(--spr-text)]">{pipeline[stage] ?? '—'}</div></div>)}
        </div>
      </div>
    </div>

    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <a href="#founder-pulse" className="flex items-center justify-between rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4 hover:border-[var(--spr-highlight)]"><span className="flex items-center gap-2"><Database className="h-4 w-4" />Infrastructure</span><ChevronRight className="h-4 w-4" /></a>
      <a href="#founder-traffic" className="flex items-center justify-between rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4 hover:border-[var(--spr-highlight)]"><span className="flex items-center gap-2"><Activity className="h-4 w-4" />Traffic</span><ChevronRight className="h-4 w-4" /></a>
      <a href="#founder-data-truth" className="flex items-center justify-between rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4 hover:border-[var(--spr-highlight)]"><span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" />Evidence truth</span><ChevronRight className="h-4 w-4" /></a>
      <a href="#founder-attention" className="flex items-center justify-between rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4 hover:border-[var(--spr-highlight)]"><span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Needs attention</span><ChevronRight className="h-4 w-4" /></a>
    </div>
  </section>;
}
