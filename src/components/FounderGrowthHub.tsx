import { useEffect, useMemo, useState } from 'react';
import { Pause, Play, RefreshCw } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

type Stage = 'new'|'qualified'|'contacted'|'replied'|'demo'|'pilot'|'customer'|'lost';
const STAGES: Stage[] = ['new','qualified','contacted','replied','demo','pilot','customer','lost'];
const LABELS: Record<Stage,string> = { new:'New', qualified:'Qualified', contacted:'Contacted', replied:'Replied', demo:'Demo', pilot:'Pilot', customer:'Customer', lost:'Lost' };

export default function FounderGrowthHub() {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    setBusy(true); setError(null);
    try { const response = await apiFetch('/api/founder/distribution/growth'); const body = await response.json().catch(() => null); if (!response.ok) throw new Error(body?.error || `Growth API failed (${response.status})`); setData(body); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to load growth data.'); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);

  const contacts = Array.isArray(data?.contacts) ? data.contacts : [];
  const settings = data?.settings ?? {};
  const conversion = useMemo(() => {
    const sent = Number(data?.messages?.sent ?? 0);
    const replied = Number(data?.pipeline?.replied ?? 0) + Number(data?.pipeline?.demo ?? 0) + Number(data?.pipeline?.pilot ?? 0) + Number(data?.pipeline?.customer ?? 0);
    return sent > 0 ? Math.round((replied / sent) * 100) : null;
  }, [data]);

  const saveCampaign = async (patch: Record<string, unknown>) => {
    setBusy(true); setError(null);
    try { const response = await apiFetch('/api/founder/distribution/campaign', { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(patch) }); const body = await response.json().catch(() => null); if (!response.ok) throw new Error(body?.error || `Campaign update failed (${response.status})`); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to update campaign.'); setBusy(false); }
  };
  const setStage = async (id: string, stage: Stage) => {
    setBusy(true); setError(null);
    try { const response = await apiFetch(`/api/founder/distribution/contacts/${encodeURIComponent(id)}/stage`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ stage }) }); const body = await response.json().catch(() => null); if (!response.ok) throw new Error(body?.error || `Stage update failed (${response.status})`); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to update stage.'); setBusy(false); }
  };

  return <section className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-6">
    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div><div className="text-[11px] font-semibold uppercase tracking-[.2em] text-[var(--spr-text-faint)]">Founder-only</div><h2 className="mt-2 text-xl font-semibold text-[var(--spr-text)]">SPR Growth Hub</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--spr-text-muted)]">Operational pipeline on top of the distribution engine. It records observed outreach state; it does not change trust scores or invent customer outcomes.</p></div>
      <button onClick={() => void load()} disabled={busy} className="spr-btn spr-btn-secondary inline-flex items-center gap-2 disabled:opacity-60"><RefreshCw className="h-4 w-4" />Refresh</button>
    </div>
    {error && <div className="mt-4 rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 p-3 text-sm text-[var(--spr-red)]">{error}</div>}
    <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {STAGES.slice(0,4).map((stage) => <div key={stage} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4"><div className="text-[11px] uppercase tracking-[.18em] text-[var(--spr-text-muted)]">{LABELS[stage]}</div><div className="mt-2 text-2xl font-bold text-[var(--spr-text)]">{data?.pipeline?.[stage] ?? '—'}</div></div>)}
    </div>
    <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {STAGES.slice(4).map((stage) => <div key={stage} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4"><div className="text-[11px] uppercase tracking-[.18em] text-[var(--spr-text-muted)]">{LABELS[stage]}</div><div className="mt-2 text-2xl font-bold text-[var(--spr-text)]">{data?.pipeline?.[stage] ?? '—'}</div></div>)}
    </div>
    <div className="mt-6 grid gap-4 lg:grid-cols-3">
      <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4"><div className="text-[11px] uppercase tracking-[.18em] text-[var(--spr-text-muted)]">Messages sent</div><div className="mt-2 text-2xl font-bold">{data?.messages?.sent ?? '—'}</div></div>
      <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4"><div className="text-[11px] uppercase tracking-[.18em] text-[var(--spr-text-muted)]">Observed response-stage rate</div><div className="mt-2 text-2xl font-bold">{conversion === null ? 'Not verified' : `${conversion}%`}</div></div>
      <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4"><div className="text-[11px] uppercase tracking-[.18em] text-[var(--spr-text-muted)]">Campaign</div><div className="mt-2 flex items-center gap-2"><button onClick={() => void saveCampaign({ outreachEnabled: !settings.outreachEnabled })} disabled={busy} className="spr-btn spr-btn-secondary inline-flex items-center gap-2">{settings.outreachEnabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{settings.outreachEnabled ? 'Pause outreach' : 'Enable outreach'}</button></div></div>
    </div>
    <div className="mt-6 overflow-x-auto rounded-md border border-[var(--spr-border)]">
      <table className="w-full text-left text-sm"><thead><tr className="border-b border-[var(--spr-border)] text-[11px] uppercase tracking-[.16em] text-[var(--spr-text-muted)]"><th className="p-3">Company</th><th className="p-3">Email</th><th className="p-3">Stage</th><th className="p-3">Observed</th></tr></thead><tbody>
        {contacts.slice(0,50).map((contact:any) => <tr key={contact.id} className="border-b border-[var(--spr-border)] last:border-0"><td className="p-3 text-[var(--spr-text)]">{contact.company || 'Unknown'}</td><td className="p-3 font-mono text-xs text-[var(--spr-text-muted)]">{contact.email}</td><td className="p-3"><select value={contact.pipelineStage} onChange={(event) => void setStage(String(contact.id), event.target.value as Stage)} disabled={busy} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] px-2 py-1 text-[var(--spr-text)]">{STAGES.map(stage => <option key={stage} value={stage}>{LABELS[stage]}</option>)}</select></td><td className="p-3 text-xs text-[var(--spr-text-muted)]">{contact.updatedAt ? new Date(contact.updatedAt).toLocaleString() : 'Not verified'}</td></tr>)}
        {!contacts.length && <tr><td colSpan={4} className="p-6 text-center text-sm text-[var(--spr-text-muted)]">No distribution contacts observed yet.</td></tr>}
      </tbody></table>
    </div>
    <p className="mt-4 text-xs text-[var(--spr-text-faint)]">Safety: founder-only controls, server-side rate limits, public role/business addresses only, unsubscribe suppression, duplicate guards, and no payment-based trust changes.</p>
  </section>;
}
