import { useEffect, useMemo, useState, type Key } from 'react';
import { apiFetch } from '../utils/apiClient';
import { EXTENSION_BY_ID, type ExtensionDefinition } from '../workflows/extensionRegistry';

type Props = { id: string; onNavigate: (path: string) => void };
type MetricValue = number | null;
type Snapshot = { passports: MetricValue; scans: MetricValue; findings: MetricValue; clients: MetricValue; integrations: MetricValue };
const EMPTY: Snapshot = { passports: null, scans: null, findings: null, clients: null, integrations: null };

type MetricProps = { label: string; value: MetricValue; loading: boolean; key?: Key };
function Metric({ label, value, loading }: MetricProps) {
  const display = loading ? '—' : value === null ? 'Not verified' : value;
  return <div className="rounded-2xl border border-white/[.07] bg-white/[.035] p-4 backdrop-blur-xl"><div className="text-[10px] font-bold uppercase tracking-[.18em] text-slate-600">{label}</div><div className="mt-2 text-2xl font-semibold tracking-tight text-white">{display}</div></div>;
}

type StepProps = { index: number; label: string; active: boolean; key?: Key };
function Step({ index, label, active }: StepProps) {
  return <div className={`flex items-center gap-3 rounded-xl border px-3 py-3 ${active ? 'border-cyan-300/20 bg-cyan-300/[.07]' : 'border-white/[.06] bg-black/10'}`}><span className={`grid h-7 w-7 place-items-center rounded-full text-[10px] font-bold ${active ? 'bg-cyan-300 text-slate-950' : 'bg-white/[.06] text-slate-500'}`}>{index + 1}</span><span className={active ? 'text-sm text-white' : 'text-sm text-slate-500'}>{label}</span>{active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,.8)]" />}</div>;
}

export default function ExtensionWorkflow({ id, onNavigate }: Props) {
  const extension: ExtensionDefinition | undefined = EXTENSION_BY_ID[id];
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setUnauthorized(false);
      setLoadFailed(false);
      const responses = await Promise.all([
        apiFetch('/api/user/passports'), apiFetch('/api/scans'), apiFetch('/api/trust-loop/findings'), apiFetch('/api/user/clients'), apiFetch('/api/integrations'),
      ]);
      if (responses.some((response) => response.status === 401)) {
        if (!cancelled) { setUnauthorized(true); setLoading(false); }
        return;
      }
      const readCount = async (response: Response): Promise<MetricValue> => {
        if (!response.ok) return null;
        const body = await response.json().catch(() => null);
        if (Array.isArray(body)) return body.length;
        if (body && Array.isArray(body.passports)) return body.passports.length;
        if (body && Array.isArray(body.findings)) return body.findings.length;
        if (body && Array.isArray(body.clients)) return body.clients.length;
        if (body && Array.isArray(body.integrations)) return body.integrations.length;
        return null;
      };
      try {
        const values = await Promise.all(responses.map(readCount));
        if (!cancelled) { setSnapshot({ passports: values[0], scans: values[1], findings: values[2], clients: values[3], integrations: values[4] }); setLoading(false); }
      } catch {
        if (!cancelled) { setLoadFailed(true); setSnapshot(EMPTY); setLoading(false); }
      }
    };
    void load().catch(() => { if (!cancelled) { setLoadFailed(true); setSnapshot(EMPTY); setLoading(false); } });
    return () => { cancelled = true; };
  }, [id]);

  const metrics = useMemo(() => {
    if (id === 'msp-compliance') return [['Clients', snapshot.clients], ['Findings', snapshot.findings], ['Passports', snapshot.passports]] as const;
    if (id === 'integrations') return [['Sources', snapshot.integrations], ['Passports', snapshot.passports], ['Scans', snapshot.scans]] as const;
    if (id === 'vendor-risk') return [['Passports / assets', snapshot.passports], ['Findings', snapshot.findings], ['Clients', snapshot.clients]] as const;
    if (id === 'agent-trust') return [['Agent evidence', snapshot.findings], ['Passports / assets', snapshot.passports], ['Scans', snapshot.scans]] as const;
    return [['Passports', snapshot.passports], ['Scans', snapshot.scans], ['Findings', snapshot.findings]] as const;
  }, [id, snapshot]);

  if (!extension) return <div className="rounded-3xl border border-rose-300/20 bg-rose-300/[.05] p-8 text-rose-200">Extension not found.</div>;
  if (unauthorized) return <div className="rounded-3xl border border-amber-300/20 bg-amber-300/[.05] p-8 text-amber-100"><div className="text-[10px] font-bold uppercase tracking-[.2em] text-amber-300">Session expired</div><h1 className="mt-2 text-2xl font-semibold">Re-authentication required</h1><p className="mt-2 text-sm text-amber-100/70">The extension could not access its protected evidence sources.</p><button onClick={() => onNavigate('/login')} className="mt-5 rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-slate-950">Return to sign in</button></div>;

  const firstRoute = extension.sourceRoutes[0] || '/dashboard';
  return <section className="space-y-6">
    <div className="relative overflow-hidden rounded-3xl border border-white/[.08] bg-white/[.035] p-6 shadow-2xl backdrop-blur-2xl md:p-8">
      <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-violet-400/10 blur-3xl" />
      <div className="relative"><div className="mb-4 flex flex-wrap items-center gap-2"><span className="rounded-full border border-violet-300/20 bg-violet-300/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.18em] text-violet-200">Extension workflow</span><span className="rounded-full border border-emerald-300/15 bg-emerald-300/[.05] px-2.5 py-1 text-[10px] text-emerald-200">Protected evidence surface</span></div><h1 className="max-w-3xl text-3xl font-semibold tracking-tight md:text-4xl">{extension.name}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">{extension.description}</p><div className="mt-6 flex flex-wrap gap-3"><button onClick={() => onNavigate(firstRoute)} className="rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-[0_0_28px_rgba(34,211,238,.16)] hover:bg-cyan-200">Open source workflow</button><button onClick={() => setActiveStep((step) => Math.min(step + 1, extension.steps.length - 1))} className="rounded-xl border border-white/10 bg-white/[.035] px-4 py-2.5 text-sm text-slate-200 hover:bg-white/[.06]">Advance workflow</button></div></div>
    </div>

    <div className="grid gap-3 md:grid-cols-3">{metrics.map(([label, value]) => <Metric key={label} label={label} value={value} loading={loading} />)}</div>

    <div className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
      <div className="rounded-3xl border border-white/[.07] bg-white/[.025] p-5 backdrop-blur-xl"><div className="mb-4"><div className="text-sm font-semibold">Workflow</div><div className="mt-1 text-xs text-slate-600">Every extension owns its own operating sequence.</div></div><div className="space-y-2">{extension.steps.map((step, index) => <Step key={step} index={index} label={step} active={index === activeStep} />)}</div></div>
      <div className="rounded-3xl border border-white/[.07] bg-white/[.025] p-5 backdrop-blur-xl"><div className="text-sm font-semibold">Observed evidence surface</div><p className="mt-1 text-xs leading-5 text-slate-600">Counts are displayed only when the protected API returns a recognized collection. Unavailable sources are explicitly marked <span className="text-slate-400">Not verified</span>.</p>{loadFailed && <div className="mt-3 rounded-xl border border-rose-300/15 bg-rose-300/[.04] p-3 text-xs text-rose-100/80">Evidence sources could not be loaded. No values are inferred.</div>}<div className="mt-5 space-y-3 text-xs">{[['Passports', snapshot.passports, '/passports'], ['Scans', snapshot.scans, '/scans'], ['Findings', snapshot.findings, '/alerts'], ['Clients', snapshot.clients, '/clients']].map(([label, value, path]) => <button key={String(label)} onClick={() => onNavigate(String(path))} className="flex w-full items-center justify-between rounded-xl border border-white/[.06] bg-black/10 px-3 py-3 text-left hover:border-white/15"><span className="text-slate-400">{label}</span><span className="font-semibold text-white">{loading ? '—' : value === null ? 'Not verified' : String(value)} <span className="ml-2 text-slate-600">→</span></span></button>)}</div></div>
    </div>
  </section>;
}
