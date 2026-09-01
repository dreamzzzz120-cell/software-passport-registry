import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Copy, Download, FileJson, FileText, History, Package, Printer, RefreshCw, Share2, ShieldCheck, Upload, Users } from 'lucide-react';
import type { Alert, Client, Scan, SoftwarePassport } from '../types';
import { apiFetch } from '../utils/apiClient';
import { generateCoBrandedTrustReport, generatePassportEvidenceReport } from '../utils/pdfGenerator';

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
  sbom?: Array<{ name?: string; version?: string; license?: string; vulnerabilityCount?: number; criticalOrHighCount?: number }>;
  controls?: Array<{ controlId?: string; findingCount?: number; openCount?: number; worstSeverity?: string }>;
};

type ReportSnapshot = {
  id: string;
  report_type: string;
  generated_at: string;
  score: number;
  completeness_basis_points: number;
  canonical_payload_hash: string;
};

type ShareInfo = { shareUrl: string; expiresAt: string; reportType: string };

const REPORT_TYPES: Array<{ value: string; label: string }> = [
  { value: 'executive', label: 'Executive trust report' },
  { value: 'technical', label: 'Technical / engineering' },
  { value: 'compliance', label: 'Compliance (by control)' },
  { value: 'sbom', label: 'SBOM report' },
  { value: 'vendor', label: 'Vendor risk' },
  { value: 'msp', label: 'MSP / client' },
  { value: 'customer', label: 'Customer-facing' },
  { value: 'auditor', label: 'Auditor' },
  { value: 'evidence-ledger', label: 'Evidence ledger' },
];

const SHARE_ROLES = new Set(['Owner', 'Admin', 'Operator']);

interface ReportsViewProps {
  clients?: Client[];
  passports?: SoftwarePassport[];
  scans?: Scan[];
  alerts?: Alert[];
  findings?: unknown[];
  role?: string;
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

export default function ReportsView({ clients = [], passports = [], scans = [], alerts = [], findings = [], role = 'Viewer' }: ReportsViewProps) {
  const [selectedPassportId, setSelectedPassportId] = useState(passports[0]?.id || '');
  const [reportType, setReportType] = useState('executive');
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<ReportSnapshot[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [shareInfo, setShareInfo] = useState<ShareInfo | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareMessage, setShareMessage] = useState('');
  const [exportClientIds, setExportClientIds] = useState<Set<string>>(new Set());

  const [whiteLabelClientId, setWhiteLabelClientId] = useState(clients[0]?.id || '');
  const [mspName, setMspName] = useState('');
  const [brandColor, setBrandColor] = useState('#22d3ee');
  const [reportTitle, setReportTitle] = useState('Software Trust & Compliance Ledger');
  const [executiveSummary, setExecutiveSummary] = useState('');
  const [logoBase64, setLogoBase64] = useState<string | undefined>(undefined);
  const [sections, setSections] = useState({ summary: true, metrics: true, inventory: true, compliance: true, signatures: true });

  const canShare = SHARE_ROLES.has(role);

  useEffect(() => {
    if (!passports.some((passport) => passport.id === selectedPassportId)) {
      setSelectedPassportId(passports[0]?.id || '');
    }
  }, [passports, selectedPassportId]);

  useEffect(() => {
    if (!clients.some((client) => client.id === whiteLabelClientId)) {
      setWhiteLabelClientId(clients[0]?.id || '');
    }
  }, [clients, whiteLabelClientId]);

  useEffect(() => {
    setReport(null);
    setHistory([]);
    setShareInfo(null);
    setShareMessage('');
    setMessage('');
  }, [selectedPassportId, reportType]);

  const selectedPassport = passports.find((passport) => passport.id === selectedPassportId);
  const evidenceCount = passports.reduce((total, passport) => total + passport.evidence.length, 0);
  const vulnerabilityCount = passports.reduce((total, passport) => total + passport.vulnerabilities.length, 0);
  const findingCount = findings.length;

  const loadHistory = async (passportId: string) => {
    setHistoryLoading(true);
    try {
      const response = await apiFetch(`/api/trust-loop/reports/${encodeURIComponent(passportId)}/history?type=${encodeURIComponent(reportType)}`);
      const payload = await response.json().catch(() => null);
      if (response.ok) setHistory(Array.isArray(payload?.snapshots) ? payload.snapshots : []);
    } finally {
      setHistoryLoading(false);
    }
  };

  const loadReport = async () => {
    if (!selectedPassport) return;
    setLoading(true);
    setMessage('');
    try {
      const response = await apiFetch(`/api/trust-loop/reports/${encodeURIComponent(selectedPassport.id)}?type=${encodeURIComponent(reportType)}`);
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(String(payload?.error || `Report request failed (${response.status})`));
      setReport(payload as ReportPayload);
      setMessage('Authoritative report loaded from the tenant-scoped trust report endpoint.');
      void loadHistory(selectedPassport.id);
    } catch (error) {
      setReport(null);
      setMessage(error instanceof Error ? error.message : 'Unable to load the report.');
    } finally {
      setLoading(false);
    }
  };

  const loadSnapshot = async (snapshotId: string) => {
    if (!selectedPassport) return;
    setLoading(true);
    setMessage('');
    try {
      const response = await apiFetch(`/api/trust-loop/reports/${encodeURIComponent(selectedPassport.id)}/history/${encodeURIComponent(snapshotId)}`);
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(String(payload?.error || `Snapshot request failed (${response.status})`));
      setReport(payload as ReportPayload);
      setMessage('Loaded a historical snapshot of this report. Re-run "Load report" for the current state.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load that snapshot.');
    } finally {
      setLoading(false);
    }
  };

  const createShareLink = async () => {
    if (!selectedPassport) return;
    setSharing(true);
    setShareMessage('');
    try {
      const response = await apiFetch(`/api/public/v1/reports/${encodeURIComponent(selectedPassport.id)}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: reportType }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(String(payload?.error || `Share link request failed (${response.status})`));
      setShareInfo({ shareUrl: payload.shareUrl, expiresAt: payload.expiresAt, reportType: payload.reportType });
    } catch (error) {
      setShareInfo(null);
      setShareMessage(error instanceof Error ? error.message : 'Unable to create a share link.');
    } finally {
      setSharing(false);
    }
  };

  const copyShareLink = async () => {
    if (!shareInfo) return;
    try {
      await navigator.clipboard.writeText(shareInfo.shareUrl);
      setShareMessage('Share link copied to clipboard.');
    } catch {
      setShareMessage('Copy failed — select and copy the link manually.');
    }
  };

  const downloadPdf = () => {
    if (!selectedPassport) return;
    generatePassportEvidenceReport(selectedPassport, 'SPR Reports Center', '#22d3ee');
  };

  const exportReportJson = () => {
    if (!report || !selectedPassport) return;
    download(`spr-report-${selectedPassport.id}-${reportType}.json`, JSON.stringify(report, null, 2), 'application/json');
  };

  const exportRegistryCsv = () => {
    const clientFilter = exportClientIds.size > 0 ? exportClientIds : null;
    const passportInScope = (passport: SoftwarePassport) => !clientFilter || clientFilter.has(String((passport as SoftwarePassport & { clientId?: string }).clientId || ''));
    const scopedPassports = passports.filter(passportInScope);
    const scopedClients = clientFilter ? clients.filter((client) => clientFilter.has(client.id)) : clients;
    const rows = [
      ['recordType', 'id', 'name', 'version', 'client', 'status', 'severity', 'observedAt'],
      ...scopedPassports.map((passport) => ['passport', passport.id, passport.name, passport.version, clientName(passport, clients), 'registered', '', passport.releaseDate]),
      ...scopedPassports.flatMap((passport) => passport.evidence.map((item: any) => ['evidence', item.id, item.name, '', clientName(passport, clients), item.status || item.verificationStatus, '', item.timestamp])),
      ...scopedPassports.flatMap((passport) => passport.vulnerabilities.map((item: any) => ['vulnerability', item.id, item.title || item.id, item.component || '', clientName(passport, clients), item.status, item.severity, item.detectedAt || item.publishedDate])),
      ...findings.filter((finding: any) => !clientFilter || clientFilter.has(String(finding.client_id || ''))).map((finding: any) => ['finding', finding.id, finding.title || finding.control_id, '', clients.find((client) => client.id === String(finding.client_id || ''))?.name || 'Unassigned client', finding.status, finding.severity, finding.updated_at]),
      ...scans.filter((scan) => !clientFilter || scopedClients.some((client) => client.name === scan.clientName)).map((scan) => ['scan', scan.id, scan.targetName, '', scan.clientName, scan.status, '', scan.timestamp]),
      ...alerts.filter((alert) => !clientFilter || scopedClients.some((client) => client.name === alert.clientName)).map((alert) => ['alert', alert.id, alert.title, '', alert.clientName, alert.status, alert.severity, alert.timestamp]),
    ];
    const suffix = clientFilter ? `-${scopedClients.length}-clients` : '';
    download(`spr-registry-records${suffix}.csv`, rows.map((row) => row.map(csvCell).join(',')).join('\n'), 'text/csv;charset=utf-8');
  };

  const toggleExportClient = (clientId: string) => {
    setExportClientIds((current) => { const next = new Set(current); if (next.has(clientId)) next.delete(clientId); else next.add(clientId); return next; });
  };

  const handleLogoUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setLogoBase64(typeof reader.result === 'string' ? reader.result : undefined);
    reader.readAsDataURL(file);
  };

  const generateWhiteLabelReport = () => {
    const client = clients.find((item) => item.id === whiteLabelClientId);
    if (!client || !mspName.trim()) return;
    generateCoBrandedTrustReport(client, mspName.trim(), brandColor, reportTitle, 0, executiveSummary, logoBase64, sections.summary, sections.metrics, sections.inventory, sections.compliance, sections.signatures);
  };

  const reportText = useMemo(() => {
    if (!report) return '';
    return [
      `SPR ${report.reportType || reportType} report: ${report.passport?.name || selectedPassport?.name || 'Passport'}`,
      `Generated: ${report.generatedAt || 'unknown'}`,
      `Report hash: ${report.reportHash || 'not returned'}`,
      `Evidence records: ${report.evidence?.length ?? 0}`,
      `Findings: ${report.findings?.length ?? 0}`,
      `Observations: ${report.observations?.length ?? 0}`,
      `Remediation records: ${report.remediation?.length ?? 0}`,
      `Traceability: ${report.traceability || 'not returned'}`,
      ...(report.limitations || []).map((item) => `Limitation (${item.evidenceId || 'evidence'}): ${item.limitation || 'not specified'}`),
    ].join('\n');
  }, [report, selectedPassport, reportType]);

  return (
    <section aria-labelledby="reports-title">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 id="reports-title" className="text-[22px] font-semibold text-[#201f1e]">Reports center</h1>
          <p className="mt-1 text-[13px] text-[#605e5c]">Evidence-backed exports and reports loaded from this tenant's existing APIs.</p>
        </div>
        <button onClick={() => window.print()} className="inline-flex h-8 items-center gap-1.5 rounded border border-[#c8c6c4] px-3 text-[13px] font-medium text-[#323130] hover:bg-black/[.03]"><Printer size={14} /> Print / save PDF</button>
      </div>

      <details className="mb-4 rounded-md border border-[#e1dfdd] bg-[#faf9f8] text-[13px]">
        <summary className="cursor-pointer select-none px-3 py-2 font-medium text-[#323130]">ⓘ What is this? · How it works</summary>
        <div className="px-3 pb-3 text-[#605e5c]">
          <p>Exports contain only records loaded from this tenant's existing APIs. No trust score, compliance claim, or finding is inferred in this view.</p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
            <li>Export a registry CSV, or select a passport and report type to load a server-generated report.</li>
            <li>Download the loaded report as JSON/PDF, or create a signed, expiring share link.</li>
            <li>Optionally generate a co-branded white-label PDF for one client.</li>
          </ol>
        </div>
      </details>

      <div className="mb-4 flex flex-wrap gap-6 rounded-md border border-[#e1dfdd] bg-white p-3">
        {[
          ['Clients', clients.length, 'Persisted client records'],
          ['Passports', passports.length, 'Registered software identity'],
          ['Evidence', evidenceCount, 'Nested passport evidence'],
          ['Findings / vulnerabilities', findingCount + vulnerabilityCount, 'Loaded finding and vulnerability records'],
        ].map(([label, value, detail]) => (
          <div key={String(label)}>
            <div className="text-[11px] text-[#605e5c]">{label}</div>
            <div className="text-lg font-semibold text-[#201f1e]">{value}</div>
            <div className="text-[11px] text-[#8a8886]">{detail}</div>
          </div>
        ))}
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
        <div className="rounded-md border border-[#e1dfdd] bg-white p-4">
          <div className="flex items-center gap-1.5"><ShieldCheck size={16} className="text-[#605e5c]" /><h2 className="text-[14px] font-semibold text-[#201f1e]">Tenant registry exports</h2></div>
          <p className="mt-1 text-[13px] text-[#605e5c]">CSV includes the loaded client, passport, evidence, vulnerability, finding, scan, and alert records.</p>
          {clients.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Users size={13} className="text-[#8a8886]" />
              <span className="text-[12px] text-[#605e5c]">{exportClientIds.size === 0 ? 'All clients' : `${exportClientIds.size} of ${clients.length} clients selected`}</span>
              <div className="flex flex-wrap gap-1.5">
                {clients.map((client) => (
                  <button key={client.id} onClick={() => toggleExportClient(client.id)} className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${exportClientIds.has(client.id) ? 'border-[#0f6cbd] bg-[#eff6fc] text-[#0f6cbd]' : 'border-[#c8c6c4] bg-white text-[#605e5c]'}`}>{client.name}</button>
                ))}
              </div>
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={exportRegistryCsv} disabled={!passports.length && !clients.length} className="inline-flex h-8 items-center gap-1.5 rounded bg-[#0f6cbd] px-3 text-[13px] font-medium text-white hover:bg-[#004578] disabled:cursor-not-allowed disabled:opacity-40"><Download size={14} /> Export registry CSV</button>
          </div>
          <div className="mt-4 border-t border-[#e1dfdd] pt-4">
            <h3 className="text-[13px] font-semibold text-[#201f1e]">Server report snapshot</h3>
            <p className="mt-1 text-[12px] leading-5 text-[#605e5c]">Loads <code className="rounded bg-[#f3f2f1] px-1 py-0.5">/api/trust-loop/reports/:passportId</code>, which returns persisted findings, evidence, observations, remediation, verification, limitations, and a report hash.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <select value={selectedPassportId} onChange={(event) => setSelectedPassportId(event.target.value)} className="h-9 min-w-0 flex-1 rounded border border-[#c8c6c4] bg-white px-3 text-[13px] text-[#201f1e] focus:border-[#0f6cbd] focus:ring-1 focus:ring-[#0f6cbd]">
                {!passports.length && <option value="">No passports loaded</option>}
                {passports.map((passport) => <option key={passport.id} value={passport.id}>{passport.name} · {passport.version}</option>)}
              </select>
              <select value={reportType} onChange={(event) => setReportType(event.target.value)} className="h-9 min-w-0 flex-1 rounded border border-[#c8c6c4] bg-white px-3 text-[13px] text-[#201f1e] focus:border-[#0f6cbd] focus:ring-1 focus:ring-[#0f6cbd]">
                {REPORT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
              </select>
              <button onClick={() => void loadReport()} disabled={!selectedPassport || loading} className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded border border-[#0f6cbd] bg-[#eff6fc] px-3 text-[13px] font-medium text-[#0f6cbd] disabled:cursor-not-allowed disabled:opacity-40"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> {loading ? 'Loading…' : 'Load report'}</button>
            </div>
            {message && <p className="mt-2 text-[12px] text-[#605e5c]" role="status">{message}</p>}
          </div>

          <div className="mt-4 border-t border-[#e1dfdd] pt-4">
            <div className="flex items-center gap-1.5"><History size={14} className="text-[#605e5c]" /><h3 className="text-[13px] font-semibold text-[#201f1e]">Report history</h3></div>
            <p className="mt-1 text-[12px] leading-5 text-[#605e5c]">Every generated report is hashed and versioned. Load a passport report above to populate history for the selected type.</p>
            {historyLoading && <p className="mt-2 text-[12px] text-[#605e5c]">Loading history…</p>}
            {!historyLoading && history.length === 0 && <p className="mt-2 text-[12px] text-[#605e5c]">No prior snapshots for this passport and report type yet.</p>}
            {history.length > 0 && (
              <ul className="mt-2 max-h-48 space-y-1.5 overflow-auto pr-1">
                {history.map((snapshot) => (
                  <li key={snapshot.id}>
                    <button onClick={() => void loadSnapshot(snapshot.id)} className="w-full rounded border border-[#e1dfdd] bg-[#faf9f8] px-3 py-2 text-left text-[12px] text-[#323130] hover:border-[#0f6cbd] hover:bg-[#eff6fc]">
                      <div className="flex items-center justify-between gap-2">
                        <span>{new Date(snapshot.generated_at).toLocaleString()}</span>
                        <span className="text-[#605e5c]">score {snapshot.score}</span>
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-[#8a8886]">{snapshot.canonical_payload_hash}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="rounded-md border border-[#e1dfdd] bg-white p-4">
          <h2 className="text-[14px] font-semibold text-[#201f1e]">Download loaded report</h2>
          <p className="mt-1 text-[13px] text-[#605e5c]">JSON is the exact server response. PDF is generated client-side from the loaded passport's SBOM, evidence, and timeline.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={exportReportJson} disabled={!report} className="inline-flex h-8 items-center gap-1.5 rounded border border-[#c8c6c4] px-3 text-[13px] font-medium text-[#323130] hover:bg-black/[.03] disabled:cursor-not-allowed disabled:opacity-40"><FileJson size={14} /> Export JSON</button>
            <button onClick={downloadPdf} disabled={!selectedPassport} className="inline-flex h-8 items-center gap-1.5 rounded border border-[#c8c6c4] px-3 text-[13px] font-medium text-[#323130] hover:bg-black/[.03] disabled:cursor-not-allowed disabled:opacity-40"><FileText size={14} /> Download PDF</button>
          </div>

          <div className="mt-4 border-t border-[#e1dfdd] pt-4">
            <div className="flex items-center gap-1.5"><Share2 size={14} className="text-[#605e5c]" /><h3 className="text-[13px] font-semibold text-[#201f1e]">Shareable link</h3></div>
            <p className="mt-1 text-[12px] leading-5 text-[#605e5c]">
              {canShare
                ? 'Creates a signed, tenant-scoped link that expires in 7 days. Anyone with the link sees a redacted, evidence-backed summary — no internal remediation or verification detail.'
                : `Your ${role} role cannot create share links. Owner, Admin, or Operator is required.`}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button onClick={() => void createShareLink()} disabled={!canShare || !selectedPassport || sharing} className="inline-flex h-8 items-center gap-1.5 rounded border border-[#c8c6c4] px-3 text-[13px] font-medium text-[#323130] hover:bg-black/[.03] disabled:cursor-not-allowed disabled:opacity-40">
                <Share2 size={14} className={sharing ? 'animate-pulse' : ''} /> {sharing ? 'Creating…' : 'Create share link'}
              </button>
              {shareInfo && (
                <button onClick={() => void copyShareLink()} className="inline-flex h-8 items-center gap-1.5 rounded border border-[#0f6cbd] bg-[#eff6fc] px-2.5 text-[12px] font-medium text-[#0f6cbd]"><Copy size={13} /> Copy link</button>
              )}
            </div>
            {shareInfo && (
              <div className="mt-2 rounded border border-[#e1dfdd] bg-[#faf9f8] p-2.5 text-[12px] text-[#605e5c]">
                <div className="truncate font-mono text-[#323130]">{shareInfo.shareUrl}</div>
                <div className="mt-0.5 text-[#8a8886]">Expires {new Date(shareInfo.expiresAt).toLocaleString()}</div>
              </div>
            )}
            {shareMessage && <p className="mt-1.5 text-[12px] text-[#605e5c]" role="status">{shareMessage}</p>}
          </div>

          <pre className="mt-4 max-h-64 overflow-auto rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-3 text-[12px] leading-5 text-[#605e5c] whitespace-pre-wrap">{reportText || 'Load a passport report to preview its persisted traceability and limitations.'}</pre>
        </div>
      </div>

      {report?.sbom && (
        <div className="mb-4 rounded-md border border-[#e1dfdd] bg-white p-4">
          <div className="flex items-center gap-1.5"><Package size={16} className="text-[#605e5c]" /><h2 className="text-[14px] font-semibold text-[#201f1e]">SBOM components</h2></div>
          <p className="mt-1 text-[13px] text-[#605e5c]">Each component is cross-referenced against this passport's recorded vulnerabilities by name.</p>
          <div className="mt-3 overflow-auto">
            <table className="w-full min-w-[560px] text-left text-[13px]">
              <thead className="border-b border-[#e1dfdd] text-[11px] uppercase tracking-wide text-[#605e5c]"><tr><th className="px-3 py-2">Component</th><th className="px-3 py-2">Version</th><th className="px-3 py-2">License</th><th className="px-3 py-2">Vulnerabilities</th><th className="px-3 py-2">Critical/High</th></tr></thead>
              <tbody>
                {report.sbom.length === 0 && <tr><td colSpan={5} className="px-3 py-2.5 text-[#605e5c]">No SBOM components recorded for this passport.</td></tr>}
                {report.sbom.map((component, index) => (
                  <tr key={`${component.name}-${index}`} className="border-b border-[#f3f2f1] hover:bg-black/[.02]">
                    <td className="px-3 py-2.5 text-[#201f1e]">{component.name || '—'}</td>
                    <td className="px-3 py-2.5 text-[#605e5c]">{component.version || '—'}</td>
                    <td className="px-3 py-2.5 text-[#605e5c]">{component.license || '—'}</td>
                    <td className="px-3 py-2.5 text-[#605e5c]">{component.vulnerabilityCount ?? 0}</td>
                    <td className="px-3 py-2.5 text-[#605e5c]">{component.criticalOrHighCount ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {report?.controls && (
        <div className="mb-4 rounded-md border border-[#e1dfdd] bg-white p-4">
          <div className="flex items-center gap-1.5"><ShieldCheck size={16} className="text-[#605e5c]" /><h2 className="text-[14px] font-semibold text-[#201f1e]">Findings by control</h2></div>
          <p className="mt-1 text-[13px] text-[#605e5c]">Open trust findings grouped by control ID, worst-observed severity first.</p>
          <div className="mt-3 overflow-auto">
            <table className="w-full min-w-[480px] text-left text-[13px]">
              <thead className="border-b border-[#e1dfdd] text-[11px] uppercase tracking-wide text-[#605e5c]"><tr><th className="px-3 py-2">Control</th><th className="px-3 py-2">Findings</th><th className="px-3 py-2">Open</th><th className="px-3 py-2">Worst severity</th></tr></thead>
              <tbody>
                {report.controls.length === 0 && <tr><td colSpan={4} className="px-3 py-2.5 text-[#605e5c]">No control-mapped findings for this passport.</td></tr>}
                {report.controls.map((control) => (
                  <tr key={control.controlId} className="border-b border-[#f3f2f1] hover:bg-black/[.02]">
                    <td className="px-3 py-2.5 font-mono text-[#201f1e]">{control.controlId || '—'}</td>
                    <td className="px-3 py-2.5 text-[#605e5c]">{control.findingCount ?? 0}</td>
                    <td className="px-3 py-2.5 text-[#605e5c]">{control.openCount ?? 0}</td>
                    <td className="px-3 py-2.5 capitalize text-[#605e5c]">{control.worstSeverity || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {clients.length > 0 && (
        <div className="mb-4 rounded-md border border-[#e1dfdd] bg-white p-4">
          <h2 className="text-[14px] font-semibold text-[#201f1e]">White-label client report</h2>
          <p className="mt-1 text-[13px] text-[#605e5c]">Generates a co-branded PDF for one client using your MSP name, logo, and brand color. Runs entirely in the browser from already-loaded client data.</p>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div className="space-y-2">
              <select value={whiteLabelClientId} onChange={(event) => setWhiteLabelClientId(event.target.value)} className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-3 text-[13px] text-[#201f1e] focus:border-[#0f6cbd] focus:ring-1 focus:ring-[#0f6cbd]">
                {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
              <input value={mspName} onChange={(event) => setMspName(event.target.value)} placeholder="Your MSP / firm name *" className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-3 text-[13px] text-[#201f1e] placeholder:text-[#8a8886] focus:border-[#0f6cbd] focus:ring-1 focus:ring-[#0f6cbd]" />
              <input value={reportTitle} onChange={(event) => setReportTitle(event.target.value)} placeholder="Report title" className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-3 text-[13px] text-[#201f1e] focus:border-[#0f6cbd] focus:ring-1 focus:ring-[#0f6cbd]" />
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-[12px] text-[#605e5c]">Brand color <input type="color" value={brandColor} onChange={(event) => setBrandColor(event.target.value)} className="h-8 w-8 rounded border border-[#c8c6c4] bg-transparent" /></label>
                <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded border border-[#c8c6c4] px-3 text-[12px] text-[#323130] hover:bg-black/[.03]"><Upload size={13} /> {logoBase64 ? 'Logo uploaded' : 'Upload logo'}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleLogoUpload} className="hidden" /></label>
              </div>
              <textarea value={executiveSummary} onChange={(event) => setExecutiveSummary(event.target.value)} placeholder="Executive summary (optional)" rows={3} className="w-full rounded border border-[#c8c6c4] bg-white px-3 py-2 text-[13px] text-[#201f1e] placeholder:text-[#8a8886] focus:border-[#0f6cbd] focus:ring-1 focus:ring-[#0f6cbd]" />
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2 text-[12px] text-[#323130]">
                {(Object.keys(sections) as Array<keyof typeof sections>).map((key) => (
                  <label key={key} className="flex items-center gap-2 rounded border border-[#e1dfdd] bg-[#faf9f8] px-3 py-2 capitalize"><input type="checkbox" checked={sections[key]} onChange={(event) => setSections((current) => ({ ...current, [key]: event.target.checked }))} /> {key}</label>
                ))}
              </div>
              <button onClick={generateWhiteLabelReport} disabled={!whiteLabelClientId || !mspName.trim()} className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded bg-[#0f6cbd] px-3 text-[13px] font-medium text-white hover:bg-[#004578] disabled:cursor-not-allowed disabled:opacity-40"><FileText size={14} /> Generate white-label PDF</button>
              <p className="text-[11px] leading-5 text-[#8a8886]">Uses the client's already-loaded software inventory and compliance status. No score is fabricated beyond what SPR already has on record for this client.</p>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-md border border-[#e1dfdd] bg-[#fff4ce] p-3 text-[12px] leading-5 text-[#8a5700]">
        <strong>Capability boundary:</strong> PDF export runs entirely in the browser from already-loaded passport data; there is no server-rendered PDF. Share links are stateless signed URLs with a 7-day expiry and cannot be individually revoked before then. "Print / save PDF" still uses the browser's print dialog for a full-page copy. Empty datasets remain empty and are not replaced with sample values.
      </div>
    </section>
  );
}
