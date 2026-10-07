/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Bot, CreditCard, Database, Eye, RadioTower, RefreshCw, ShieldCheck, Users, Zap } from 'lucide-react';
import { computeAttention, minutesSince, useFounderData, type FounderActivity } from '../lib/founderData';

function count(value: number | null | undefined): string {
  return typeof value === 'number' ? value.toLocaleString() : 'NOT VERIFIED';
}

function money(cents: number | null | undefined): string {
  return typeof cents === 'number'
    ? `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : 'NOT VERIFIED';
}

function relative(iso: string | null | undefined, now: number): string {
  if (!iso) return 'UNKNOWN';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 'UNKNOWN';
  const seconds = Math.max(0, Math.round((now - t) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function Metric({ label, value, detail, icon: Icon }: { label: string; value: string; detail: string; icon: typeof Activity }) {
  return <div className="cc-glass cc-mission-metric">
    <div className="cc-mission-metric-label"><Icon className="w-3.5 h-3.5" /><span>{label}</span></div>
    <strong>{value}</strong>
    <small>{detail}</small>
  </div>;
}

function TruthState({ label, value, ok }: { label: string; value: string; ok: boolean | null }) {
  const cls = ok === null ? 'cc-truth-unknown' : ok ? 'cc-truth-ok' : 'cc-truth-error';
  return <div className={`cc-truth-row ${cls}`}><span>{label}</span><b>{value}</b></div>;
}

function activityText(item: FounderActivity): string {
  if (item.category === 'lead') return 'Free Review lead captured';
  if (item.category === 'signup') return `User provisioned${item.state ? ` · ${item.state}` : ''}`;
  if (item.category === 'crawler') return `Registry crawl${item.state ? ` · ${item.state}` : ''}`;
  return `${item.label}${item.state ? ` · ${item.state}` : ''}`;
}

export default function FounderMissionControl() {
  const { overview, commandCenter, agents, errors, loadedAt, loading, refresh } = useFounderData();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const attention = useMemo(() => computeAttention({ overview, commandCenter, agents }, now), [overview, commandCenter, agents, now]);
  const critical = attention.filter((item) => item.severity === 'critical').length;
  const warnings = attention.filter((item) => item.severity === 'warning').length;
  const pulse = overview?.pulse;
  const funnel = overview?.funnel;
  const traffic = overview?.traffic;
  const business = commandCenter?.businessMetrics;
  const activeAgents = agents?.filter((a) => a.state === 'active').length ?? null;
  const unknownAgents = agents?.filter((a) => a.state === 'unknown').length ?? null;
  const healthyConnections = commandCenter?.connections.filter((c) => c.status === 'ok').length ?? null;
  const connectionErrors = commandCenter?.connections.filter((c) => c.status === 'error').length ?? null;
  const workerAge = minutesSince(pulse?.worker.lastSeenAt ?? null, now);
  const snapshotAge = loadedAt ? Math.max(0, Math.round((now - new Date(loadedAt).getTime()) / 1000)) : null;
  const sourceCount = [overview, commandCenter, agents].filter(Boolean).length;

  let operatingState = 'UNKNOWN';
  let operatingDetail = 'No verified founder telemetry loaded';
  if (pulse?.database.ok === false || pulse?.tenantRls === false || pulse?.leastPrivilege === false || critical > 0) {
    operatingState = 'DEGRADED';
    operatingDetail = 'A critical verified control requires attention';
  } else if (sourceCount === 3 && warnings > 0) {
    operatingState = 'ATTENTION';
    operatingDetail = 'Core telemetry loaded with one or more warnings';
  } else if (sourceCount === 3) {
    operatingState = 'OBSERVED';
    operatingDetail = 'All founder telemetry sources returned a snapshot';
  }

  const stateClass = operatingState === 'DEGRADED' ? 'cc-state-degraded' : operatingState === 'ATTENTION' ? 'cc-state-attention' : operatingState === 'OBSERVED' ? 'cc-state-observed' : 'cc-state-unknown';
  const activity = overview?.recentActivity;
  const topPages = traffic?.topPages;

  return <section id="spr-founder-command-center" className="cc-canvas founder-command-center cc-mission-shell">
    <header className="cc-founder-topbar cc-glass cc-glass-raised">
      <div className="cc-founder-brand">
        <span className={`cc-live-dot ${operatingState === 'DEGRADED' ? 'cc-live-dot--degraded' : ''}`} />
        <div>
          <div className="cc-eyebrow">SPR / FOUNDER MISSION CONTROL</div>
          <div className="cc-founder-subtitle">Evidence-backed platform operations · 15s live refresh while visible</div>
        </div>
      </div>
      <div className="cc-mission-actions">
        <span className="cc-snapshot-age">{snapshotAge === null ? 'snapshot UNKNOWN' : `snapshot ${snapshotAge}s old`}</span>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="spr-btn spr-btn-secondary inline-flex items-center gap-2 text-xs">
          <RefreshCw className={loading ? 'w-3.5 h-3.5 animate-spin' : 'w-3.5 h-3.5'} /> {loading ? 'Refreshing' : 'Refresh now'}
        </button>
      </div>
    </header>

    <div className="cc-mission-hero">
      <div className={`cc-glass cc-glass-raised cc-mission-state ${stateClass}`}>
        <div className="cc-eyebrow">OPERATIONAL STATE</div>
        <div className="cc-mission-state-line"><strong>{operatingState}</strong><span>{operatingDetail}</span></div>
        <div className="cc-mission-state-meta">
          <span>{sourceCount}/3 telemetry sources</span>
          <span>{critical} critical</span>
          <span>{warnings} warnings</span>
          <span>{errors.length} request errors</span>
        </div>
      </div>
      <div className="cc-glass cc-mission-jumps">
        <div className="cc-eyebrow">QUICK JUMP</div>
        <div className="cc-mission-jump-grid">
          <a href="#founder-attention">Attention</a><a href="#founder-pulse">Infrastructure</a><a href="#founder-agents">Agents</a>
          <a href="#founder-connections">Connections</a><a href="#founder-funnel">Growth funnel</a><a href="#founder-data-truth">Data truth</a>
        </div>
      </div>
    </div>

    <div className="cc-founder-metrics cc-founder-metrics--mission">
      <Metric label="MRR" value={money(business?.mrrCents)} detail={business?.activeSubscriptionCount == null ? 'Subscriptions not verified' : `${count(business.activeSubscriptionCount)} active subscriptions`} icon={CreditCard} />
      <Metric label="30d payments" value={count(business?.successfulPaymentCount30d)} detail={business?.successfulPaymentAmount30dCents == null ? 'Gross not verified' : `${money(business.successfulPaymentAmount30dCents)} observed gross`} icon={CreditCard} />
      <Metric label="Active sessions" value={count(traffic?.activeSessions)} detail={`${count(traffic?.activeEvents)} events in 30m`} icon={Users} />
      <Metric label="Visitors 24h" value={count(traffic?.visitors24h)} detail={`${count(traffic?.pageViews24h)} page views`} icon={Eye} />
      <Metric label="Leads 7d" value={count(funnel?.leads)} detail={`${count(funnel?.leadsQualified)} qualified`} icon={Zap} />
      <Metric label="Active agents" value={count(activeAgents)} detail={`${count(unknownAgents)} unknown`} icon={Bot} />
      <Metric label="Scan queue" value={count(pulse?.scanQueue.pending)} detail={`${count(pulse?.scanQueue.running)} running · ${count(pulse?.scanQueue.failed24h)} failed 24h`} icon={Activity} />
      <Metric label="Connections" value={healthyConnections === null ? 'NOT VERIFIED' : `${healthyConnections} OK`} detail={connectionErrors === null ? 'status unknown' : `${connectionErrors} errors`} icon={RadioTower} />
    </div>

    <div className="cc-mission-grid">
      <section className="cc-glass cc-mission-panel">
        <div className="cc-section-head"><div><div className="cc-eyebrow">CONTROL PLANE</div><h2>Security and runtime truth</h2></div><ShieldCheck className="w-4 h-4 text-[var(--cc-investigate)]" /></div>
        <div className="cc-truth-list">
          <TruthState label="Database" value={pulse?.database.ok == null ? 'UNKNOWN' : pulse.database.ok ? `OK · ${count(pulse.database.latencyMs)} ms` : 'UNREACHABLE'} ok={pulse?.database.ok ?? null} />
          <TruthState label="Tenant isolation" value={pulse?.tenantRls == null ? 'UNKNOWN' : pulse.tenantRls ? 'RLS ASSERTION PASSED' : 'RLS ASSERTION FAILED'} ok={pulse?.tenantRls ?? null} />
          <TruthState label="Runtime role" value={pulse?.runtimeRole ?? 'UNKNOWN'} ok={pulse?.leastPrivilege ?? null} />
          <TruthState label="Worker evidence" value={workerAge == null ? 'UNKNOWN' : `${workerAge}m ago · ${pulse?.worker.lastSeenSource ?? 'source unknown'}`} ok={workerAge == null ? null : workerAge <= 30} />
          <TruthState label="Distribution dead-letter" value={count(pulse?.distributionQueue.deadLetter)} ok={pulse?.distributionQueue.deadLetter == null ? null : pulse.distributionQueue.deadLetter === 0} />
          <TruthState label="API uptime" value={pulse ? `${Math.floor(pulse.apiUptimeSeconds / 3600)}h ${Math.floor((pulse.apiUptimeSeconds % 3600) / 60)}m` : 'UNKNOWN'} ok={pulse ? true : null} />
        </div>
      </section>

      <section className="cc-glass cc-mission-panel">
        <div className="cc-section-head"><div><div className="cc-eyebrow">ATTENTION QUEUE</div><h2>Evidence-backed exceptions</h2></div><AlertTriangle className="w-4 h-4 text-[var(--cc-partial)]" /></div>
        {attention.length === 0 && sourceCount === 3 ? <div className="cc-empty-state">No deterministic attention rule is currently firing.</div> : attention.length === 0 ? <div className="cc-empty-state">Attention state is not verified until founder telemetry loads.</div> : (
          <div className="cc-mission-attention-list">
            {attention.slice(0, 8).map((item, index) => <a key={`${item.title}-${index}`} href={item.anchor} className={`cc-mission-attention cc-attention-${item.severity}`}>
              <span>{item.severity.toUpperCase()}</span><div><strong>{item.title}</strong><small>{item.evidence}</small></div>
            </a>)}
          </div>
        )}
      </section>

      <section className="cc-glass cc-mission-panel cc-mission-activity">
        <div className="cc-section-head"><div><div className="cc-eyebrow">RECENT ACTIVITY</div><h2>Persisted operational events</h2></div><Activity className="w-4 h-4 text-[var(--cc-investigate)]" /></div>
        {activity === null || activity === undefined ? <div className="cc-empty-state">Recent activity could not be verified.</div> : activity.length === 0 ? <div className="cc-empty-state">No persisted activity rows were observed.</div> : (
          <div className="cc-activity-list">
            {activity.slice(0, 12).map((item) => <div key={item.id} className="cc-activity-row">
              <time>{relative(item.occurredAt, now)}</time><span className="cc-feed-dot" /><div><strong>{activityText(item)}</strong><small>{item.source}</small></div>
            </div>)}
          </div>
        )}
      </section>

      <section className="cc-glass cc-mission-panel">
        <div className="cc-section-head"><div><div className="cc-eyebrow">TRAFFIC</div><h2>Top observed pages · 24h</h2></div><Eye className="w-4 h-4 text-[var(--cc-investigate)]" /></div>
        {topPages === null || topPages === undefined ? <div className="cc-empty-state">Top-page traffic is not verified.</div> : topPages.length === 0 ? <div className="cc-empty-state">No page events observed in the last 24 hours.</div> : (
          <div className="cc-top-pages">{topPages.slice(0, 8).map((page) => <div className="cc-top-page" key={page.path}><span title={page.path}>{page.path || '/'}</span><b>{page.views.toLocaleString()}</b></div>)}</div>
        )}
      </section>
    </div>

    <footer className="cc-glass cc-mission-provenance">
      <div><Database className="w-3.5 h-3.5" /><span>/api/founder/overview</span><b>{overview ? 'OBSERVED' : 'UNKNOWN'}</b></div>
      <div><RadioTower className="w-3.5 h-3.5" /><span>/api/founder/command-center</span><b>{commandCenter ? 'OBSERVED' : 'UNKNOWN'}</b></div>
      <div><Bot className="w-3.5 h-3.5" /><span>/api/founder/agents</span><b>{agents ? 'OBSERVED' : 'UNKNOWN'}</b></div>
    </footer>
  </section>;
}
