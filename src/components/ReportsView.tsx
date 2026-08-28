import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Copy, Download, FileJson, FileText, History, Package, Printer, RefreshCw, Share2, ShieldCheck, Upload, Users } from 'lucide-react';
import type { Alert, Client, Scan, SoftwarePassport } from '../types';
import { apiFetch } from '../utils/apiClient';
import { generateCoBrandedTrustReport, generatePassportEvidenceReport } from '../utils/pdfGenerator';
import PlainEnglishReport from './PlainEnglishReport';

type ReportPayload = {
  schemaVersion?: string;
  reportType?: string;
  generatedAt?: string;
  passport?: { id?: string; name?: string };
  risk?: { overall?: number | null; security?: number | null; compliance?: number | null; verificationStatus?: 'unverified' | 'partial' | 'verified' };
  evidenceQuality?: { completenessBasisPoints?: number | null; unknownDimensions?: number; latestObservationAt?: string | null };
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
  score: number | null;
  verification_status?: 'unverified' | 'partial' | 'verified';
  completeness_basis_points: number;
  canonical_payload_hash: string;
};

type ReportChange = { type: string; before: unknown; after: unknown; subject?: string; alertWorthy: boolean; severity: 'informational' | 'medium' | 'high' };
type ChangesSinceLastReport = { insufficientData: boolean; current: { generatedAt: string } | null; previous: { generatedAt: string } | null; changes: ReportChange[] };

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
  const [changes, setChanges] = useState<ChangesSinceLastReport | null>(null);
  const [changesLoading, setChangesLoading] = useState(false);
  const [shareInfo, setShareInfo] = useState<ShareInfo | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareMessage, setShareMessage] = useState('');
  const [exportClientIds, setExportClientIds] = useState<Set<string>>(new Set());

  const [whiteLabelClientId, setWhiteLabelClientId] = useState(clients[0]?.id || '');
  const [mspName, setMspName] = useState('');
  const [brandColor, setBrandColor] = useState('#3794ff');
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

  // Pre-fill from the tenant's saved branding (Settings -> Team & Profile)
  // instead of leaving these blank every time -- still fully editable per
  // export, this only changes the starting values.
  useEffect(() => {
    apiFetch('/api/organization/branding').then((r) => r.ok ? r.json() : null).then((data) => {
      if (!data) return;
      if (data.companyName) setMspName(data.companyName);
      if (data.brandColor) setBrandColor(data.brandColor);
      if (data.logoDataUrl) setLogoBase64(data.logoDataUrl);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    setReport(null);
    setHistory([]);
    setShareInfo(null);
    setShareMessage('');
    setMessage('');
    setChanges(null);
    if (selectedPassportId) { void loadHistory(selectedPassportId); void loadChanges(selectedPassportId); }
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

  const loadChanges = async (passportId: string) => {
    setChangesLoading(true);
    try {
      const response = await apiFetch(`/api/trust-loop/reports/${encodeURIComponent(passportId)}/changes?type=${encodeURIComponent(reportType)}`);
      const payload = await response.json().catch(() => null);
      if (response.ok) setChanges(payload as ChangesSinceLastReport);
    } finally {
      setChangesLoading(false);
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
      void loadChanges(selectedPassport.id);
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
    generatePassportEvidenceReport(selectedPassport, 'SPR Reports Center', '#3794ff');
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
    <section className="space-y-6" aria-labelledby="reports-title">
      <header className="flex flex-col gap-4 spr-panel p-6 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[.06em] text-[#3794ff]">Reports center</div>
          <h1 id="reports-title" className="mt-2 text-3xl font-semibold tracking-tight">Evidence-backed reporting</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#9d9d9d]">Exports contain records loaded from this tenant’s existing APIs. No trust score, compliance claim, or finding is inferred in this view.</p>
        </div>
        <button onClick={() => window.print()} className="inline-flex items-center justify-center gap-2 rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-4 py-2.5 text-sm font-semibold text-[#d4d4d4] hover:border-[#0e639c]/50 hover:text-[#d4d4d4]"><Printer size={16} /> Print / save PDF</button>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Clients', clients.length, 'Persisted client records'],
          ['Passports', passports.length, 'Registered software identity'],
          ['Evidence', evidenceCount, 'Nested passport evidence'],
          ['Findings / vulnerabilities', findingCount + vulnerabilityCount, 'Loaded finding and vulnerability records'],
        ].map(([label, value, detail]) => (
          <div key={String(label)} className="spr-panel p-4">
            <div className="text-[10px] font-bold uppercase tracking-[.18em] text-[#9d9d9d]">{label}</div>
            <div className="mt-2 text-2xl font-semibold text-[#d4d4d4]">{value}</div>
            <div className="mt-1 text-xs text-[#9d9d9d]">{detail}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_.9fr]">
        <div className="spr-panel p-6">
          <div className="flex items-center gap-2"><ShieldCheck size={18} className="text-[#3794ff]" /><h2 className="text-lg font-semibold">Tenant registry exports</h2></div>
          <p className="mt-2 text-sm text-[#9d9d9d]">CSV includes the loaded client, passport, evidence, vulnerability, finding, scan, and alert records.</p>
          {clients.length > 0 && (
            <div className="mt-4 flex items-center gap-2">
              <Users size={14} className="text-[#9d9d9d]" />
              <span className="text-xs text-[#9d9d9d]">{exportClientIds.size === 0 ? 'All clients' : `${exportClientIds.size} of ${clients.length} clients selected`}</span>
              <div className="flex flex-wrap gap-1.5">
                {clients.map((client) => (
                  <button key={client.id} onClick={() => toggleExportClient(client.id)} className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${exportClientIds.has(client.id) ? 'border-[#0e639c]/50 bg-[#094771] text-[#3794ff]' : 'border-[#3c3c3c] bg-[#2d2d2d] text-[#9d9d9d]'}`}>{client.name}</button>
                ))}
              </div>
            </div>
          )}
          <div className="mt-5 flex flex-wrap gap-3">
            <button onClick={exportRegistryCsv} disabled={!passports.length && !clients.length} className="inline-flex items-center gap-2 spr-btn spr-btn-primary disabled:cursor-not-allowed disabled:opacity-40"><Download size={16} /> Export registry CSV</button>
          </div>
          <div className="mt-6 border-t border-[#3c3c3c] pt-5">
            <h3 className="text-sm font-semibold text-[#d4d4d4]">Server report snapshot</h3>
            <p className="mt-1 text-xs leading-5 text-[#9d9d9d]">Loads <code>/api/trust-loop/reports/:passportId</code>, which returns persisted findings, evidence, observations, remediation, verification, limitations, and a report hash.</p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <select value={selectedPassportId} onChange={(event) => setSelectedPassportId(event.target.value)} className="min-w-0 flex-1 rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2.5 text-sm text-[#d4d4d4]">
                {!passports.length && <option value="">No passports loaded</option>}
                {passports.map((passport) => <option key={passport.id} value={passport.id}>{passport.name} · {passport.version}</option>)}
              </select>
              <select value={reportType} onChange={(event) => setReportType(event.target.value)} className="min-w-0 flex-1 rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2.5 text-sm text-[#d4d4d4]">
                {REPORT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
              </select>
              <button onClick={() => void loadReport()} disabled={!selectedPassport || loading} className="inline-flex items-center justify-center gap-2 rounded-md border border-[#0e639c]/50 bg-[#094771] px-4 py-2.5 text-sm font-semibold text-[#3794ff] disabled:opacity-40"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> {loading ? 'Loading…' : 'Load report'}</button>
            </div>
            {message && <p className="mt-3 text-xs text-[#9d9d9d]" role="status">{message}</p>}
          </div>

          {report && selectedPassport && (
            <div className="mt-6 border-t border-[#3c3c3c] pt-5">
              <div className="flex items-center gap-2"><FileText size={16} className="text-[#9d9d9d]" /><h3 className="text-sm font-semibold text-[#d4d4d4]">Plain-English summary</h3></div>
              <p className="mt-1 text-xs leading-5 text-[#9d9d9d]">The same evidence and score as the technical report above, explained in plain language. Both come from the exact same underlying data.</p>
              <div className="mt-4">
                <PlainEnglishReport passportId={selectedPassport.id} reportType={reportType} />
              </div>
            </div>
          )}

          <div className="mt-6 border-t border-[#3c3c3c] pt-5">
            <div className="flex items-center gap-2"><History size={16} className="text-[#9d9d9d]" /><h3 className="text-sm font-semibold text-[#d4d4d4]">Changes since last report</h3></div>
            {changesLoading && <p className="mt-3 text-xs text-[#9d9d9d]">Checking for changes…</p>}
            {!changesLoading && changes?.insufficientData && <p className="mt-3 text-xs text-[#9d9d9d]">{changes.current ? 'Only one report snapshot exists for this passport and type — generate another later to compare.' : 'No report snapshots exist yet for this passport and type.'}</p>}
            {!changesLoading && changes && !changes.insufficientData && changes.changes.length === 0 && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-[#89d185]"><ShieldCheck size={14} /> No change since the last report ({changes.previous && new Date(changes.previous.generatedAt).toLocaleString()}).</p>
            )}
            {!changesLoading && changes && !changes.insufficientData && changes.changes.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {changes.changes.map((change, index) => (
                  <li key={index} className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${change.severity === 'high' ? 'border-[#f14c4c]/40 bg-[#f14c4c]/10 text-[#f14c4c]' : change.severity === 'medium' ? 'border-[#cca700]/40 bg-[#cca700]/10 text-[#cca700]' : 'border-[#3c3c3c] bg-[#2d2d2d] text-[#9d9d9d]'}`}>
                    <span className="font-semibold">{change.type.replaceAll('_', ' ')}</span>
                    <span className="text-[#6f6f6f]">{String(change.before ?? '—')} → {String(change.after ?? '—')}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-6 border-t border-[#3c3c3c] pt-5">
            <div className="flex items-center gap-2"><History size={16} className="text-[#9d9d9d]" /><h3 className="text-sm font-semibold text-[#d4d4d4]">Report history</h3></div>
            <p className="mt-1 text-xs leading-5 text-[#9d9d9d]">Every generated report is hashed and versioned. Load a passport report above to populate history for the selected type.</p>
            {historyLoading && <p className="mt-3 text-xs text-[#9d9d9d]">Loading history…</p>}
            {!historyLoading && history.length === 0 && <p className="mt-3 text-xs text-[#9d9d9d]">No prior snapshots for this passport and report type yet.</p>}
            {history.length > 0 && (
              <ul className="mt-3 max-h-48 space-y-2 overflow-auto pr-1">
                {history.map((snapshot) => (
                  <li key={snapshot.id}>
                    <button onClick={() => void loadSnapshot(snapshot.id)} className="w-full rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2 text-left text-xs text-[#d4d4d4] hover:border-[#0e639c]/50 hover:text-[#d4d4d4]">
                      <div className="flex items-center justify-between gap-2">
                        <span>{new Date(snapshot.generated_at).toLocaleString()}</span>
                        <span className="text-[#9d9d9d]">{snapshot.score == null ? 'unverified' : `score ${snapshot.score}`}</span>
                      </div>
                      <div className="mt-1 truncate font-mono text-[10px] text-[#9d9d9d]">{snapshot.canonical_payload_hash}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="spr-panel p-6">
          <h2 className="text-lg font-semibold">Download loaded report</h2>
          <p className="mt-2 text-sm text-[#9d9d9d]">JSON is the exact server response. PDF is generated client-side from the loaded passport's SBOM, evidence, and timeline.</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button onClick={exportReportJson} disabled={!report} className="inline-flex items-center gap-2 rounded-md border border-[#0e639c]/50 bg-[#094771] px-4 py-2.5 text-sm font-semibold text-[#3794ff] disabled:opacity-40"><FileJson size={16} /> Export JSON</button>
            <button onClick={downloadPdf} disabled={!selectedPassport} className="inline-flex items-center gap-2 rounded-md border border-[#0e639c]/50 bg-[#094771] px-4 py-2.5 text-sm font-semibold text-[#3794ff] disabled:opacity-40"><FileText size={16} /> Download PDF</button>
          </div>

          <div className="mt-6 border-t border-[#3c3c3c] pt-5">
            <div className="flex items-center gap-2"><Share2 size={16} className="text-[#9d9d9d]" /><h3 className="text-sm font-semibold text-[#d4d4d4]">Shareable link</h3></div>
            <p className="mt-1 text-xs leading-5 text-[#9d9d9d]">
              {canShare
                ? 'Creates a signed, tenant-scoped link that expires in 7 days. Anyone with the link sees a redacted, evidence-backed summary — no internal remediation or verification detail.'
                : `Your ${role} role cannot create share links. Owner, Admin, or Operator is required.`}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button onClick={() => void createShareLink()} disabled={!canShare || !selectedPassport || sharing} className="inline-flex items-center gap-2 rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-4 py-2.5 text-sm font-semibold text-[#d4d4d4] disabled:cursor-not-allowed disabled:opacity-40">
                <Share2 size={16} className={sharing ? 'animate-pulse' : ''} /> {sharing ? 'Creating…' : 'Create share link'}
              </button>
              {shareInfo && (
                <button onClick={() => void copyShareLink()} className="inline-flex items-center gap-2 rounded-md border border-[#0e639c]/50 bg-[#094771] px-3 py-2.5 text-xs font-semibold text-[#3794ff]"><Copy size={14} /> Copy link</button>
              )}
            </div>
            {shareInfo && (
              <div className="mt-3 rounded-md border border-[#3c3c3c] bg-[#2d2d2d] p-3 text-xs text-[#9d9d9d]">
                <div className="truncate font-mono text-[#d4d4d4]">{shareInfo.shareUrl}</div>
                <div className="mt-1 text-[#9d9d9d]">Expires {new Date(shareInfo.expiresAt).toLocaleString()}</div>
              </div>
            )}
            {shareMessage && <p className="mt-2 text-xs text-[#9d9d9d]" role="status">{shareMessage}</p>}
          </div>

          <pre className="mt-6 max-h-64 overflow-auto rounded-md border border-[#3c3c3c] bg-[#2d2d2d] p-4 text-xs leading-5 text-[#9d9d9d] whitespace-pre-wrap">{reportText || 'Load a passport report to preview its persisted traceability and limitations.'}</pre>
        </div>
      </div>

      {report?.sbom && (
        <div className="spr-panel p-6">
          <div className="flex items-center gap-2"><Package size={18} className="text-[#3794ff]" /><h2 className="text-lg font-semibold">SBOM components</h2></div>
          <p className="mt-2 text-sm text-[#9d9d9d]">Each component is cross-referenced against this passport's recorded vulnerabilities by name.</p>
          <div className="mt-4 overflow-auto">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="text-[#9d9d9d]"><tr><th className="pb-2 pr-4">Component</th><th className="pb-2 pr-4">Version</th><th className="pb-2 pr-4">License</th><th className="pb-2 pr-4">Vulnerabilities</th><th className="pb-2">Critical/High</th></tr></thead>
              <tbody className="text-[#d4d4d4]">
                {report.sbom.length === 0 && <tr><td colSpan={5} className="py-3 text-[#9d9d9d]">No SBOM components recorded for this passport.</td></tr>}
                {report.sbom.map((component, index) => (
                  <tr key={`${component.name}-${index}`} className="border-t border-[#3c3c3c]">
                    <td className="py-2 pr-4">{component.name || '—'}</td>
                    <td className="py-2 pr-4">{component.version || '—'}</td>
                    <td className="py-2 pr-4">{component.license || '—'}</td>
                    <td className="py-2 pr-4">{component.vulnerabilityCount ?? 0}</td>
                    <td className="py-2">{component.criticalOrHighCount ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {report?.controls && (
        <div className="spr-panel p-6">
          <div className="flex items-center gap-2"><ShieldCheck size={18} className="text-[#3794ff]" /><h2 className="text-lg font-semibold">Findings by control</h2></div>
          <p className="mt-2 text-sm text-[#9d9d9d]">Open trust findings grouped by control ID, worst-observed severity first.</p>
          <div className="mt-4 overflow-auto">
            <table className="w-full min-w-[480px] text-left text-xs">
              <thead className="text-[#9d9d9d]"><tr><th className="pb-2 pr-4">Control</th><th className="pb-2 pr-4">Findings</th><th className="pb-2 pr-4">Open</th><th className="pb-2">Worst severity</th></tr></thead>
              <tbody className="text-[#d4d4d4]">
                {report.controls.length === 0 && <tr><td colSpan={4} className="py-3 text-[#9d9d9d]">No control-mapped findings for this passport.</td></tr>}
                {report.controls.map((control) => (
                  <tr key={control.controlId} className="border-t border-[#3c3c3c]">
                    <td className="py-2 pr-4 font-mono">{control.controlId || '—'}</td>
                    <td className="py-2 pr-4">{control.findingCount ?? 0}</td>
                    <td className="py-2 pr-4">{control.openCount ?? 0}</td>
                    <td className="py-2 capitalize">{control.worstSeverity || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {clients.length > 0 && (
        <div className="spr-panel p-6">
          <h2 className="text-lg font-semibold text-[#d4d4d4]">White-label client report</h2>
          <p className="mt-2 text-sm text-[#9d9d9d]">Generates a co-branded PDF for one client using your MSP name, logo, and brand color. Runs entirely in the browser from already-loaded client data.</p>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <select value={whiteLabelClientId} onChange={(event) => setWhiteLabelClientId(event.target.value)} className="w-full rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2.5 text-sm text-[#d4d4d4]">
                {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
              <input value={mspName} onChange={(event) => setMspName(event.target.value)} placeholder="Your MSP / firm name *" className="w-full rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2.5 text-sm text-[#d4d4d4] placeholder:text-[#6f6f6f]" />
              <input value={reportTitle} onChange={(event) => setReportTitle(event.target.value)} placeholder="Report title" className="w-full rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2.5 text-sm text-[#d4d4d4]" />
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-[#9d9d9d]">Brand color <input type="color" value={brandColor} onChange={(event) => setBrandColor(event.target.value)} className="h-8 w-8 rounded border border-[#3c3c3c] bg-transparent" /></label>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2 text-xs text-[#d4d4d4] hover:border-[#0e639c]/50"><Upload size={14} /> {logoBase64 ? 'Logo uploaded' : 'Upload logo'}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleLogoUpload} className="hidden" /></label>
              </div>
              <textarea value={executiveSummary} onChange={(event) => setExecutiveSummary(event.target.value)} placeholder="Executive summary (optional)" rows={3} className="w-full rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2.5 text-sm text-[#d4d4d4] placeholder:text-[#6f6f6f]" />
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs text-[#d4d4d4]">
                {(Object.keys(sections) as Array<keyof typeof sections>).map((key) => (
                  <label key={key} className="flex items-center gap-2 rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2 capitalize"><input type="checkbox" checked={sections[key]} onChange={(event) => setSections((current) => ({ ...current, [key]: event.target.checked }))} /> {key}</label>
                ))}
              </div>
              <button onClick={generateWhiteLabelReport} disabled={!whiteLabelClientId || !mspName.trim()} className="inline-flex w-full items-center justify-center gap-2 spr-btn spr-btn-primary disabled:cursor-not-allowed disabled:opacity-40"><FileText size={16} /> Generate white-label PDF</button>
              <p className="text-[11px] leading-5 text-[#9d9d9d]">Uses the client's already-loaded software inventory and compliance status. No score is fabricated beyond what SPR already has on record for this client.</p>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-md border border-[#cca700]/30 bg-[#cca700]/10 p-4 text-xs leading-5 text-[#cca700]/85">
        <strong className="text-[#cca700]">Capability boundary:</strong> PDF export runs entirely in the browser from already-loaded passport data; there is no server-rendered PDF. Share links are stateless signed URLs with a 7-day expiry and cannot be individually revoked before then. "Print / save PDF" still uses the browser's print dialog for a full-page copy. Empty datasets remain empty and are not replaced with sample values.
      </div>
    </section>
  );
}
