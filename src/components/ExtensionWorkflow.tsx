import { useEffect, useMemo, useState, type Key } from 'react';
import { apiFetch } from '../utils/apiClient';
import { EXTENSION_BY_ID, type ExtensionDefinition } from '../workflows/extensionRegistry';
import NewReviewIntake from './NewReviewIntake';
import MSPStackCommandCenter from './MSPStackCommandCenter';

type Props = { id: string; onNavigate: (path: string) => void };
type MetricValue = number | null;
type Snapshot = { passports: MetricValue; scans: MetricValue; findings: MetricValue; clients: MetricValue; integrations: MetricValue };
const EMPTY: Snapshot = { passports: null, scans: null, findings: null, clients: null, integrations: null };

type MetricProps = { label: string; value: MetricValue; loading: boolean; key?: Key };
function Metric({ label, value, loading }: MetricProps) {
  const display = loading ? '—' : value === null ? 'Not verified' : value;
  return <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4"><div className="text-[10px] font-bold uppercase tracking-[.18em] text-[var(--spr-text-faint)]">{label}</div><div className="mt-2 text-2xl font-semibold tracking-tight text-[var(--spr-text)]">{display}</div></div>;
}

type StepProps = { index: number; label: string; active: boolean; key?: Key };
function Step({ index, label, active }: StepProps) {
  return <div className={`flex items-center gap-3 rounded-md border border-[var(--spr-border)] px-3 py-3 ${active ? 'bg-[var(--spr-accent-soft)]' : 'bg-[var(--spr-surface-sunken)]'}`}><span className={`grid h-7 w-7 place-items-center rounded-full text-[10px] font-bold ${active ? 'bg-[var(--spr-accent)] text-white' : 'bg-[var(--spr-surface-hover)] text-[var(--spr-text-muted)]'}`}>{index + 1}</span><span className={active ? 'text-sm text-[var(--spr-text)]' : 'text-sm text-[var(--spr-text-muted)]'}>{label}</span>{active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[var(--spr-highlight)]" />}</div>;
}

export default function ExtensionWorkflow({ id, onNavigate }: Props) {
  const extension: ExtensionDefinition | undefined = EXTENSION_BY_ID[id];
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    if (id === 'new-review' || id === 'msp-command-center') { setLoading(false); return; }
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
    if (id === 'integrations') return [['Sources', snapshot.integrations], ['Passports', snapshot.passports], ['Scans', snapshot.scans]] as const;
    if (id === 'vendor-risk') return [['Passports / assets', snapshot.passports], ['Findings', snapshot.findings], ['Clients', snapshot.clients]] as const;
    if (id === 'agent-trust') return [['Agent evidence', snapshot.findings], ['Passports / assets', snapshot.passports], ['Scans', snapshot.scans]] as const;
    return [['Passports', snapshot.passports], ['Scans', snapshot.scans], ['Findings', snapshot.findings]] as const;
  }, [id, snapshot]);

  if (!extension) return <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-8 text-[var(--spr-red)]">Extension not found.</div>;
  if (id === 'new-review') return <NewReviewIntake />;
  if (id === 'msp-command-center') return <MSPStackCommandCenter onNavigate={onNavigate} />;
  if (unauthorized) return <div className="spr-panel p-8"><div className="text-[10px] font-bold uppercase tracking-[.2em] text-[var(--spr-amber)]">Session expired</div><h1 className="mt-2 text-2xl font-semibold text-[var(--spr-text)]">Re-authentication required</h1><p className="mt-2 text-sm text-[var(--spr-text-muted)]">The extension could not access its protected evidence sources.</p><button onClick={() => onNavigate('/login')} className="spr-btn spr-btn-primary mt-5">Return to sign in</button></div>;

  const firstRoute = extension.sourceRoutes[0] || '/dashboard';
  return <section className="space-y-6">
    <div className="spr-panel p-6 md:p-8">
      <div><div className="mb-4 flex flex-wrap items-center gap-2"><span className="rounded-sm border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.18em] text-[#4ec9b0]">Extension workflow</span><span className="rounded-sm border border-[var(--spr-border)] px-2.5 py-1 text-[10px] text-[var(--spr-green)]">Protected evidence surface</span></div><h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-[var(--spr-text)] md:text-4xl">{extension.name}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--spr-text-muted)]">{extension.description}</p><div className="mt-6 flex flex-wrap gap-3"><button onClick={() => onNavigate(firstRoute)} className="spr-btn spr-btn-primary">Open source workflow</button><button onClick={() => setActiveStep((step) => Math.min(step + 1, extension.steps.length - 1))} className="spr-btn spr-btn-secondary">Advance workflow</button></div></div>
    </div>
    <div className="grid gap-3 md:grid-cols-3">{metrics.map((entry) => <Metric key={entry[0]} label={entry[0]} value={entry[1]} loading={loading} />)}</div>
    <div className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
      <div className="spr-panel p-5"><div className="mb-4"><div className="text-sm font-semibold text-[var(--spr-text)]">Workflow</div><div className="mt-1 text-xs text-[var(--spr-text-faint)]">Every extension owns its own operating sequence.</div></div><div className="space-y-2">{extension.steps.map((step, index) => <Step key={step} index={index} label={step} active={index === activeStep} />)}</div></div>
      <div className="spr-panel p-5"><div className="text-sm font-semibold text-[var(--spr-text)]">Observed evidence surface</div><p className="mt-1 text-xs leading-5 text-[var(--spr-text-faint)]">Counts are displayed only when the protected API returns a recognized collection. Unavailable sources are explicitly marked <span className="text-[var(--spr-text-muted)]">Not verified</span>.</p>{loadFailed && <div className="mt-3 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-3 text-xs text-[var(--spr-red)]">Evidence sources could not be loaded. No values are inferred.</div>}<div className="mt-5 space-y-3 text-xs">{[['Passports', snapshot.passports, '/passports'], ['Scans', snapshot.scans, '/scans'], ['Findings', snapshot.findings, '/alerts'], ['Clients', snapshot.clients, '/clients']].map(([label, value, path]) => <button key={String(label)} onClick={() => onNavigate(String(path))} className="flex w-full items-center justify-between rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-3 text-left hover:bg-[var(--spr-surface-hover)]"><span className="text-[var(--spr-text-muted)]">{label}</span><span className="font-semibold text-[var(--spr-text)]">{loading ? '—' : value === null ? 'Not verified' : String(value)} <span className="ml-2 text-[var(--spr-text-faint)]">→</span></span></button>)}</div></div>
    </div>
  </section>;
}
