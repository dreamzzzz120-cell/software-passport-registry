/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Founder Command Center — the top of the page: what needs attention, the
// platform pulse, and the 7-day funnel. Replaces the former tiles for
// "Autonomy Score", "Capital Protected", "Point-of-Trust" and "Access Level",
// which had no data behind them and rendered "Not verified" forever.
// Every figure here is a value the server observed; null renders as
// "Not verified", never as zero.

import { AlertOctagon, AlertTriangle, Info, RefreshCw } from 'lucide-react';
import { computeAttention, minutesSince, useFounderData } from '../lib/founderData';

function n(v: number | null | undefined): string { return typeof v === 'number' ? v.toLocaleString() : 'Not verified'; }

function Pill({ ok, label, detail }: { ok: boolean | null; label: string; detail: string }) {
  const cls = ok === null ? 'spr-status-dot spr-status-dot--gray' : ok ? 'spr-status-dot spr-status-dot--green' : 'spr-status-dot spr-status-dot--red';
  return (
    <div className="flex items-start gap-2 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] px-3 py-2">
      <span className={cls} style={{ marginTop: 5 }} />
      <div className="min-w-0"><p className="text-xs font-semibold text-[var(--spr-text)]">{label}</p><p className="text-[11px] text-[var(--spr-text-muted)]">{detail}</p></div>
    </div>
  );
}

const SEVERITY_ICON = { critical: AlertOctagon, warning: AlertTriangle, info: Info } as const;
const SEVERITY_CLASS = { critical: 'text-[var(--spr-red)]', warning: 'text-[var(--spr-amber)]', info: 'text-[var(--spr-text-muted)]' } as const;

export default function FounderOverview() {
  const { overview, commandCenter, agents, errors, loadedAt, loading, refresh } = useFounderData();
  const attention = computeAttention({ overview, commandCenter, agents });
  const p = overview?.pulse; const f = overview?.funnel; const b = commandCenter?.businessMetrics;
  const workerMins = minutesSince(p?.worker.lastSeenAt ?? null);

  const funnelSteps: { label: string; value: number | null | undefined; note?: string }[] = f ? [
    { label: 'Page views', value: f.pageViews, note: `${n(f.visitors)} sessions` },
    { label: 'Free Reviews completed', value: f.freeReviewsCompleted, note: `${n(f.freeReviewsFailed)} failed` },
    { label: 'Leads', value: f.leads },
    { label: 'Leads qualified', value: f.leadsQualified },
    { label: 'Contacts added', value: f.contacts },
    { label: 'Messages sent', value: f.messagesSent },
    { label: 'Sign-ups', value: f.signups },
    { label: 'Organizations', value: f.organizations },
  ] : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-[var(--spr-text)]">Founder Command Center</h1>
          <p className="text-sm text-[var(--spr-text-muted)]">Everything below is read from the running system. Unavailable values say "Not verified"; nothing is estimated.{loadedAt ? ` Snapshot ${new Date(loadedAt).toLocaleTimeString()}.` : ''}</p>
        </div>
        <button onClick={() => void refresh()} disabled={loading} className="spr-btn spr-btn-secondary inline-flex items-center gap-2 text-xs disabled:opacity-50"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh everything</button>
      </div>
      {errors.length > 0 && <div className="rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 p-3 text-xs text-[var(--spr-red)]">{errors.map((e) => <div key={e}>{e}</div>)}</div>}

      <section id="founder-attention" className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-5">
        <p className="text-[11px] uppercase tracking-[0.24em] font-semibold text-[var(--spr-text-muted)]">Needs attention ({attention.length})</p>
        {!overview && !commandCenter && !agents ? <p className="mt-2 text-xs text-[var(--spr-text-muted)]">{loading ? 'Loading…' : 'No data loaded.'}</p>
          : attention.length === 0 ? <p className="mt-2 text-sm text-[var(--spr-green)]">Nothing flagged: all checks passed, every connection is up, no agent is disabled or failing.</p>
          : (
            <ul className="mt-2 space-y-1.5">
              {attention.map((item, i) => { const Icon = SEVERITY_ICON[item.severity]; return (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <Icon className={`mt-0.5 w-4 h-4 shrink-0 ${SEVERITY_CLASS[item.severity]}`} />
                  <div><a href={item.anchor} className="font-medium text-[var(--spr-text)] hover:underline">{item.title}</a><p className="text-xs text-[var(--spr-text-muted)]">Evidence: {item.evidence}</p></div>
                </li>
              ); })}
            </ul>
          )}
      </section>

      <section id="founder-pulse" className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-5">
        <p className="mb-3 text-[11px] uppercase tracking-[0.24em] font-semibold text-[var(--spr-text-muted)]">Platform pulse</p>
        {!p ? <p className="text-xs text-[var(--spr-text-muted)]">{loading ? 'Loading…' : 'Not verified'}</p> : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <Pill ok={p.database.ok} label="Database" detail={p.database.ok ? `reachable · ${n(p.database.latencyMs)} ms round-trip` : 'unreachable from the API'} />
            <Pill ok={p.tenantRls} label="Tenant isolation (RLS)" detail={p.tenantRls === null ? 'not checked' : p.tenantRls ? 'spr_assert_tenant_rls() passed' : 'assertion FAILED'} />
            <Pill ok={p.leastPrivilege} label="API database role" detail={p.runtimeRole ? `${p.runtimeRole}${p.leastPrivilege ? ' (least privilege)' : ' — NOT the restricted role'}` : 'unknown'} />
            <Pill ok={workerMins === null ? null : workerMins <= 30} label="Worker" detail={p.worker.lastSeenAt ? `last wrote a job ${workerMins} min ago (${p.worker.lastSeenSource})` : 'no worker-written rows found'} />
            <Pill ok={p.scanQueue.pending === null ? null : (p.scanQueue.pending ?? 0) <= 25} label="Scan queue" detail={`${n(p.scanQueue.pending)} pending · ${n(p.scanQueue.running)} running · ${n(p.scanQueue.failed24h)} failed in 24h`} />
            <Pill ok={p.distributionQueue.deadLetter === null ? null : (p.distributionQueue.deadLetter ?? 0) === 0} label="Distribution queue" detail={`${n(p.distributionQueue.queued)} queued · ${n(p.distributionQueue.running)} running · ${n(p.distributionQueue.deadLetter)} dead-lettered`} />
            <Pill ok={true} label="API process" detail={`up ${Math.floor(p.apiUptimeSeconds / 3600)}h ${Math.floor((p.apiUptimeSeconds % 3600) / 60)}m`} />
            <Pill ok={b ? (b.mrrCents === null ? null : true) : null} label="Revenue (Stripe)" detail={b ? `MRR ${b.mrrCents === null ? 'Not verified' : `$${(b.mrrCents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`} · ${n(b.stripeCustomerCount)} customers · ${n(b.organizationCount)} orgs · ${n(b.userCount)} users` : 'Not verified'} />
          </div>
        )}
      </section>

      <section id="founder-funnel" className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-5">
        <p className="text-[11px] uppercase tracking-[0.24em] font-semibold text-[var(--spr-text-muted)]">Last {f?.windowDays ?? 7} days, stage by stage</p>
        <p className="mb-3 text-xs text-[var(--spr-text-muted)]">Counts of what happened at each stage in the same window, from the tables that record them. They line up in time; this does not claim one stage caused the next.</p>
        {!f ? <p className="text-xs text-[var(--spr-text-muted)]">{loading ? 'Loading…' : 'Not verified'}</p> : (
          <div className="grid gap-2 sm:grid-cols-4 xl:grid-cols-8">
            {funnelSteps.map((s) => (
              <div key={s.label} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-3">
                <p className="text-[11px] uppercase tracking-wide text-[var(--spr-text-muted)]">{s.label}</p>
                <p className="mt-1 text-xl font-bold tabular-nums text-[var(--spr-text)]">{n(s.value)}</p>
                {s.note && <p className="text-[11px] text-[var(--spr-text-muted)]">{s.note}</p>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
