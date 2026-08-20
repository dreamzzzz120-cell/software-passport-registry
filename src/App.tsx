import { useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import type { Alert, Client, Integration, Scan, SoftwarePassport, Vendor } from './types';
import { apiFetch } from './utils/apiClient';
import { auth } from './lib/firebase';
import AlertsView from './components/AlertsView';
import AssetsView from './components/AssetsView';
import BillingView from './components/BillingView';
import ClientsView from './components/ClientsView';
import ComplianceView from './components/ComplianceView';
import DashboardView from './components/DashboardView';
import EnterpriseReadinessView from './components/EnterpriseReadinessView';
import ExtensionMarketplace from './components/ExtensionMarketplace';
import FounderDashboardView from './components/FounderDashboardView';
import GitHubEvidencePanel from './components/GitHubEvidencePanel';
import IntegrationsView from './components/IntegrationsView';
import InvestorHomeView from './components/InvestorHomeView';
import LoginView from './components/LoginView';
import MSPCommandCenter from './components/MSPCommandCenter';
import MonitoringView from './components/MonitoringView';
import OverviewView from './components/OverviewView';
import PassportsView from './components/PassportsView';
import ScansView from './components/ScansView';
import SecurityCenterView from './components/SecurityCenterView';
import SettingsView from './components/SettingsView';
import VendorsView from './components/VendorsView';
import AgentTrustView from './components/AgentTrustView';

const EMPTY_CLIENTS: Client[] = [];
const EMPTY_ALERTS: Alert[] = [];
const EMPTY_SCANS: Scan[] = [];
const EMPTY_PASSPORTS: SoftwarePassport[] = [];
const EMPTY_INTEGRATIONS: Integration[] = [];
const EMPTY_VENDORS: Vendor[] = [];

const routes = [
  ['/dashboard', 'Dashboard'], ['/assets', 'Assets'], ['/registry', 'Registry'], ['/passports', 'Passports'],
  ['/scans', 'Scans'], ['/monitoring', 'Monitoring'], ['/alerts', 'Alerts'], ['/security', 'Security Center'],
  ['/compliance', 'Compliance'], ['/clients', 'Clients'], ['/vendors', 'Vendors'], ['/integrations', 'Integrations'],
  ['/agent-trust', 'AI Agent Trust'], ['/msp', 'MSP Command Center'], ['/enterprise-readiness', 'Enterprise Readiness'], ['/investor', 'Investor View'],
  ['/founder', 'Founder Dashboard'], ['/extensions', 'Extension Marketplace'], ['/billing', 'Billing'],
  ['/settings', 'Settings'], ['/login', 'Login'], ['/free-review', 'Free Review'], ['/pricing', 'Pricing'],
] as const;

const PUBLIC_PATHS = new Set(['/', '/login', '/free-review', '/pricing']);
function navigate(path: string) { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }
function usePath() { const [path, setPath] = useState(() => window.location.pathname || '/'); useEffect(() => { const update = () => setPath(window.location.pathname || '/'); window.addEventListener('popstate', update); return () => window.removeEventListener('popstate', update); }, []); return path; }

function AppShell({ children, user }: { children: ReactNode; user: User }) {
  const path = usePath();
  const [signingOut, setSigningOut] = useState(false);
  const logout = async () => { setSigningOut(true); try { await signOut(auth); navigate('/login'); } finally { setSigningOut(false); } };
  return <div className="min-h-screen bg-slate-950 text-white"><header className="sticky top-0 z-30 border-b border-white/10 bg-slate-950/95 backdrop-blur"><div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4"><button onClick={() => navigate('/dashboard')} className="text-left"><div className="text-xs font-bold uppercase tracking-[.25em] text-cyan-300">SPR</div><div className="text-lg font-bold">Software Passport Registry</div></button><div className="flex items-center gap-2"><span className="hidden max-w-56 truncate text-xs text-slate-400 sm:block">{user.email}</span><button onClick={() => navigate('/settings')} className="rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-white/5">Settings</button><button onClick={logout} disabled={signingOut} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200 hover:bg-white/5">{signingOut ? 'Signing out…' : 'Sign out'}</button></div></div></header><div className="mx-auto grid max-w-7xl grid-cols-1 md:grid-cols-[220px_1fr]"><aside className="border-r border-white/10 p-3 md:min-h-[calc(100vh-73px)]"><nav className="space-y-1">{routes.filter(([route]) => route !== '/login' && !PUBLIC_PATHS.has(route)).map(([route, label]) => <button key={route} onClick={() => navigate(route)} className={`w-full rounded-lg px-3 py-2 text-left text-sm ${path === route ? 'bg-cyan-300/10 text-cyan-200' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}>{label}</button>)}</nav></aside><main className="min-w-0 p-4 md:p-7">{children}</main></div></div>;
}
function PublicHome() { return <div className="min-h-screen bg-slate-950 px-6 py-12 text-white"><div className="mx-auto max-w-6xl"><p className="text-xs font-bold uppercase tracking-[.25em] text-cyan-300">SPR</p><h1 className="mt-3 text-4xl font-bold">Software Passport Registry</h1><p className="mt-4 max-w-2xl text-slate-300">Evidence-first software trust, verification, monitoring, and supply-chain visibility.</p><div className="mt-8 flex flex-wrap gap-3"><button onClick={() => navigate('/login')} className="rounded-lg bg-cyan-300 px-5 py-3 font-semibold text-slate-950">Owner sign in</button><button onClick={() => navigate('/free-review')} className="rounded-lg border border-white/15 px-5 py-3 font-semibold">Free review</button><button onClick={() => navigate('/pricing')} className="rounded-lg border border-white/15 px-5 py-3 font-semibold">Pricing</button></div></div></div>; }
function AuthLoading() { return <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white"><div className="text-center"><div className="text-xs font-bold uppercase tracking-[.25em] text-cyan-300">SPR</div><div className="mt-3 text-slate-300">Checking secure session…</div></div></div>; }

export default function App() {
  const path = usePath();
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [searchQuery] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedPassportId, setSelectedPassportId] = useState<string | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [userRole, setUserRole] = useState('Owner');
  const [installedExtensions, setInstalledExtensions] = useState<string[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [clients] = useState<Client[]>(EMPTY_CLIENTS);
  const [alerts, setAlerts] = useState<Alert[]>(EMPTY_ALERTS);
  const [scans, setScans] = useState<Scan[]>(EMPTY_SCANS);
  const [passports, setPassports] = useState<SoftwarePassport[]>(EMPTY_PASSPORTS);
  const [integrations, setIntegrations] = useState<Integration[]>(EMPTY_INTEGRATIONS);

  useEffect(() => onAuthStateChanged(auth, currentUser => { setUser(currentUser); setAuthReady(true); }), []);
  useEffect(() => { const expired = () => { void signOut(auth); navigate('/login'); }; window.addEventListener('auth-expired', expired); return () => window.removeEventListener('auth-expired', expired); }, []);
  useEffect(() => { if (authReady && !user && !PUBLIC_PATHS.has(path)) navigate('/login'); }, [authReady, user, path]);
  useEffect(() => { if (path !== '/integrations' || !user) return; let cancelled = false; void apiFetch('/api/integrations').then(async response => { if (!response.ok) throw new Error(`Integration catalog request failed (${response.status})`); const data = await response.json(); if (!cancelled && Array.isArray(data)) setIntegrations(data.map((item: Integration) => ({ ...item, lastSyncDate: item.lastSyncDate || 'Never' }))); }).catch(error => console.warn('[SPR integrations]', error)); return () => { cancelled = true; }; }, [path, user]);

  const onNavigateTab = (tab: string, itemId?: string) => { const normalized = tab.startsWith('/') ? tab : `/${tab}`; navigate(itemId ? `${normalized}/${encodeURIComponent(itemId)}` : normalized); };
  const quickAction = (actionType: 'add-client' | 'register-passport' | 'scan-sbom') => navigate(actionType === 'add-client' ? '/clients' : actionType === 'register-passport' ? '/passports' : '/scans');
  const onLoginSuccess = (_signedInUser: { uid: string; email: string | null; displayName: string; token: string; emailVerified: boolean; onboarded: 0 }) => { setUserRole('Owner'); navigate('/dashboard'); };
  const updateAlertStatus = (id: string, status: Alert['status']) => setAlerts(current => current.map(item => item.id === id ? { ...item, status } : item));
  const triggerScan = (scan: Scan) => setScans(current => [scan, ...current]);
  const toggleIntegration = (id: string) => setIntegrations(current => current.map(item => item.id === id ? { ...item, connected: !item.connected } : item));
  const syncIntegration = (id: string) => { void id; };
  const installExtension = (id: string) => setInstalledExtensions(current => current.includes(id) ? current : [...current, id]);
  const uninstallExtension = (id: string) => setInstalledExtensions(current => current.filter(item => item !== id));

  if (!authReady) return <AuthLoading />;
  if (path === '/') return <PublicHome />;
  if (path === '/login') return user ? <>{navigate('/dashboard')}</> : <LoginView onLoginSuccess={onLoginSuccess} />;
  if (!user) return <AuthLoading />;
  const view = (() => { switch (path) {
    case '/dashboard': return <DashboardView selectedClientId={selectedClientId} clients={clients} alerts={alerts} scans={scans} passports={passports} onSelectClient={setSelectedClientId} onNavigateTab={onNavigateTab} onOpenQuickAction={quickAction} />;
    case '/overview': return <OverviewView selectedClientId={selectedClientId} clients={clients} alerts={alerts} scans={scans} passports={passports} onOpenQuickAction={quickAction} />;
    case '/assets': return <AssetsView clients={clients} searchQuery={searchQuery} assets={assets} onUpdateAssets={setAssets} />;
    case '/passports': case '/registry': return <PassportsView passports={passports} selectedPassportId={selectedPassportId} setSelectedPassportId={setSelectedPassportId} searchQuery={searchQuery} clients={clients} assets={assets} onUpdatePassport={(updated) => setPassports(current => current.map(item => item.id === updated.id ? updated : item))} onNavigateTab={onNavigateTab} />;
    case '/scans': return <ScansView scans={scans} clients={clients} assets={assets} passports={passports} onTriggerNewScan={triggerScan} />;
    case '/monitoring': return <MonitoringView />;
    case '/alerts': return <AlertsView alerts={alerts} onUpdateAlertStatus={updateAlertStatus} />;
    case '/security': return <SecurityCenterView clients={clients} passports={passports} />;
    case '/compliance': return <ComplianceView clients={clients} />;
    case '/clients': return <ClientsView clients={clients} selectedClientId={selectedClientId} setSelectedClientId={setSelectedClientId} passports={passports} onNavigateTab={onNavigateTab} searchQuery={searchQuery} />;
    case '/vendors': return <VendorsView vendors={EMPTY_VENDORS} searchQuery={searchQuery} />;
    case '/integrations': return <><GitHubEvidencePanel /><IntegrationsView integrations={integrations} onToggleConnection={toggleIntegration} onSyncIntegration={syncIntegration} onNavigateTab={(tab) => onNavigateTab(tab)} /></>;
    case '/agent-trust': return <AgentTrustView />;
    case '/msp': return <MSPCommandCenter clients={clients} alerts={alerts} onSelectClient={setSelectedClientId} onNavigate={(tab) => onNavigateTab(tab)} />;
    case '/enterprise-readiness': return <EnterpriseReadinessView clients={clients} />;
    case '/investor': return <InvestorHomeView passports={passports} clients={clients} alerts={alerts} onShowTelemetry={() => navigate('/monitoring')} onNavigateTab={onNavigateTab} />;
    case '/founder': return <FounderDashboardView userRole={userRole} />;
    case '/extensions': return <ExtensionMarketplace installedExtensions={installedExtensions} onInstall={installExtension} onUninstall={uninstallExtension} onNavigateTab={(tab) => onNavigateTab(tab)} />;
    case '/billing': return <BillingView />;
    case '/settings': return <SettingsView theme={theme} onToggleTheme={() => setTheme(current => current === 'dark' ? 'light' : 'dark')} />;
    case '/free-review': return <div className="mx-auto max-w-4xl py-12"><h1 className="text-3xl font-bold">Free Review</h1><p className="mt-3 text-slate-400">Start with evidence collection. No trust score is invented when evidence is missing.</p><button onClick={() => navigate('/login')} className="mt-6 rounded-lg bg-cyan-300 px-4 py-2 font-semibold text-slate-950">Sign in to continue</button></div>;
    case '/pricing': return <div className="mx-auto max-w-5xl py-12"><h1 className="text-3xl font-bold">Pricing</h1><p className="mt-3 text-slate-400">Choose a verification workflow after authentication and tenant setup.</p></div>;
    default: return <div className="py-12"><h1 className="text-3xl font-bold">Page not found</h1><button onClick={() => navigate('/dashboard')} className="mt-5 rounded-lg bg-cyan-300 px-4 py-2 font-semibold text-slate-950">Dashboard</button></div>;
  }})();
  return <AppShell user={user}>{view}</AppShell>;
}
