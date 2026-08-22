import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import type { Alert, Client, Integration, Scan, SoftwarePassport, Vendor } from './types';
import { apiFetch } from './utils/apiClient';
import { auth } from './lib/firebase';
import CommandCenter from './components/CommandCenter';
import ExtensionWorkflow from './components/ExtensionWorkflow';
import LoginView from './components/LoginView';
import DashboardView from './components/DashboardView';
import AssetsView from './components/AssetsView';
import PassportsView from './components/PassportsView';
import ScansView from './components/ScansView';
import AlertsView from './components/AlertsView';
import ClientsView from './components/ClientsView';
import VendorsView from './components/VendorsView';
import IntegrationsView from './components/IntegrationsView';
import { EXTENSIONS } from './workflows/extensionRegistry';

const PUBLIC_PATHS = new Set(['/','/login','/free-review','/pricing']);
const EMPTY_CLIENTS: Client[] = [];
const EMPTY_PASSPORTS: SoftwarePassport[] = [];
const EMPTY_VENDORS: Vendor[] = [];
const EMPTY_INTEGRATIONS: Integration[] = [];
const EMPTY_SCANS: Scan[] = [];
const EMPTY_ALERTS: Alert[] = [];

function navigate(path: string) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function usePath() {
  const [path, setPath] = useState(() => window.location.pathname || '/');
  useEffect(() => {
    const update = () => setPath(window.location.pathname || '/');
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  return path;
}

function AuthLoading() {
  return <div className="grid min-h-screen place-items-center bg-[#05070d] text-white"><div className="text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-xs font-black text-cyan-200 shadow-[0_0_40px_rgba(34,211,238,.12)]">SPR</div><div className="mt-5 text-xs font-bold uppercase tracking-[.25em] text-cyan-200">Securing workspace</div><div className="mt-2 text-sm text-slate-600">Checking authenticated session…</div></div></div>;
}

function CoverPage() {
  return <div className="relative min-h-screen overflow-hidden bg-[#05070d] text-white"><div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(34,211,238,.14),transparent_32%),radial-gradient(circle_at_80%_20%,rgba(139,92,246,.14),transparent_34%),radial-gradient(circle_at_50%_100%,rgba(16,185,129,.08),transparent_35%)]" /><div className="relative mx-auto flex min-h-screen max-w-7xl items-center px-6 py-16"><div className="max-w-4xl"><div className="mb-7 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/[.06] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.2em] text-cyan-200"><span className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,.9)]" /> Evidence-first software trust</div><h1 className="text-5xl font-semibold tracking-[-.04em] md:text-7xl">Software trust,<br /><span className="text-cyan-200">operated as a system.</span></h1><p className="mt-7 max-w-2xl text-base leading-7 text-slate-400 md:text-lg">Software Passport Registry turns software identity, security, provenance, reliability, compliance, and evidence into repeatable workflows for teams, buyers, and managed service providers.</p><div className="mt-9 flex flex-wrap gap-3"><button onClick={() => navigate('/login')} className="rounded-2xl bg-cyan-300 px-6 py-3.5 text-sm font-bold text-slate-950 shadow-[0_0_45px_rgba(34,211,238,.16)] hover:bg-cyan-200">Enter SPR</button><button onClick={() => navigate('/free-review')} className="rounded-2xl border border-white/10 bg-white/[.035] px-6 py-3.5 text-sm font-semibold text-slate-200 hover:bg-white/[.06]">Free review</button></div><div className="mt-14 grid max-w-3xl gap-3 sm:grid-cols-3"><div className="rounded-2xl border border-white/[.07] bg-white/[.03] p-4 backdrop-blur-xl"><div className="text-[10px] uppercase tracking-[.18em] text-slate-600">Core</div><div className="mt-2 text-sm font-semibold">Evidence → decision</div></div><div className="rounded-2xl border border-white/[.07] bg-white/[.03] p-4 backdrop-blur-xl"><div className="text-[10px] uppercase tracking-[.18em] text-slate-600">Architecture</div><div className="mt-2 text-sm font-semibold">Extensions → industries</div></div><div className="rounded-2xl border border-white/[.07] bg-white/[.03] p-4 backdrop-blur-xl"><div className="text-[10px] uppercase tracking-[.18em] text-slate-600">Control</div><div className="mt-2 text-sm font-semibold">Tenant-aware workflows</div></div></div></div></div></div>;
}

function LegacyRoute({ title, description, extensionId, onNavigate }: { title: string; description: string; extensionId?: string; onNavigate: (path: string) => void }) {
  const extension = extensionId ? EXTENSIONS.find((item) => item.id === extensionId) : undefined;
  return <section className="space-y-5"><div className="rounded-3xl border border-white/[.07] bg-white/[.035] p-6 backdrop-blur-2xl md:p-8"><div className="text-[10px] font-bold uppercase tracking-[.2em] text-slate-600">Workflow surface</div><h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">{description}</p>{extension && <button onClick={() => onNavigate(extension.entryPath)} className="mt-6 rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-slate-950">Open {extension.name} →</button>}</div><div className="grid gap-3 md:grid-cols-3"><div className="rounded-2xl border border-white/[.07] bg-white/[.025] p-5"><div className="text-xs text-slate-600">Architecture</div><div className="mt-2 text-sm text-slate-200">This capability now lives behind an explicit workflow boundary.</div></div><div className="rounded-2xl border border-white/[.07] bg-white/[.025] p-5"><div className="text-xs text-slate-600">Data policy</div><div className="mt-2 text-sm text-slate-200">UI does not manufacture success, evidence, or records.</div></div><div className="rounded-2xl border border-white/[.07] bg-white/[.025] p-5"><div className="text-xs text-slate-600">Next</div><div className="mt-2 text-sm text-slate-200">Use the left workflow rail to move into the owning extension.</div></div></div></section>;
}

function ExtensionsIndex({ onNavigate }: { onNavigate: (path: string) => void }) {
  return <section className="space-y-6"><div><div className="text-[10px] font-bold uppercase tracking-[.2em] text-violet-300">Extension system</div><h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">Every industry gets its own workflow.</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">The core platform stays stable while each extension owns its steps, evidence sources, permissions, and operational surface.</p></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{EXTENSIONS.map((extension) => <button key={extension.id} onClick={() => onNavigate(extension.entryPath)} className="group rounded-3xl border border-white/[.07] bg-white/[.025] p-5 text-left transition hover:-translate-y-0.5 hover:border-violet-300/20 hover:bg-white/[.04]"><div className="flex items-center justify-between"><span className="grid h-10 w-10 place-items-center rounded-xl border border-violet-300/20 bg-violet-300/10 text-[10px] font-black text-violet-200">EX</span><span className="text-slate-600 transition group-hover:text-violet-200">→</span></div><h2 className="mt-5 text-lg font-semibold">{extension.name}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{extension.description}</p><div className="mt-5 flex flex-wrap gap-1.5">{extension.steps.map((step) => <span key={step} className="rounded-full border border-white/[.07] bg-black/10 px-2.5 py-1 text-[10px] text-slate-500">{step}</span>)}</div></button>)}</div></section>;
}

export default function App() {
  const path = usePath();
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState('Viewer');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedPassportId, setSelectedPassportId] = useState<string | null>(null);
  const [assets, setAssets] = useState<any[]>([]);
  const [clients, setClients] = useState<Client[]>(EMPTY_CLIENTS);
  const [passports, setPassports] = useState<SoftwarePassport[]>(EMPTY_PASSPORTS);
  const [vendors, setVendors] = useState<Vendor[]>(EMPTY_VENDORS);
  const [alerts, setAlerts] = useState<Alert[]>(EMPTY_ALERTS);
  const [scans, setScans] = useState<Scan[]>(EMPTY_SCANS);
  const [integrations, setIntegrations] = useState<Integration[]>(EMPTY_INTEGRATIONS);

  useEffect(() => onAuthStateChanged(auth, (currentUser) => { setUser(currentUser); setAuthReady(true); }), []);
  useEffect(() => { if (authReady && !user && !PUBLIC_PATHS.has(path)) navigate('/login'); }, [authReady, user, path]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      const responses = await Promise.all([
        apiFetch('/api/user/me'), apiFetch('/api/scans'), apiFetch('/api/trust-loop/findings'), apiFetch('/api/user/passports'), apiFetch('/api/user/clients'), apiFetch('/api/integrations'),
      ]);
      if (responses.some((response) => response.status === 401)) { await signOut(auth); navigate('/login'); return; }
      const [me, scansResponse, findingsResponse, passportsResponse, clientsResponse, integrationsResponse] = responses;
      if (me.ok) { const data = await me.json().catch(() => null); if (!cancelled) setRole(String(data?.role || 'Viewer')); }
      if (scansResponse.ok) { const data = await scansResponse.json().catch(() => []); if (!cancelled && Array.isArray(data)) setScans(data); }
      if (findingsResponse.ok) { const data = await findingsResponse.json().catch(() => []); const rows = Array.isArray(data) ? data : data?.findings; if (!cancelled && Array.isArray(rows)) setAlerts(rows.map((row: any) => ({ id: String(row.id), title: String(row.title || row.control_id || 'Trust finding'), severity: String(row.severity || 'Low').replace(/^./, (s: string) => s.toUpperCase()), category: 'Trust finding', clientName: String(row.client_id || 'Tenant'), description: String(row.description || 'Evidence-backed finding'), timestamp: String(row.updated_at || new Date().toISOString()), status: String(row.status || 'Active').toLowerCase() === 'closed' ? 'Resolved' : 'Active' })) as Alert[]); }
      if (passportsResponse.ok) { const data = await passportsResponse.json().catch(() => []); const rows = Array.isArray(data) ? data : data?.passports; if (!cancelled && Array.isArray(rows)) { const normalized = rows.map((row: any) => ({ ...row, id: String(row.id), name: String(row.name || 'Unnamed software'), version: String(row.version || 'unknown'), publisher: String(row.publisher || 'unknown'), evidence: Array.isArray(row.evidence) ? row.evidence : [], vulnerabilities: Array.isArray(row.vulnerabilities) ? row.vulnerabilities : [], timeline: Array.isArray(row.timeline) ? row.timeline : [], sbom: Array.isArray(row.sbom) ? row.sbom : [], scores: null, scoreStatus: row.scoreStatus || 'not_authoritatively_scored' })) as SoftwarePassport[]; setPassports(normalized); setAssets(normalized.map((passport: any) => ({ id: passport.id, name: passport.name, hostName: passport.name, type: passport.category || 'software', clientName: String(passport.clientId || 'Unassigned'), environment: 'Production', version: passport.version }))); const byPublisher = new Map<string, Vendor>(); for (const passport of normalized) { const name = String(passport.publisher || 'Unknown publisher'); if (!byPublisher.has(name)) byPublisher.set(name, { id: `vendor_${name}`, name, riskTier: 'Unknown', overallTrustScore: 0, category: passport.category, locations: 'Unobserved', activePassportsCount: normalized.filter((item: any) => item.publisher === name).length, reviewStatus: 'Under Review', securityIncidentsCount: 0, website: '', lastAuditDate: 'Unobserved' } as Vendor); } setVendors(Array.from(byPublisher.values())); } }
      if (clientsResponse.ok) { const data = await clientsResponse.json().catch(() => []); const rows = Array.isArray(data) ? data : data?.clients; if (!cancelled && Array.isArray(rows)) setClients(rows.map((row: any) => ({ ...row, id: String(row.id), name: String(row.name || row.company_name || 'Unnamed client') })) as Client[]); }
      if (integrationsResponse.ok) { const data = await integrationsResponse.json().catch(() => []); if (!cancelled && Array.isArray(data)) setIntegrations(data); }
    };
    void load().catch((error) => console.warn('[SPR command center load]', error));
    return () => { cancelled = true; };
  }, [user]);

  const onNavigateTab = (target: string, itemId?: string) => navigate(itemId ? `${target.startsWith('/') ? target : `/${target}`}/${encodeURIComponent(itemId)}` : target.startsWith('/') ? target : `/${target}`);
  const quickAction = (action: 'add-client' | 'register-passport' | 'scan-sbom') => navigate(action === 'add-client' ? '/clients' : action === 'register-passport' ? '/passports' : '/scans');
  const selectedExtension = useMemo(() => { const match = path.match(/^\/extensions\/([^/]+)/); return match ? decodeURIComponent(match[1]) : null; }, [path]);
  const signOutUser = async () => { await signOut(auth); navigate('/login'); };

  if (!authReady) return <AuthLoading />;
  if (path === '/') return <CoverPage />;
  if (path === '/login') return user ? <AuthLoading /> : <LoginView onLoginSuccess={() => navigate('/dashboard')} />;
  if (!user) return <AuthLoading />;

  let view: ReactNode;
  if (selectedExtension) view = <ExtensionWorkflow id={selectedExtension} onNavigate={navigate} />;
  else switch (path) {
    case '/dashboard': view = <DashboardView selectedClientId={selectedClientId} clients={clients} alerts={alerts} scans={scans} passports={passports} onSelectClient={setSelectedClientId} onNavigateTab={onNavigateTab} onOpenQuickAction={quickAction} />; break;
    case '/assets': view = <AssetsView clients={clients} searchQuery="" assets={assets} onUpdateAssets={setAssets} />; break;
    case '/passports': case '/registry': view = <PassportsView passports={passports} selectedPassportId={selectedPassportId} setSelectedPassportId={setSelectedPassportId} searchQuery="" clients={clients} assets={assets} onNavigateTab={onNavigateTab} onUpdatePassport={(passport) => setPassports((current) => current.map((item) => item.id === passport.id ? passport : item))} />; break;
    case '/scans': view = <ScansView scans={scans} clients={clients} assets={assets} passports={passports} onTriggerNewScan={(scan) => setScans((current) => [scan, ...current.filter((item) => item.id !== scan.id)].slice(0, 100))} />; break;
    case '/alerts': view = <AlertsView alerts={alerts} onUpdateAlertStatus={async (id, status) => { const backendStatus = status === 'Resolved' ? 'CLOSED' : status === 'Snoozed' ? 'BLOCKED' : 'OPEN'; const response = await apiFetch(`/api/trust-loop/remediations/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: backendStatus }) }); if (response.ok) setAlerts((current) => current.map((item) => item.id === id ? { ...item, status } : item)); }} />; break;
    case '/clients': view = <ClientsView clients={clients} selectedClientId={selectedClientId} setSelectedClientId={setSelectedClientId} passports={passports} onNavigateTab={onNavigateTab} searchQuery="" />; break;
    case '/vendors': view = <VendorsView vendors={vendors} searchQuery="" />; break;
    case '/integrations': view = <IntegrationsView integrations={integrations} onToggleConnection={async (id) => { const response = await apiFetch(`/api/integrations/${encodeURIComponent(id)}/toggle`, { method: 'POST' }); if (response.ok) { const data = await response.json(); setIntegrations((current) => current.map((item) => item.id === id ? { ...item, connected: Boolean(data.connected) } : item)); } }} onSyncIntegration={async (id) => { const response = await apiFetch(`/api/integrations/${encodeURIComponent(id)}/sync`, { method: 'POST' }); if (response.ok) { const data = await response.json(); setIntegrations((current) => current.map((item) => item.id === id ? { ...item, lastSyncDate: data?.lastSyncDate || new Date().toISOString() } : item)); } }} onNavigateTab={onNavigateTab} />; break;
    case '/monitoring': view = <LegacyRoute title="Monitoring" description="Continuous observation belongs to the trust lifecycle. Use the monitoring extension to inspect evidence changes and operational signals." extensionId="trust-evidence" onNavigate={navigate} />; break;
    case '/security': view = <LegacyRoute title="Security" description="Security is a governed evidence surface. Route findings into the Trust & Evidence workflow instead of a disconnected dashboard." extensionId="trust-evidence" onNavigate={navigate} />; break;
    case '/compliance': view = <LegacyRoute title="Compliance" description="Compliance is now an extension-owned workflow so each client, control, evidence item, and remediation has a defined sequence." extensionId="msp-compliance" onNavigate={navigate} />; break;
    case '/msp': view = <LegacyRoute title="MSP Command Center" description="Managed-service operations are packaged as a dedicated extension workflow with client-first execution." extensionId="msp-compliance" onNavigate={navigate} />; break;
    case '/agent-trust': view = <LegacyRoute title="AI Agent Trust" description="AI-agent identity and trust controls are isolated behind their own extension boundary." extensionId="agent-trust" onNavigate={navigate} />; break;
    case '/extensions': view = <ExtensionsIndex onNavigate={navigate} />; break;
    case '/billing': view = <LegacyRoute title="Billing" description="Billing remains tenant-scoped and is kept outside evidence workflows. Connect the live billing surface when the account is configured." onNavigate={navigate} />; break;
    case '/settings': view = <LegacyRoute title="Settings" description="Security, account, tenant, and integration configuration are intentionally separated from operational workflows." onNavigate={navigate} />; break;
    case '/enterprise-readiness': view = <LegacyRoute title="Enterprise Readiness" description="Enterprise readiness is evaluated from observed controls, evidence coverage, and operational configuration." extensionId="msp-compliance" onNavigate={navigate} />; break;
    case '/investor': view = <LegacyRoute title="Investor View" description="Investor-facing trust evidence is derived from the same underlying registry and verification system." extensionId="trust-evidence" onNavigate={navigate} />; break;
    case '/founder': view = <LegacyRoute title="Founder Dashboard" description="Founder operations stay separate from customer workflows while using the same authoritative evidence layer." extensionId="trust-evidence" onNavigate={navigate} />; break;
    default: view = <LegacyRoute title="Workflow" description="This route is protected by the authenticated command center. Choose an owning workflow from the left rail." onNavigate={navigate} />;
  }

  return <CommandCenter path={path} userEmail={user.email} role={role} onNavigate={navigate} onSignOut={() => void signOutUser()}>{view}</CommandCenter>;
}
