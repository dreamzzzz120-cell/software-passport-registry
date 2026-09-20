/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Founder Command Center — agents. One card per background agent, each
// opening a detail view: what it is, how it decides, its live configuration,
// the controls that call real endpoints, and an activity feed read from the
// rows the worker writes. Every value shown comes from /api/founder/agents;
// nothing is computed or assumed client-side, and a control reports exactly
// what the server answered.

import { useState } from 'react';
import { Activity, ChevronDown, ChevronRight, Play, RefreshCw, Search, ToggleLeft, ToggleRight, UserCheck } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { useFounderData } from '../lib/founderData';

type AgentState = 'active' | 'idle' | 'disabled' | 'unknown';
type AgentConfigItem = { label: string; value: string; source: string; control?: string };
type AgentActivityRow = { id: string; at: string; kind: string; status: string; subject: string | null; why: string; outcome: string | null; error: string | null; attempts: number | null; workerId: string | null };
type AgentControl = { id: string; label: string; description: string; method: 'POST' | 'PATCH'; path: string };
export type AgentReport = {
  key: string; name: string; purpose: string; howItDecides: string; dataSource: string;
  state: AgentState; stateReason: string; runningNow: number; last24h: Record<string, number>; lastCompletedAt: string | null;
  config: AgentConfigItem[]; recent: AgentActivityRow[]; controls: AgentControl[]; generatedAt: string;
};

const STATE_DOT: Record<AgentState, string> = { active: 'spr-status-dot spr-status-dot--green', idle: 'spr-status-dot spr-status-dot--blue', disabled: 'spr-status-dot spr-status-dot--gray', unknown: 'spr-status-dot spr-status-dot--amber' };
const STATE_LABEL: Record<AgentState, string> = { active: 'Active', idle: 'Idle', disabled: 'Disabled', unknown: 'Unknown' };
const ROW_STATUS_CLASS: Record<string, string> = { succeeded: 'text-[var(--spr-green)]', Completed: 'text-[var(--spr-green)]', running: 'text-[var(--spr-blue)]', Running: 'text-[var(--spr-blue)]', queued: 'text-[var(--spr-text-muted)]', Pending: 'text-[var(--spr-text-muted)]', failed: 'text-[var(--spr-red)]', Failed: 'text-[var(--spr-red)]', dead_letter: 'text-[var(--spr-red)]' };

export function relativeTime(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 'unknown';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function summarize24h(last24h: Record<string, number>): string {
  const entries = Object.entries(last24h).filter(([, v]) => v > 0);
  if (!entries.length) return 'nothing in the last 24h';
  return entries.map(([k, v]) => `${v} ${k.replace(/^[a-z_]+:/, '').replace('_', ' ')}`).join(' · ');
}

type ActionResult = { ok: boolean; text: string };

async function callControl(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<ActionResult> {
  try {
    const res = await apiFetch(path, { method, body: JSON.stringify(body) });
    const payload = await res.json().catch(() => null);
    const summary = payload ? JSON.stringify(payload).slice(0, 300) : `HTTP ${res.status}`;
    return { ok: res.ok, text: `${res.status} ${res.ok ? 'accepted' : 'rejected'} — ${summary}` };
  } catch (e) { return { ok: false, text: e instanceof Error ? e.message : 'request failed' }; }
}

function Controls({ agent, onDone }: { agent: AgentReport; onDone: () => void }) {
  const [query, setQuery] = useState('');
  const [url, setUrl] = useState('');
  const [leadId, setLeadId] = useState('');
  const [cap, setCap] = useState('');
  const [delay, setDelay] = useState('');
  const [maxFollowups, setMaxFollowups] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const has = (id: string) => agent.controls.some((c) => c.id === id);
  // The server reports the gate as 'true' / 'false', or 'true (no settings row yet; worker default)'.
  const enabledNow = (label: string) => (agent.config.find((c) => c.label.startsWith(label))?.value ?? '').startsWith('true');
  async function run(id: string, method: 'POST' | 'PATCH', path: string, body: unknown) {
    setBusy(id); setResult(null);
    const r = await callControl(method, path, body);
    setResult(r); setBusy(null);
    if (r.ok) onDone();
  }
  if (!agent.controls.length) return <p className="text-xs text-[var(--spr-text-muted)]">This agent has no founder controls; its schedule and gates live on the worker service.</p>;
  return (
    <div className="space-y-3">
      {has('campaign') && agent.key === 'discovery' && (
        <button type="button" disabled={busy !== null} onClick={() => void run('campaign', 'PATCH', '/api/founder/distribution/campaign', { discoveryEnabled: !enabledNow('Discovery enabled') })} className="spr-btn spr-btn-secondary inline-flex items-center gap-2 text-xs">
          {enabledNow('Discovery enabled') ? <ToggleRight className="w-4 h-4 text-[var(--spr-green)]" /> : <ToggleLeft className="w-4 h-4" />}{enabledNow('Discovery enabled') ? 'Disable discovery (database gate)' : 'Enable discovery (database gate)'}
        </button>
      )}
      {has('campaign') && agent.key === 'outreach' && (
        <div className="space-y-2">
          <button type="button" disabled={busy !== null} onClick={() => void run('campaign', 'PATCH', '/api/founder/distribution/campaign', { outreachEnabled: !enabledNow('Outreach enabled') })} className="spr-btn spr-btn-secondary inline-flex items-center gap-2 text-xs">
            {enabledNow('Outreach enabled') ? <ToggleRight className="w-4 h-4 text-[var(--spr-green)]" /> : <ToggleLeft className="w-4 h-4" />}{enabledNow('Outreach enabled') ? 'Disable outreach (database gate)' : 'Enable outreach (database gate)'}
          </button>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-[var(--spr-text-muted)]">Daily send cap<input value={cap} onChange={(e) => setCap(e.target.value)} placeholder="1–500" inputMode="numeric" className="mt-1 block w-28 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] px-2 py-1 text-sm text-[var(--spr-text)]" /></label>
            <label className="text-xs text-[var(--spr-text-muted)]">Follow-up delay (days)<input value={delay} onChange={(e) => setDelay(e.target.value)} placeholder="1–30" inputMode="numeric" className="mt-1 block w-28 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] px-2 py-1 text-sm text-[var(--spr-text)]" /></label>
            <label className="text-xs text-[var(--spr-text-muted)]">Max follow-ups<input value={maxFollowups} onChange={(e) => setMaxFollowups(e.target.value)} placeholder="0–3" inputMode="numeric" className="mt-1 block w-28 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] px-2 py-1 text-sm text-[var(--spr-text)]" /></label>
            <button type="button" disabled={busy !== null || (!cap && !delay && !maxFollowups)} onClick={() => { const body: Record<string, number> = {}; if (cap) body.dailySendCap = Number(cap); if (delay) body.followupDelayDays = Number(delay); if (maxFollowups) body.maxFollowups = Number(maxFollowups); void run('campaign', 'PATCH', '/api/founder/distribution/campaign', body); }} className="spr-btn spr-btn-primary text-xs disabled:opacity-50">Save limits</button>
          </div>
        </div>
      )}
      {has('discovery_run') && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1 min-w-[16rem] text-xs text-[var(--spr-text-muted)]">Discovery query<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder='e.g. "managed service provider Ontario"' className="mt-1 block w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] px-2 py-1 text-sm text-[var(--spr-text)]" /></label>
          <button type="button" disabled={busy !== null || query.trim().length < 2} onClick={() => void run('discovery_run', 'POST', '/api/founder/distribution/discovery/run', { query: query.trim() })} className="spr-btn spr-btn-primary inline-flex items-center gap-2 text-xs disabled:opacity-50"><Search className="w-3.5 h-3.5" />Run discovery now</button>
        </div>
      )}
      {has('research') && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1 min-w-[16rem] text-xs text-[var(--spr-text-muted)]">Company website URL<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" className="mt-1 block w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] px-2 py-1 text-sm text-[var(--spr-text)]" /></label>
          <button type="button" disabled={busy !== null || !/^https?:\/\//.test(url.trim())} onClick={() => void run('research', 'POST', '/api/founder/distribution/research', { url: url.trim() })} className="spr-btn spr-btn-primary inline-flex items-center gap-2 text-xs disabled:opacity-50"><Play className="w-3.5 h-3.5" />Research this URL</button>
        </div>
      )}
      {has('qualify_lead') && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1 min-w-[16rem] text-xs text-[var(--spr-text-muted)]">Lead id (from the Leads panel)<input value={leadId} onChange={(e) => setLeadId(e.target.value)} placeholder="lead_…" className="mt-1 block w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] px-2 py-1 text-sm text-[var(--spr-text)]" /></label>
          <button type="button" disabled={busy !== null || !leadId.trim()} onClick={() => void run('qualify_lead', 'POST', '/api/founder/distribution/qualify-lead', { leadId: leadId.trim() })} className="spr-btn spr-btn-primary inline-flex items-center gap-2 text-xs disabled:opacity-50"><UserCheck className="w-3.5 h-3.5" />Qualify lead now</button>
        </div>
      )}
      {result && <p className={`text-xs ${result.ok ? 'text-[var(--spr-green)]' : 'text-[var(--spr-red)]'}`} data-testid="agent-control-result">Server answered: {result.text}</p>}
      <ul className="text-[11px] text-[var(--spr-text-muted)] space-y-0.5">{agent.controls.map((c) => <li key={c.id}><span className="font-mono">{c.method} {c.path}</span> — {c.description}</li>)}</ul>
    </div>
  );
}

function AgentDetail({ agent, onChanged }: { agent: AgentReport; onChanged: () => void }) {
  return (
    <div className="mt-3 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-5 space-y-5" data-testid={`agent-detail-${agent.key}`}>
      <section>
        <p className="text-[11px] uppercase tracking-[0.24em] font-semibold text-[var(--spr-text-muted)]">Right now</p>
        <p className="mt-1 text-sm text-[var(--spr-text)]"><span className="font-semibold">{STATE_LABEL[agent.state]}</span> — {agent.stateReason}. Last completed {relativeTime(agent.lastCompletedAt)}. Last 24h: {summarize24h(agent.last24h)}.</p>
        <p className="mt-1 text-xs text-[var(--spr-text-muted)]">Read from {agent.dataSource} at {new Date(agent.generatedAt).toLocaleTimeString()}.</p>
      </section>
      <section>
        <p className="text-[11px] uppercase tracking-[0.24em] font-semibold text-[var(--spr-text-muted)]">What it does</p>
        <p className="mt-1 text-sm text-[var(--spr-text)]">{agent.purpose}</p>
        <p className="mt-2 text-[11px] uppercase tracking-[0.24em] font-semibold text-[var(--spr-text-muted)]">How it decides what to do</p>
        <p className="mt-1 text-sm text-[var(--spr-text)]">{agent.howItDecides}</p>
      </section>
      <section>
        <p className="text-[11px] uppercase tracking-[0.24em] font-semibold text-[var(--spr-text-muted)]">Configuration (live values)</p>
        <table className="mt-2 w-full text-left text-sm">
          <tbody>
            {agent.config.map((c) => (
              <tr key={c.label} className="border-t border-[var(--spr-border)] align-top">
                <td className="py-1.5 pr-3 text-[var(--spr-text)]">{c.label}</td>
                <td className="py-1.5 pr-3 font-mono text-xs text-[var(--spr-text)]">{c.value}</td>
                <td className="py-1.5 text-xs text-[var(--spr-text-muted)]">{c.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <p className="text-[11px] uppercase tracking-[0.24em] font-semibold text-[var(--spr-text-muted)]">Controls</p>
        <div className="mt-2"><Controls agent={agent} onDone={onChanged} /></div>
      </section>
      <section>
        <p className="text-[11px] uppercase tracking-[0.24em] font-semibold text-[var(--spr-text-muted)]">Activity — newest first ({agent.recent.length})</p>
        {agent.recent.length === 0 ? <p className="mt-1 text-xs text-[var(--spr-text-muted)]">No rows recorded for this agent yet.</p> : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="text-[11px] uppercase tracking-[0.18em] text-[var(--spr-text-muted)]"><th className="pb-1 pr-3">When</th><th className="pb-1 pr-3">Status</th><th className="pb-1 pr-3">What</th><th className="pb-1 pr-3">Why</th><th className="pb-1 pr-3">Outcome / error</th><th className="pb-1">Worker</th></tr></thead>
              <tbody>
                {agent.recent.map((r) => (
                  <tr key={r.id} className="border-t border-[var(--spr-border)] align-top">
                    <td className="py-1.5 pr-3 whitespace-nowrap text-[var(--spr-text-muted)]" title={r.at}>{relativeTime(r.at)}</td>
                    <td className={`py-1.5 pr-3 whitespace-nowrap font-semibold ${ROW_STATUS_CLASS[r.status] ?? 'text-[var(--spr-text)]'}`}>{r.status}{r.attempts && r.attempts > 1 ? <span className="ml-1 font-normal text-[var(--spr-text-muted)]">×{r.attempts}</span> : null}</td>
                    <td className="py-1.5 pr-3 text-[var(--spr-text)]"><span className="font-mono text-[11px] text-[var(--spr-text-muted)]">{r.kind}</span>{r.subject ? <div className="break-all">{r.subject}</div> : null}</td>
                    <td className="py-1.5 pr-3 text-[var(--spr-text-muted)] max-w-[18rem]">{r.why}</td>
                    <td className="py-1.5 pr-3 max-w-[18rem]">{r.outcome ? <div className="text-[var(--spr-text)]">{r.outcome}</div> : null}{r.error ? <div className="text-[var(--spr-red)] break-all">{r.error}</div> : null}{!r.outcome && !r.error ? <span className="text-[var(--spr-text-muted)]">—</span> : null}</td>
                    <td className="py-1.5 font-mono text-[11px] text-[var(--spr-text-muted)]">{r.workerId ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default function FounderAgentsPanel() {
  const { agents, errors, loading, refresh } = useFounderData();
  const [open, setOpen] = useState<string | null>(null);
  const load = refresh;
  const error = errors.find((e) => e.startsWith('/api/founder/agents')) ?? null;

  if (error && !agents) return <div id="founder-agents" className="rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 p-4 text-sm text-[var(--spr-red)]">{error}</div>;
  if (!agents) return null;

  return (
    <div id="founder-agents" className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.24em] font-semibold text-[var(--spr-text-muted)]">Agents</p>
          <p className="text-xs text-[var(--spr-text-muted)]">Each background agent, from the rows the worker writes. Click one for what it does, how it decides, its live configuration, controls, and every recent job with its reason and outcome.</p>
        </div>
        <button onClick={() => void load()} disabled={loading} className="spr-btn spr-btn-secondary inline-flex items-center gap-2 text-xs disabled:opacity-50"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
      </div>
      {error && <p className="mb-2 text-xs text-[var(--spr-red)]">{error}</p>}
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {agents.map((a) => {
          const isOpen = open === a.key;
          return (
            <button key={a.key} type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : a.key)} className={`flex items-start gap-2 rounded-md border p-3 text-left transition-colors hover:border-[var(--spr-highlight)] ${isOpen ? 'border-[var(--spr-highlight)] bg-[var(--spr-surface)]' : 'border-[var(--spr-border)] bg-[var(--spr-surface-alt)]'}`}>
              <span className={STATE_DOT[a.state]} style={{ marginTop: 5 }} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[var(--spr-text)]">{a.name} <span className="ml-1 text-[11px] font-normal uppercase tracking-wide text-[var(--spr-text-muted)]">{STATE_LABEL[a.state]}</span></p>
                <p className="text-xs text-[var(--spr-text-muted)]">{a.stateReason}</p>
                <p className="mt-1 flex items-center gap-1 text-[11px] text-[var(--spr-text-muted)]"><Activity className="w-3 h-3" /> 24h: {summarize24h(a.last24h)} · last completed {relativeTime(a.lastCompletedAt)}</p>
              </div>
              {isOpen ? <ChevronDown className="w-4 h-4 shrink-0 text-[var(--spr-text-muted)]" /> : <ChevronRight className="w-4 h-4 shrink-0 text-[var(--spr-text-muted)]" />}
            </button>
          );
        })}
      </div>
      {open && (() => { const a = agents.find((x) => x.key === open); return a ? <AgentDetail agent={a} onChanged={() => void load()} /> : null; })()}
    </div>
  );
}
