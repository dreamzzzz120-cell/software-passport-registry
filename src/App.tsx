import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import type { Alert, Client, Integration, Scan, SoftwarePassport, Vendor } from './types';
import { apiFetch } from './utils/apiClient';
import { auth } from './lib/firebase';
import CommandCenter from './components/CommandCenter';
import ExtensionWorkflow from './components/ExtensionWorkflow';
import ExtensionMarketplace from './components/ExtensionMarketplace';
import LoginView from './components/LoginView';
import DashboardView from './components/DashboardView';
import AssetsView from './components/AssetsView';
import PassportsView from './components/PassportsView';
import ScansView from './components/ScansView';
import AlertsView from './components/AlertsView';
import ClientsView from './components/ClientsView';
import VendorsView from './components/VendorsView';
import IntegrationsView from './components/IntegrationsView';
import BillingView from './components/BillingView';
import ComplianceView from './components/ComplianceView';
import AgentTrustView from './components/AgentTrustView';
import EnterpriseReadinessView from './components/EnterpriseReadinessView';
import FounderDashboardView from './components/FounderDashboardView';
import InvestorHomeView from './components/InvestorHomeView';
import SettingsView from './components/SettingsView';
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
  return <div className="relative min-h-screen overflow-hidden bg-[#05070d] text-white"><div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(34,211,238,.14),transparent_32%),radial-gradient(circle_at_80%_20%,rgba(139,92,246,.14),transparent_34%),radial-gradient(circle_at_50%_100%,rgba(16,185,129,.08),transparent_35%)]" /><div className="relative mx-auto flex min-h-screen max-w-7xl items-center px-6 py-16"><div className="max-w-4xl"><div className="mb-7 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/[.06] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.2em] text-cyan-200">Evidence-first software trust</div><h1 className="text-5xl font-semibold tracking-[-.04em] md:text-7xl">Software trust,<br /><span className="text-cyan-200">operated as a system.</span></h1><p className="mt-7 max-w-2xl text-base leading-7 text-slate-400 md:text-lg">Software Passport Registry turns software identity, security, provenance, reliability, compliance, and evidence into repeatable workflows for teams, buyers, and managed service providers.</p><div className="mt-9 flex flex-wrap gap-3"><button onClick={() => navigate('/login')} className="rounded-2xl bg-cyan-300 px-6 py-3.5 text-sm font-bold text-slate-950">Enter SPR</button><button onClick={() => navigate('/free-review')} className="rounded-2xl border border-white/10 bg-white/[.035] px-6 py-3.5 text-sm font-semibold text-slate-200">Free review</button></div></div></div></div>;
}

function PublicPage({ title, description, action, onAction }: { title: string; description: string; action: string; onAction: () => void }) {
  return <div className="grid min-h-screen place-items-center bg-[#05070d] px-6 text-white"><div className="max-w-2xl rounded-3xl border border-white/[.08] bg-white/[.035] p-8 text-center backdrop-blur-2xl"><div className="text-[10px] font-bold uppercase tracking-[.2em] text-cyan-200">Software Passport Registry</div><h1 className="mt-3 text-3xl font-semibold">{title}</h1><p className="mt-4 text-sm leading-6 text-slate-400">{description}</p><button onClick={onAction} className="mt-7 rounded-xl bg-cyan-300 px-5 py-3 text-sm font-bold text-slate-950">{action}</button></div></div>;
}

function WorkflowBoundary({ title, description, extensionId, onNavigate }: { title: string; description: string; extensionId?: string; onNavigate: (path: string) => void }) {
  const extension = extensionId ? EXTENSIONS.find((item) => item.id === extensionId) : undefined;
  return <section className="space-y-5"><div className="rounded-3xl border border-white/[.07] bg-white/[.035] p-6 backdrop-blur-2xl md:p-8"><div className="text-[10px] font-bold uppercase tracking-[.2em] text-slate-600">Workflow boundary</div><h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">{description}</p>{extension && <button onClick={() => onNavigate(extension.entryPath)} className="mt-6 rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-slate-950">Open {extension.name} →</button>}</div></section>;
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
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

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
      if (findingsResponse.ok) { const data = await findingsResponse.json().catch(() => []); const rows = Array.isArray(data) ? data : data?.findings; if (!cancelled && Array.isArray(rows)) setAlerts(rows.map((row: any) => ({ id: String(row.id), title: String(row.title || row.control_id || 'Trust finding'), severity: String(row.severity || 'Low').replace(/^./, (s: string) => s.toUpperCase()), category: 'Trust finding', clientName: String(row.client_id || 'Tenant'), description: String(row.description || 'Evidence-backed finding'), timestamp: String(row.updated_at || ''), status: String(row.status || 'Active').toLowerCase() === 'closed' ? 'Resolved' : 'Active' })) as Alert[]); }
      if (passportsResponse.ok) { const data = await passportsResponse.json().catch(() => []); const rows = Array.isArray(data) ? data : data?.passports; if (!cancelled && Array.isArray(rows)) { const normalized = rows.map((row: any) => ({ ...row, id: String(row.id), name: String(row.name || 'Unnamed software'), version: String(row.version || 'unknown'), publisher: String(row.publisher || 'unknown'), evidence: Array.isArray(row.evidence) ? row.evidence : [], vulnerabilities: Array.isArray(row.vulnerabilities) ? row.vulnerabilities : [], timeline: Array.isArray(row.timeline) ? row.timeline : [], sbom: Array.isArray(row.sbom) ? row.sbom : [], scores: null, scoreStatus: row.scoreStatus || 'not_authoritatively_scored' })) as SoftwarePassport[]; setPassports(normalized); setAssets(normalized.map((passport: any) => ({ id: passport.id, name: passport.name, hostName: passport.name, type: passport.category || 'software', clientName: String(passport.clientId || 'Unobserved'), environment: String(passport.environment || 'Unobserved'), version: passport.version }))); setVendors(EMPTY_VENDORS); } }
      if (clientsResponse.ok) { const data = await clientsResponse.json().catch(() => []); const rows = Array.isArray(data) ? data : data?.clients; if (!cancelled && Array.isArray(rows)) setClients(rows.map((row: any) => ({ ...row, id: String(row.id), name: String(row.name || row.company_name || 'Unnamed client') })) as Client[]); }
      if (integrationsResponse.ok) { const data = await integrationsResponse.json().catch(() => []); if (!cancelled && Array.isArray(data)) setIntegrations(data); }
    };
    void load().catch((error) => console.warn('[SPR command center load]', error));
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    const refresh = () => { if (user) window.location.reload(); };
    window.addEventListener('refresh-data', refresh);
    return () => window.removeEventListener('refresh-data', refresh);
  }, [user]);

  const onNavigateTab = (target: string, itemId?: string) => navigate(itemId ? `${target.startsWith('/') ? target : `/${target}`}/${encodeURIComponent(itemId)}` : target.startsWith('/') ? target : `/${target}`);
  const quickAction = (action: 'add-client' | 'register-passport' | 'scan-sbom') => navigate(action === 'add-client' ? '/clients' : action === 'register-passport' ? '/passports' : '/scans');
  const selectedExtension = useMemo(() => { const match = path.match(/^\/extensions\/([^/]+)/); return match ? decodeURIComponent(match[1]) : null; }, [path]);
  const signOutUser = async () => { await signOut(auth); navigate('/login'); };

  if (!authReady) return <AuthLoading />;
  if (path === '/') return <CoverPage />;
  if (path === '/login') return user ? <AuthLoading /> : <LoginView onLoginSuccess={() => navigate('/dashboard')} />;
  if (!user && path === '/free-review') return <PublicPage title="Free software review" description="Start an evidence-first review from the public entry point." action="Sign in to continue" onAction={() => navigate('/login')} />;
  if (!user && path === '/pricing') return <PublicPage title="SPR plans" description="Account and billing capabilities are available inside the authenticated workspace." action="Enter SPR" onAction={() => navigate('/login')} />;
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
    case '/integrations': view = <IntegrationsView integrations={integrations} onToggleConnection={async (id) => { const response = await apiFetch(`/api/integrations/${encodeURIComponent(id)}/toggle`, { method: 'POST' }); if (response.ok) { const data = await response.json(); setIntegrations((current) => current.map((item) => item.id === id ? { ...item, connected: Boolean(data.connected) } : item)); } }} onSyncIntegration={async (id) => { const response = await apiFetch(`/api/integrations/${encodeURIComponent(id)}/sync`, { method: 'POST' }); if (response.ok) { const data = await response.json(); setIntegrations((current) => current.map((item) => item.id === id ? { ...item, lastSyncDate: data?.lastSyncDate || '' } : item)); } }} onNavigateTab={onNavigateTab} />; break;
    case '/monitoring': view = <InvestorHomeView passports={passports} clients={clients} alerts={alerts} onShowTelemetry={() => navigate('/scans')} onNavigateTab={onNavigateTab} />; break;
    case '/security': view = <AlertsView alerts={alerts} onUpdateAlertStatus={async () => undefined} />; break;
    case '/compliance': view = <ComplianceView clients={clients} />; break;
    case '/msp': view = <ComplianceView clients={clients} />; break;
    case '/agent-trust': view = <AgentTrustView />; break;
    case '/enterprise-readiness': view = <EnterpriseReadinessView clients={clients} />; break;
    case '/investor': view = <InvestorHomeView passports={passports} clients={clients} alerts={alerts} onShowTelemetry={() => navigate('/scans')} onNavigateTab={onNavigateTab} />; break;
    case '/founder': view = <FounderDashboardView userRole={role} />; break;
    case '/billing': view = <BillingView />; break;
    case '/settings': view = <SettingsView theme={theme} onToggleTheme={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')} />; break;
    case '/extensions': view = <ExtensionMarketplace onNavigateTab={onNavigateTab} />; break;
    default: view = <WorkflowBoundary title="Workflow" description="This authenticated capability is explicitly routed through the Command Center. Choose its owning workflow from the left rail." onNavigate={navigate} />;
  }

  return <CommandCenter path={path} userEmail={user.email} role={role} onNavigate={navigate} onSignOut={() => void signOutUser()}>{view}</CommandCenter>;
}
