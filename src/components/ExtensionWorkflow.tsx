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
  return <div><div className="text-[11px] text-[#605e5c]">{label}</div><div className="mt-1 text-lg font-semibold text-[#201f1e]">{display}</div></div>;
}

type StepProps = { index: number; label: string; active: boolean; key?: Key };
function Step({ index, label, active }: StepProps) {
  return <div className={`flex items-center gap-3 rounded border px-3 py-2 ${active ? 'border-[#0f6cbd] bg-[#eff6fc]' : 'border-[#e1dfdd] bg-white'}`}><span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${active ? 'bg-[#0f6cbd] text-white' : 'bg-[#f3f2f1] text-[#8a8886]'}`}>{index + 1}</span><span className={`text-[13px] ${active ? 'font-medium text-[#201f1e]' : 'text-[#605e5c]'}`}>{label}</span>{active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#0f6cbd]" />}</div>;
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

  if (!extension) return <div className="rounded-md border border-[#e1dfdd] bg-[#fdf2f2] p-4 text-[13px] text-[#a4262c]">Extension not found.</div>;
  if (unauthorized) return <div className="rounded-md border border-[#e1dfdd] bg-white p-5">
    <div className="text-[11px] uppercase tracking-wide text-[#8a5700]">Session expired</div>
    <h1 className="mt-1 text-[20px] font-semibold text-[#201f1e]">Re-authentication required</h1>
    <p className="mt-1 text-[13px] text-[#605e5c]">The extension could not access its protected evidence sources.</p>
    <button onClick={() => onNavigate('/login')} className="mt-4 h-9 rounded bg-[#0f6cbd] px-4 text-[13px] font-medium text-white hover:bg-[#004578]">Return to sign in</button>
  </div>;

  const firstRoute = extension.sourceRoutes[0] || '/dashboard';
  return <section className="space-y-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-[#8a8886]">
          <span className="rounded bg-[#f3f2f1] px-1.5 py-0.5 uppercase tracking-wide">Extension workflow</span>
          <span className="text-[#0e700e]">Protected evidence surface</span>
        </span>
        <h1 className="mt-1 text-[22px] font-semibold text-[#201f1e]">{extension.name}</h1>
        <p className="mt-1 max-w-2xl text-[13px] text-[#605e5c]">{extension.description}</p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <button onClick={() => onNavigate(firstRoute)} className="h-9 rounded bg-[#0f6cbd] px-3 text-[13px] font-medium text-white hover:bg-[#004578]">Open source workflow</button>
        <button onClick={() => setActiveStep((step) => Math.min(step + 1, extension.steps.length - 1))} className="h-9 rounded border border-[#c8c6c4] px-3 text-[13px] font-medium text-[#323130] hover:bg-black/[.03]">Advance workflow</button>
      </div>
    </div>

    <div className="flex flex-wrap gap-6 rounded-md border border-[#e1dfdd] bg-white p-3">{metrics.map(([label, value]: readonly [string, MetricValue]) => <Metric key={label} label={label} value={value} loading={loading} />)}</div>

    <div className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
      <div className="rounded-md border border-[#e1dfdd] bg-white p-4">
        <div className="mb-3">
          <div className="text-[13px] font-semibold text-[#201f1e]">Workflow</div>
          <div className="mt-0.5 text-[11px] text-[#8a8886]">Every extension owns its own operating sequence.</div>
        </div>
        <div className="space-y-1.5">{extension.steps.map((step, index) => <Step key={step} index={index} label={step} active={index === activeStep} />)}</div>
      </div>
      <div className="rounded-md border border-[#e1dfdd] bg-white p-4">
        <div className="text-[13px] font-semibold text-[#201f1e]">Observed evidence surface</div>
        <p className="mt-1 text-[12px] leading-5 text-[#8a8886]">Counts are displayed only when the protected API returns a recognized collection. Unavailable sources are explicitly marked <span className="text-[#605e5c]">Not verified</span>.</p>
        {loadFailed && <div className="mt-3 rounded border border-[#e1dfdd] bg-[#fdf2f2] p-3 text-[12px] text-[#a4262c]">Evidence sources could not be loaded. No values are inferred.</div>}
        <div className="mt-3 space-y-1.5">{[['Passports', snapshot.passports, '/passports'], ['Scans', snapshot.scans, '/scans'], ['Findings', snapshot.findings, '/alerts'], ['Clients', snapshot.clients, '/clients']].map(([label, value, path]) => <button key={String(label)} onClick={() => onNavigate(String(path))} className="flex w-full items-center justify-between rounded border border-[#e1dfdd] px-3 py-2 text-left text-[13px] hover:border-[#c8c6c4] hover:bg-black/[.02]"><span className="text-[#605e5c]">{label}</span><span className="font-medium text-[#201f1e]">{loading ? '—' : value === null ? 'Not verified' : String(value)} <span className="ml-2 text-[#8a8886]">→</span></span></button>)}</div>
      </div>
    </div>
  </section>;
}
