import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowRight, Bot, BriefcaseBusiness, CheckCircle2,
  ChevronRight, Clock3, DollarSign, FileCheck2, Gauge, Layers3, Radar,
  RefreshCw, ShieldAlert, ShieldCheck, Sparkles, Target, TrendingUp, Users,
  Workflow, XCircle
} from 'lucide-react';
import type { Alert, Client, SoftwarePassport } from '../types';
import type { VerificationDecisionState } from './trust/TrustStateBadge';
import MSPCommandCenter from './MSPCommandCenter';
import { apiFetch } from '../utils/apiClient';

interface Props {
  clients: Client[];
  alerts: Alert[];
  passports: SoftwarePassport[];
  role?: string;
  onSelectClient: (id: string) => void;
  onSelectPassport?: (id: string) => void;
  onNavigate: (tab: string) => void;
  verificationDecisions?: Record<string, VerificationDecisionState>;
  dataStatus?: 'loading' | 'ready' | 'error';
  onRetry?: () => void;
}

type Action = {
  id: string;
  title: string;
  detail: string;
  tone: 'critical' | 'warning' | 'opportunity' | 'healthy';
  icon: React.ReactNode;
  action: string;
  onClick: () => void;
};

const pct = (n: number | null) => n === null ? 'Not verified' : `${n}%`;

export default function MSPOperationsCommandCenter(props: Props) {
  const {
    clients, alerts, passports, verificationDecisions = {}, role = 'Viewer',
    onSelectClient, onSelectPassport, onNavigate, dataStatus = 'ready', onRetry
  } = props;
  const [showAllActions, setShowAllActions] = useState(false);
  const [revenueResults, setRevenueResults] = useState<any[]>([]);
  const [revenueLoading, setRevenueLoading] = useState(false);
  const [opportunityAction, setOpportunityAction] = useState<string | null>(null);
  const [opportunityMessage, setOpportunityMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!passports.length) { setRevenueResults([]); return; }
    setRevenueLoading(true);
    Promise.all(passports.slice(0, 100).map(async passport => {
      const response = await apiFetch('/api/agent/v1/revenue-opportunities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passportId: passport.id, catalog: {} }) });
      if (!response.ok) return null;
      return response.json();
    })).then(rows => { if (!cancelled) setRevenueResults(rows.filter(Boolean)); }).catch(() => { if (!cancelled) setRevenueResults([]); }).finally(() => { if (!cancelled) setRevenueLoading(false); });
    return () => { cancelled = true; };
  }, [passports]);

  const evidenceBackedOpportunities = useMemo(() => revenueResults.flatMap(result => (result.opportunities || []).map((opportunity: any) => ({ ...opportunity, passport: result.passport, clientId: result.clientId, observation: result.latestObservation }))), [revenueResults]);

  const startOpportunityWork = async (opportunity: any) => {
    const findingId = opportunity.findingIds?.[0];
    if (!findingId) { setOpportunityMessage('This opportunity has no remediation finding yet. Open the passport to collect or review the missing proof.'); if (opportunity.passport?.id) onSelectPassport?.(opportunity.passport.id); onNavigate('/passports'); return; }
    const key = String(opportunity.passport?.id || 'passport') + ':' + String(findingId); setOpportunityAction(key); setOpportunityMessage(null);
    try { const response = await apiFetch('/api/remediation-tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alertId: findingId }) }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body?.error || 'SPR could not create the remediation task.'); setOpportunityMessage(response.status === 201 ? 'Remediation task created. Work the task, then queue re-verification.' : 'An active remediation task already exists; SPR did not create a duplicate.'); onNavigate('/monitoring'); }
    catch (cause: any) { setOpportunityMessage(cause?.message || 'SPR could not create the remediation task.'); } finally { setOpportunityAction(null); }
  };

  const portfolio = useMemo(() => {
    const activeAlerts = alerts.filter(a => !['Resolved', 'Cancelled'].includes(a.status));
    const critical = activeAlerts.filter(a => a.severity === 'Critical').length;
    const high = activeAlerts.filter(a => a.severity === 'High').length;
    const verified = passports.filter(p => verificationDecisions[p.id] === 'VERIFIED').length;
    const review = passports.filter(p => ['PARTIAL', 'INVESTIGATE'].includes(verificationDecisions[p.id] || '')).length;
    const unknown = Math.max(0, passports.length - verified - review);
    const fresh = passports.filter(p => {
      const times = (p.evidence || []).map(e => e?.timestamp ? Date.parse(e.timestamp) : NaN).filter(Number.isFinite);
      return times.length > 0 && Date.now() - Math.max(...times) <= 30 * 86400000;
    }).length;
    const coverage = passports.length ? Math.round((verified / passports.length) * 100) : null;
    const freshness = passports.length ? Math.round((fresh / passports.length) * 100) : null;
    const monitored = passports.filter(p => (p.timeline || []).some(t => /monitor|verif/i.test(t?.event || ''))).length;
    return { activeAlerts, critical, high, verified, review, unknown, fresh, coverage, freshness, monitored };
  }, [alerts, passports, verificationDecisions]);

  const clientRows = useMemo(() => clients.map(client => {
    const clientAlerts = portfolio.activeAlerts.filter(a => a.clientName === client.name);
    const software = client.softwareInventory || [];
    const verified = software.filter(s => verificationDecisions[s.passportId] === 'VERIFIED').length;
    const unknown = software.filter(s => !verificationDecisions[s.passportId]).length;
    const critical = clientAlerts.filter(a => a.severity === 'Critical').length;
    const score = software.length ? Math.round((verified / software.length) * 100) : null;
    return { client, clientAlerts, software, verified, unknown, critical, score };
  }).sort((a, b) => b.critical - a.critical || b.clientAlerts.length - a.clientAlerts.length), [clients, portfolio.activeAlerts, verificationDecisions]);

  const actions = useMemo<Action[]>(() => {
    const result: Action[] = [];
    const criticalClient = clientRows.find(r => r.critical > 0);
    if (criticalClient) result.push({
      id: 'critical', title: `${criticalClient.client.name} needs attention`,
      detail: `${criticalClient.critical} critical finding${criticalClient.critical === 1 ? '' : 's'} are currently active.`,
      tone: 'critical', icon: <ShieldAlert className="h-4 w-4" />, action: 'Open client',
      onClick: () => { onSelectClient(criticalClient.client.id); onNavigate('/clients'); }
    });
    const stale = passports.filter(p => {
      const times = (p.evidence || []).map(e => e?.timestamp ? Date.parse(e.timestamp) : NaN).filter(Number.isFinite);
      return !times.length || Date.now() - Math.max(...times) > 30 * 86400000;
    })[0];
    if (stale) result.push({
      id: 'freshness', title: `${stale.name} has a freshness gap`,
      detail: 'Evidence is missing or older than the 30-day freshness window used by this workspace.',
      tone: 'warning', icon: <Clock3 className="h-4 w-4" />, action: 'Open passport',
      onClick: () => { onSelectPassport?.(stale.id); onNavigate('/passports'); }
    });
    const unverifiedClient = clientRows.find(r => r.unknown > 0);
    if (unverifiedClient) result.push({
      id: 'unknown', title: `${unverifiedClient.client.name} has unknown software trust`,
      detail: `${unverifiedClient.unknown} software item${unverifiedClient.unknown === 1 ? '' : 's'} have no authoritative verification decision.`,
      tone: 'warning', icon: <Radar className="h-4 w-4" />, action: 'Review software',
      onClick: () => onNavigate('/passports')
    });
    if (portfolio.activeAlerts.length === 0 && clients.length > 0) result.push({
      id: 'service', title: 'Portfolio is quiet — turn coverage into service',
      detail: 'No active alerts are recorded. Review monitoring coverage and client service opportunities.',
      tone: 'opportunity', icon: <TrendingUp className="h-4 w-4" />, action: 'Open monitoring',
      onClick: () => onNavigate('/monitoring')
    });
    if (passports.length === 0) result.push({
      id: 'start', title: 'Start the first software passport',
      detail: 'No passport records are currently available to this workspace.',
      tone: 'opportunity', icon: <Layers3 className="h-4 w-4" />, action: 'Add software',
      onClick: () => onNavigate('/passports')
    });
    return result;
  }, [clientRows, clients.length, onNavigate, onSelectClient, onSelectPassport, passports, portfolio.activeAlerts]);

  const serviceSignals = useMemo(() => {
    const clientsWithoutSoftware = clients.filter(c => !(c.softwareInventory || []).length).length;
    const unverified = portfolio.unknown;
    const stale = Math.max(0, passports.length - portfolio.fresh);
    const monitoringGap = Math.max(0, passports.length - portfolio.monitored);
    return [
      { label: 'Clients without software coverage', value: clientsWithoutSoftware, description: 'Observed client records with no linked software inventory.', icon: <Users /> },
      { label: 'Unknown trust decisions', value: unverified, description: 'Passport records without VERIFIED/PARTIAL/INVESTIGATE decisions.', icon: <ShieldAlert /> },
      { label: 'Freshness gaps', value: stale, description: 'Passport records with missing or older evidence.', icon: <Clock3 /> },
      { label: 'Monitoring gap', value: monitoringGap, description: 'Passport records without an observed monitoring/verifier timeline event.', icon: <Activity /> },
    ];
  }, [clients, passports, portfolio]);


  return (
    <div className="mx-auto max-w-[1500px] space-y-6 pb-16" id="msp-operations-command-center">
      <section className="overflow-hidden rounded-[30px] border border-[var(--spr-border)] bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,.12),transparent_38%),var(--spr-surface-alt)] p-6 md:p-8">
        <div className="flex flex-col gap-7 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.24em] text-[var(--spr-highlight)]">
              <Sparkles className="h-4 w-4" /> MSP operating system
            </div>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-[var(--spr-text)] md:text-5xl">
              Run the client portfolio from one trust control plane.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--spr-text-muted)]">
              SPR turns software evidence into client work: detect change, expose gaps, prioritize risk, assign action, verify remediation, and surface service opportunities — without inventing evidence.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:min-w-[560px]">
            <Kpi label="Clients" value={clients.length.toLocaleString()} icon={<Users />} />
            <Kpi label="Software" value={passports.length.toLocaleString()} icon={<Layers3 />} />
            <Kpi label="Verified" value={pct(portfolio.coverage)} icon={<ShieldCheck />} />
            <Kpi label="Active risk" value={portfolio.activeAlerts.length.toLocaleString()} icon={<AlertTriangle />} danger={portfolio.critical > 0} />
          </div>
        </div>
        <div className="mt-7 flex flex-wrap gap-2">
          <ActionButton icon={<Users />} label="Client portfolio" onClick={() => onNavigate('/clients')} />
          <ActionButton icon={<Layers3 />} label="Software coverage" onClick={() => onNavigate('/passports')} />
          <ActionButton icon={<Activity />} label="Continuous verification" onClick={() => onNavigate('/monitoring')} />
          <ActionButton icon={<FileCheck2 />} label="Reports & exports" onClick={() => onNavigate('/reports')} />
          <ActionButton icon={<BriefcaseBusiness />} label="Billing & service" onClick={() => onNavigate('/billing')} />
          {onRetry && <button onClick={onRetry} className="inline-flex items-center gap-2 rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface)] px-3 py-2 text-xs font-semibold text-[var(--spr-text-muted)] hover:text-[var(--spr-text)]"><RefreshCw className="h-3.5 w-3.5" /> Refresh truth</button>}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SignalCard title="Trust coverage" value={pct(portfolio.coverage)} sub={`${portfolio.verified} verified · ${portfolio.review} review · ${portfolio.unknown} unknown`} icon={<Gauge />} />
        <SignalCard title="Evidence freshness" value={pct(portfolio.freshness)} sub={`${portfolio.fresh} fresh · ${Math.max(0, passports.length - portfolio.fresh)} gap`} icon={<Clock3 />} />
        <SignalCard title="Critical exposure" value={portfolio.critical.toLocaleString()} sub={`${portfolio.high} high · ${portfolio.activeAlerts.length} active alerts`} icon={<ShieldAlert />} danger={portfolio.critical > 0} />
        <SignalCard title="Evidence-backed opportunities" value={revenueLoading ? "Loading…" : evidenceBackedOpportunities.length.toLocaleString()} sub="Derived by Revenue Engine v2; no assumed price or booked revenue" icon={<DollarSign />} />
      </section>

      <section className="rounded-[26px] border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5 md:p-6" id="revenue-opportunities">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.18em] text-[var(--spr-highlight)]"><DollarSign className="h-4 w-4" /> Revenue opportunities</div><h2 className="mt-2 text-xl font-bold text-[var(--spr-text)]">Turn observed trust gaps into defensible client work.</h2><p className="mt-1 text-xs leading-5 text-[var(--spr-text-muted)]">Every item below comes from persisted SPR evidence, findings, UNKNOWN state, freshness, or monitoring configuration. Price is never assumed.</p></div>
          <button onClick={() => onNavigate('/billing')} className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--spr-highlight)]">Configure service pricing <ArrowRight className="h-3.5 w-3.5" /></button>
        </div>
        <div className="mt-4 space-y-2">
          {opportunityMessage && <div role="status" className="rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface)] px-4 py-3 text-xs text-[var(--spr-text-muted)]">{opportunityMessage}</div>}
          {revenueLoading && <div className="h-24 animate-pulse rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface)]" />}
          {!revenueLoading && evidenceBackedOpportunities.length === 0 && <Empty icon={<CheckCircle2 />} title="No evidence-backed opportunities found" detail="SPR will not manufacture client work when persisted trust state does not support it." />}
          {!revenueLoading && evidenceBackedOpportunities.slice(0, 12).map((opportunity: any, index: number) => (
            <div key={`${opportunity.passport?.id || 'passport'}-${opportunity.service}-${index}`} className="flex w-full flex-col gap-3 rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface)] p-4 text-left md:flex-row md:items-center">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--spr-accent-soft)] text-[var(--spr-highlight)]"><BriefcaseBusiness className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold text-[var(--spr-text)]">{opportunity.service}</span><span className="rounded-full border border-[var(--spr-border)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--spr-text-faint)]">{opportunity.basis}</span><span className="rounded-full border border-[var(--spr-border)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--spr-text-faint)]">{opportunity.urgency}</span></span><span className="mt-1 block text-xs text-[var(--spr-text-muted)]">{opportunity.passport?.name}: {opportunity.trigger}</span><span className="mt-1 block text-[11px] text-[var(--spr-text-faint)]">{opportunity.evidenceIds?.length || 0} evidence · {opportunity.findingIds?.length || 0} findings · {opportunity.unknowns?.length || 0} unknowns</span></span>
              <span className="shrink-0 text-right"><span className="block text-sm font-bold text-[var(--spr-text)]">{opportunity.value == null ? 'Price not configured' : `${Number(opportunity.value).toLocaleString()}`}</span><span className="mt-2 flex gap-2"><button onClick={() => { if (opportunity.passport?.id) onSelectPassport?.(opportunity.passport.id); onNavigate('/passports'); }} className="text-[11px] font-semibold text-[var(--spr-highlight)]">Open proof <ChevronRight className="inline h-3 w-3" /></button><button disabled={opportunityAction === String(opportunity.passport?.id || 'passport') + ':' + String(opportunity.findingIds?.[0])} onClick={() => startOpportunityWork(opportunity)} className="rounded-lg bg-[var(--spr-accent)] px-2.5 py-1.5 text-[11px] font-bold text-white disabled:opacity-50">{opportunity.findingIds?.length ? 'Start remediation' : 'Resolve evidence gap'}</button></span></span>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.35fr_.65fr]">
        <div className="rounded-[26px] border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5 md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.18em] text-[var(--spr-highlight)]"><Target className="h-4 w-4" /> Command queue</div><h2 className="mt-2 text-xl font-bold text-[var(--spr-text)]">What should the team do next?</h2><p className="mt-1 text-xs text-[var(--spr-text-muted)]">Prioritized only from data already available to this workspace.</p></div>
            <button onClick={() => setShowAllActions(v => !v)} className="text-xs font-semibold text-[var(--spr-highlight)]">{showAllActions ? 'Collapse' : 'View all'}</button>
          </div>
          <div className="mt-4 space-y-2">
            {actions.length === 0 && <Empty icon={<CheckCircle2 />} title="No immediate action signals" detail="SPR has no recorded condition requiring a command from this view." />}
            {(showAllActions ? actions : actions.slice(0, 4)).map(action => (
              <button key={action.id} onClick={action.onClick} className="group flex w-full items-center gap-3 rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface)] p-4 text-left transition hover:-translate-y-px hover:border-[var(--spr-highlight)]/40">
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${action.tone === 'critical' ? 'bg-[var(--spr-red)]/15 text-[var(--spr-red)]' : action.tone === 'warning' ? 'bg-amber-400/10 text-amber-300' : action.tone === 'opportunity' ? 'bg-[var(--spr-accent-soft)] text-[var(--spr-highlight)]' : 'bg-[var(--spr-green)]/10 text-[var(--spr-green)]'}`}>{action.icon}</span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-[var(--spr-text)]">{action.title}</span><span className="mt-1 block text-xs leading-5 text-[var(--spr-text-muted)]">{action.detail}</span></span>
                <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-[var(--spr-highlight)]">{action.action}</span><ChevronRight className="h-4 w-4 shrink-0 text-[var(--spr-text-faint)] transition group-hover:translate-x-0.5" />
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-[26px] border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5 md:p-6">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.18em] text-[var(--spr-highlight)]"><TrendingUp className="h-4 w-4" /> Service intelligence</div>
          <h2 className="mt-2 text-xl font-bold text-[var(--spr-text)]">Where can the MSP create more coverage?</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--spr-text-muted)]">These are operational opportunity signals, not recognized revenue or forecasts.</p>
          <div className="mt-4 space-y-2">
            {serviceSignals.map(signal => (
              <button key={signal.label} onClick={() => onNavigate(signal.label.includes('Monitoring') ? '/monitoring' : signal.label.includes('Clients') ? '/clients' : '/passports')} className="flex w-full items-center gap-3 rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface)] p-3 text-left hover:border-[var(--spr-highlight)]/40">
                <span className="text-[var(--spr-highlight)]">{signal.icon}</span>
                <span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-[var(--spr-text)]">{signal.label}</span><span className="block text-[11px] text-[var(--spr-text-faint)]">{signal.description}</span></span>
                <span className="font-mono text-sm font-bold text-[var(--spr-text)]">{signal.value}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-[26px] border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5 md:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.18em] text-[var(--spr-highlight)]"><Users className="h-4 w-4" /> Client command</div><h2 className="mt-2 text-xl font-bold text-[var(--spr-text)]">Portfolio health at client level</h2><p className="mt-1 text-xs text-[var(--spr-text-muted)]">Each row is calculated from the client inventory, alerts, and authoritative verification decisions.</p></div>
          <button onClick={() => onNavigate('/clients')} className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--spr-highlight)]">Open full client workspace <ArrowRight className="h-3.5 w-3.5" /></button>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead><tr className="border-b border-[var(--spr-border)] text-[10px] font-bold uppercase tracking-[.16em] text-[var(--spr-text-faint)]"><th className="px-3 py-3">Client</th><th className="px-3 py-3">Software</th><th className="px-3 py-3">Trust</th><th className="px-3 py-3">Alerts</th><th className="px-3 py-3">Unknown</th><th className="px-3 py-3 text-right">Action</th></tr></thead>
            <tbody className="divide-y divide-[var(--spr-border)]">
              {clientRows.slice(0, 10).map(row => (
                <tr key={row.client.id} className="hover:bg-[var(--spr-surface-hover)]">
                  <td className="px-3 py-3"><button onClick={() => { onSelectClient(row.client.id); onNavigate('/clients'); }} className="font-semibold text-[var(--spr-text)] hover:text-[var(--spr-highlight)]">{row.client.name}</button></td>
                  <td className="px-3 py-3 text-[var(--spr-text-muted)]">{row.software.length}</td>
                  <td className="px-3 py-3"><span className="font-semibold text-[var(--spr-text)]">{pct(row.score)}</span></td>
                  <td className="px-3 py-3">{row.clientAlerts.length ? <span className="font-semibold text-[var(--spr-red)]">{row.clientAlerts.length}</span> : <span className="text-[var(--spr-text-faint)]">0</span>}</td>
                  <td className="px-3 py-3">{row.unknown ? <span className="font-semibold text-amber-300">{row.unknown}</span> : <span className="text-[var(--spr-green)]">0</span>}</td>
                  <td className="px-3 py-3 text-right"><button onClick={() => onNavigate('/clients')} className="text-[var(--spr-highlight)]">Open <ArrowRight className="inline h-3 w-3" /></button></td>
                </tr>
              ))}
              {!clientRows.length && <tr><td colSpan={6} className="px-3 py-10"><Empty icon={<Users />} title="No client records" detail="Add a client to begin building the MSP trust network." /></td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Feature title="Trust graph" icon={<Workflow />} detail="Move from a client → software → evidence → verification decision without losing lineage." onClick={() => onNavigate('/evidence-explorer')} />
        <Feature title="Continuous verification" icon={<RefreshCw />} detail="Turn static assessments into recurring observations and alerts." onClick={() => onNavigate('/monitoring')} />
        <Feature title="Evidence-grade reporting" icon={<FileCheck2 />} detail="Generate client-ready evidence packages and MSP audit exports from observed data." onClick={() => onNavigate('/reports')} />
      </section>

      <div className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface)] px-4 py-3 text-[11px] text-[var(--spr-text-faint)]">
        <span className="font-semibold text-[var(--spr-text-muted)]">Evidence rule:</span> this command center never turns missing data into a healthy state. Unknown remains unknown, opportunity signals are explicitly labeled, and the service-opportunity number is a deterministic coverage-gap calculation — not booked revenue.
      </div>

      <div className="mt-8 border-t border-[var(--spr-border)] pt-8">
        <MSPCommandCenter {...props} />
      </div>
    </div>
  );
}

function Kpi({ label, value, icon, danger = false }: { label: string; value: string; icon: React.ReactNode; danger?: boolean }) {
  return <div className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface)] p-3"><div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[.14em] text-[var(--spr-text-faint)]"><span>{label}</span><span className={danger ? 'text-[var(--spr-red)]' : 'text-[var(--spr-highlight)]'}>{icon}</span></div><div className="mt-2 text-lg font-bold tabular-nums text-[var(--spr-text)]">{value}</div></div>;
}
function SignalCard({ title, value, sub, icon, danger = false }: { title: string; value: string; sub: string; icon: React.ReactNode; danger?: boolean }) {
  return <div className={`rounded-2xl border p-4 ${danger ? 'border-[var(--spr-red)]/30 bg-[var(--spr-red)]/[.04]' : 'border-[var(--spr-border)] bg-[var(--spr-surface-alt)]'}`}><div className="flex items-center gap-2 text-xs font-semibold text-[var(--spr-text-muted)]"><span className={danger ? 'text-[var(--spr-red)]' : 'text-[var(--spr-highlight)]'}>{icon}</span>{title}</div><div className="mt-3 text-2xl font-bold text-[var(--spr-text)]">{value}</div><div className="mt-1 text-[11px] leading-5 text-[var(--spr-text-faint)]">{sub}</div></div>;
}
function ActionButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return <button onClick={onClick} className="inline-flex items-center gap-2 rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface)] px-3 py-2 text-xs font-semibold text-[var(--spr-text)] hover:border-[var(--spr-highlight)]/40 hover:text-[var(--spr-highlight)]">{icon}{label}</button>;
}
function Feature({ title, icon, detail, onClick }: { title: string; icon: React.ReactNode; detail: string; onClick: () => void }) {
  return <button onClick={onClick} className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5 text-left hover:border-[var(--spr-highlight)]/40"><div className="text-[var(--spr-highlight)]">{icon}</div><h3 className="mt-3 text-sm font-bold text-[var(--spr-text)]">{title}</h3><p className="mt-1 text-xs leading-5 text-[var(--spr-text-muted)]">{detail}</p></button>;
}
function Empty({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return <div className="text-center"><div className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-[var(--spr-accent-soft)] text-[var(--spr-highlight)]">{icon}</div><p className="mt-3 text-sm font-semibold text-[var(--spr-text)]">{title}</p><p className="mt-1 text-xs text-[var(--spr-text-muted)]">{detail}</p></div>;
}
