import { useEffect, useMemo, useState } from 'react';
import { Download, FileJson, FileText, Printer, RefreshCw, ShieldCheck } from 'lucide-react';
import type { Alert, Client, Scan, SoftwarePassport } from '../types';
import { apiFetch } from '../utils/apiClient';

type ReportPayload = {
  schemaVersion?: string;
  reportType?: string;
  generatedAt?: string;
  passport?: { id?: string; name?: string };
  risk?: { overall?: number | null; security?: number | null; compliance?: number | null };
  evidenceQuality?: { completenessBasisPoints?: number; unknownDimensions?: number; latestObservationAt?: string | null };
  findings?: unknown[];
  evidence?: unknown[];
  observations?: unknown[];
  remediation?: unknown[];
  verification?: unknown[];
  traceability?: string;
  limitations?: Array<{ evidenceId?: string; limitation?: string }>;
  reportHash?: string;
};

interface ReportsViewProps {
  clients?: Client[];
  passports?: SoftwarePassport[];
  scans?: Scan[];
  alerts?: Alert[];
  findings?: unknown[];
}

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value: unknown) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function clientName(passport: SoftwarePassport, clients: Client[]) {
  const clientId = String((passport as SoftwarePassport & { clientId?: string }).clientId || '');
  return clients.find((client) => client.id === clientId)?.name || 'Unassigned client';
}

export default function ReportsView({ clients = [], passports = [], scans = [], alerts = [], findings = [] }: ReportsViewProps) {
  const [selectedPassportId, setSelectedPassportId] = useState(passports[0]?.id || '');
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!passports.some((passport) => passport.id === selectedPassportId)) {
      setSelectedPassportId(passports[0]?.id || '');
    }
  }, [passports, selectedPassportId]);

  const selectedPassport = passports.find((passport) => passport.id === selectedPassportId);
  const evidenceCount = passports.reduce((total, passport) => total + passport.evidence.length, 0);
  const vulnerabilityCount = passports.reduce((total, passport) => total + passport.vulnerabilities.length, 0);
  const findingCount = findings.length;

  const loadReport = async () => {
    if (!selectedPassport) return;
    setLoading(true);
    setMessage('');
    try {
      const response = await apiFetch(`/api/trust-loop/reports/${encodeURIComponent(selectedPassport.id)}?type=executive`);
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(String(payload?.error || `Report request failed (${response.status})`));
      setReport(payload as ReportPayload);
      setMessage('Authoritative report loaded from the tenant-scoped trust report endpoint.');
    } catch (error) {
      setReport(null);
      setMessage(error instanceof Error ? error.message : 'Unable to load the report.');
    } finally {
      setLoading(false);
    }
  };

  const exportReportJson = () => {
    if (!report || !selectedPassport) return;
    download(`spr-report-${selectedPassport.id}.json`, JSON.stringify(report, null, 2), 'application/json');
  };

  const exportRegistryCsv = () => {
    const rows = [
      ['recordType', 'id', 'name', 'version', 'client', 'status', 'severity', 'observedAt'],
      ...passports.map((passport) => ['passport', passport.id, passport.name, passport.version, clientName(passport, clients), 'registered', '', passport.releaseDate]),
      ...passports.flatMap((passport) => passport.evidence.map((item: any) => ['evidence', item.id, item.name, '', clientName(passport, clients), item.status || item.verificationStatus, '', item.timestamp])),
      ...passports.flatMap((passport) => passport.vulnerabilities.map((item: any) => ['vulnerability', item.id, item.title || item.id, item.component || '', clientName(passport, clients), item.status, item.severity, item.detectedAt || item.publishedDate])),
      ...findings.map((finding: any) => ['finding', finding.id, finding.title || finding.control_id, '', clients.find((client) => client.id === String(finding.client_id || ''))?.name || 'Unassigned client', finding.status, finding.severity, finding.updated_at]),
      ...scans.map((scan) => ['scan', scan.id, scan.targetName, '', scan.clientName, scan.status, '', scan.timestamp]),
      ...alerts.map((alert) => ['alert', alert.id, alert.title, '', alert.clientName, alert.status, alert.severity, alert.timestamp]),
    ];
    download('spr-registry-records.csv', rows.map((row) => row.map(csvCell).join(',')).join('\n'), 'text/csv;charset=utf-8');
  };

  const reportText = useMemo(() => {
    if (!report) return '';
    return [
      `SPR trust report: ${report.passport?.name || selectedPassport?.name || 'Passport'}`,
      `Generated: ${report.generatedAt || 'unknown'}`,
      `Report hash: ${report.reportHash || 'not returned'}`,
      `Evidence records: ${report.evidence?.length ?? 0}`,
      `Findings: ${report.findings?.length ?? 0}`,
      `Observations: ${report.observations?.length ?? 0}`,
      `Remediation records: ${report.remediation?.length ?? 0}`,
      `Traceability: ${report.traceability || 'not returned'}`,
      ...(report.limitations || []).map((item) => `Limitation (${item.evidenceId || 'evidence'}): ${item.limitation || 'not specified'}`),
    ].join('\n');
  }, [report, selectedPassport]);

  return (
    <section className="space-y-6" aria-labelledby="reports-title">
      <header className="flex flex-col gap-4 rounded-3xl border border-white/[.08] bg-white/[.035] p-6 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[.22em] text-cyan-200">Reports center</div>
          <h1 id="reports-title" className="mt-2 text-3xl font-semibold tracking-tight">Evidence-backed reporting</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Exports contain records loaded from this tenant’s existing APIs. No trust score, compliance claim, or finding is inferred in this view.</p>
        </div>
        <button onClick={() => window.print()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[.04] px-4 py-2.5 text-sm font-semibold text-slate-200 hover:border-cyan-300/30 hover:text-white"><Printer size={16} /> Print / save PDF</button>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Clients', clients.length, 'Persisted client records'],
          ['Passports', passports.length, 'Registered software identity'],
          ['Evidence', evidenceCount, 'Nested passport evidence'],
          ['Findings / vulnerabilities', findingCount + vulnerabilityCount, 'Loaded finding and vulnerability records'],
        ].map(([label, value, detail]) => (
          <div key={String(label)} className="rounded-2xl border border-white/[.08] bg-white/[.03] p-4">
            <div className="text-[10px] font-bold uppercase tracking-[.18em] text-slate-500">{label}</div>
            <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
            <div className="mt-1 text-xs text-slate-500">{detail}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_.9fr]">
        <div className="rounded-3xl border border-white/[.08] bg-white/[.035] p-6">
          <div className="flex items-center gap-2"><ShieldCheck size={18} className="text-cyan-200" /><h2 className="text-lg font-semibold">Tenant registry exports</h2></div>
          <p className="mt-2 text-sm text-slate-400">CSV includes the loaded client, passport, evidence, vulnerability, finding, scan, and alert records.</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button onClick={exportRegistryCsv} disabled={!passports.length && !clients.length} className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"><Download size={16} /> Export registry CSV</button>
          </div>
          <div className="mt-6 border-t border-white/[.08] pt-5">
            <h3 className="text-sm font-semibold text-slate-200">Server report snapshot</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">Loads <code>/api/trust-loop/reports/:passportId</code>, which returns persisted findings, evidence, observations, remediation, verification, limitations, and a report hash.</p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <select value={selectedPassportId} onChange={(event) => { setSelectedPassportId(event.target.value); setReport(null); setMessage(''); }} className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#0b101b] px-3 py-2.5 text-sm text-slate-200">
                {!passports.length && <option value="">No passports loaded</option>}
                {passports.map((passport) => <option key={passport.id} value={passport.id}>{passport.name} · {passport.version}</option>)}
              </select>
              <button onClick={() => void loadReport()} disabled={!selectedPassport || loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-300/25 bg-cyan-300/10 px-4 py-2.5 text-sm font-semibold text-cyan-100 disabled:opacity-40"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> {loading ? 'Loading…' : 'Load report'}</button>
            </div>
            {message && <p className="mt-3 text-xs text-slate-400" role="status">{message}</p>}
          </div>
        </div>

        <div className="rounded-3xl border border-white/[.08] bg-white/[.035] p-6">
          <h2 className="text-lg font-semibold">Download loaded report</h2>
          <p className="mt-2 text-sm text-slate-400">JSON is the exact server response. Use browser print for a human-readable, PDF-friendly copy.</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button onClick={exportReportJson} disabled={!report} className="inline-flex items-center gap-2 rounded-xl border border-violet-300/25 bg-violet-300/10 px-4 py-2.5 text-sm font-semibold text-violet-100 disabled:opacity-40"><FileJson size={16} /> Export JSON</button>
            <button onClick={() => window.print()} disabled={!report} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[.04] px-4 py-2.5 text-sm font-semibold text-slate-200 disabled:opacity-40"><FileText size={16} /> Print report</button>
          </div>
          <pre className="mt-5 max-h-64 overflow-auto rounded-2xl border border-white/[.07] bg-black/20 p-4 text-xs leading-5 text-slate-400 whitespace-pre-wrap">{reportText || 'Load a passport report to preview its persisted traceability and limitations.'}</pre>
        </div>
      </div>

      <div className="rounded-2xl border border-amber-300/15 bg-amber-300/[.04] p-4 text-xs leading-5 text-amber-100/75">
        <strong className="text-amber-100">Capability boundary:</strong> There is no server-side PDF endpoint in the available API surface. Print / save PDF uses the browser’s print dialog; it does not create a signed or server-generated PDF. Empty datasets remain empty and are not replaced with sample values.
      </div>
    </section>
  );
}
