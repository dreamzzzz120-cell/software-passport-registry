import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { getRedirectResult, onAuthStateChanged, signOut, type User } from 'firebase/auth';
import type { Alert, Client, Integration, Scan, SoftwarePassport, Vendor } from './types';
import { apiFetch } from './utils/apiClient';
import { auth } from './lib/firebase';
import { setAuthNotice } from './lib/authNotice';
import { isSignupTransitionActive } from './lib/signupTransition';
import CommandCenter from './components/CommandCenter';
import ExtensionWorkflow from './components/ExtensionWorkflow';
import ExtensionMarketplace from './components/ExtensionMarketplace';
import LoginView from './components/LoginView';
import EvidenceDashboardView from './components/EvidenceDashboardView';
import EvidenceExplorerView from './components/EvidenceExplorerView';
import AITrustCenterView from './components/AITrustCenterView';
import CoverageView from './components/CoverageView';
import AssetsView from './components/AssetsView';
import PassportsView from './components/PassportsView';
import ScansView from './components/ScansView';
import AlertsView from './components/AlertsView';
import ClientsView from './components/ClientsView';
import VendorsView from './components/VendorsView';
import QuestionnairesView from './components/QuestionnairesView';
import SavingsView from './components/SavingsView';
import GovernanceView from './components/GovernanceView';
import PrivacyView from './components/PrivacyView';
import IntegrationsView from './components/IntegrationsView';
import BillingView from './components/BillingView';
import ComplianceView from './components/ComplianceView';
import AgentTrustView from './components/AgentTrustView';
import EnterpriseReadinessView from './components/EnterpriseReadinessView';
import FounderDashboardView from './components/FounderDashboardView';
import InvestorHomeView from './components/InvestorHomeView';
import SettingsView from './components/SettingsView';
import TeamView from './components/TeamView';
import AuditLogView from './components/AuditLogView';
import MonitoringView from './components/MonitoringView';
import SecurityCenterView from './components/SecurityCenterView';
import MSPCommandCenter from './components/MSPCommandCenter';
import MspPricingView from './components/MspPricingView';
import MspLandingView from './components/MspLandingView';
import HomePage from './components/HomePage';
import FreeReviewView from './components/FreeReviewView';
import ViewErrorBoundary from './components/ViewErrorBoundary';
import { normalizeClientRecord, toJsonArrayColumn } from './lib/clientJsonColumns';
import TermsView from './components/legal/TermsView';
import PrivacyPolicyView from './components/legal/PrivacyPolicyView';
import ReportsView from './components/ReportsView';
import TrustGraphView from './components/TrustGraphView';
import { EXTENSIONS } from './workflows/extensionRegistry';

const PUBLIC_PATHS = new Set(['/','/login','/free-review','/pricing','/msp','/terms','/privacy']);
const EMPTY_CLIENTS: Client[] = [];
const EMPTY_PASSPORTS: SoftwarePassport[] = [];
const EMPTY_VENDORS: Vendor[] = [];
const EMPTY_INTEGRATIONS: Integration[] = [];
const EMPTY_SCANS: Scan[] = [];
const EMPTY_ALERTS: Alert[] = [];

// An alert's real workflow state lives on its most recent remediation work
// item (trust_remediation_work_items.status), not on the finding row itself —
// a finding can exist with no remediation ever created for it yet.
function deriveAlertStatus(remediationStatus: string | null | undefined, findingStatus: string | null | undefined): Alert['status'] {
  switch (remediationStatus) {
    case 'IN_PROGRESS': case 'READY_FOR_VERIFICATION': return 'Acknowledged';
    case 'BLOCKED': return 'Snoozed';
    case 'VERIFIED': case 'CLOSED': return 'Resolved';
    case 'CANCELLED': return 'Cancelled';
    case 'OPEN': return 'Active';
    default: return String(findingStatus || '').toLowerCase() === 'resolved' ? 'Resolved' : 'Active';
  }
}

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
  return <div className="grid min-h-screen place-items-center bg-[#1e1e1e] text-[#d4d4d4]"><div className="text-center"><img src="/brand/spr-icon.png" alt="SPR" className="mx-auto h-14 w-14 rounded-md border border-[#3c3c3c] bg-white object-contain p-1.5" /><div className="mt-4 text-xs font-semibold uppercase tracking-[.15em] text-[#9d9d9d]">Securing workspace</div><div className="mt-1 text-sm text-[#6f6f6f]">Checking authenticated session…</div></div></div>;
}


function WorkflowBoundary({ title, description, extensionId, onNavigate }: { title: string; description: string; extensionId?: string; onNavigate: (path: string) => void }) {
  const extension = extensionId ? EXTENSIONS.find((item) => item.id === extensionId) : undefined;
  return <section className="spr-panel p-6 md:p-8"><div className="text-[10px] font-semibold uppercase tracking-[.15em] text-[#6f6f6f]">Workflow boundary</div><h1 className="mt-2 text-2xl font-semibold tracking-tight text-[#d4d4d4]">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[#9d9d9d]">{description}</p>{extension && <button onClick={() => onNavigate(extension.entryPath)} className="spr-btn spr-btn-primary mt-5">Open {extension.name} →</button>}</section>;
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
  const [findings, setFindings] = useState<unknown[]>([]);
  const [scans, setScans] = useState<Scan[]>(EMPTY_SCANS);
  const [integrations, setIntegrations] = useState<Integration[]>(EMPTY_INTEGRATIONS);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    let mounted = true;
    let redirectSettled = false;
    let observedUser: User | null = null;
    const timeoutId = window.setTimeout(() => {
      if (mounted) setAuthReady(true);
    }, 10_000);
    // Firebase auto-signs-in a newly created account before SPR has
    // provisioned or verified it. That transient session must not be
    // treated as a completed SPR login, or it unmounts LoginView mid-signup
    // and triggers an authenticated data load that correctly 403s - which
    // is what made a successful signup render as a provisioning failure.
    const applyUser = (candidate: User | null) => {
      if (candidate && isSignupTransitionActive()) return;
      setUser(candidate);
    };
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (!mounted) return;
      observedUser = currentUser;
      if (!redirectSettled) return;
      applyUser(currentUser);
      setAuthReady(true);
      window.clearTimeout(timeoutId);
    }, () => {
      if (mounted) {
        setAuthReady(true);
        window.clearTimeout(timeoutId);
      }
    });
    void getRedirectResult(auth).then((result) => {
      redirectSettled = true;
      if (mounted) applyUser(result?.user || observedUser);
      if (mounted) setAuthReady(true);
      window.clearTimeout(timeoutId);
    }).catch((error) => {
      redirectSettled = true;
      console.error('[Firebase redirect sign-in error]', error);
      if (mounted) applyUser(observedUser);
      if (mounted) setAuthReady(true);
      window.clearTimeout(timeoutId);
    });
    return () => {
      mounted = false;
      window.clearTimeout(timeoutId);
      unsubscribe();
    };
  }, []);
  useEffect(() => { if (authReady && !user && !PUBLIC_PATHS.has(path)) navigate('/login'); }, [authReady, user, path]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      const responses = await Promise.all([
        apiFetch('/api/user/me'), apiFetch('/api/scans'), apiFetch('/api/trust-loop/findings'), apiFetch('/api/user/passports'), apiFetch('/api/user/clients'), apiFetch('/api/integrations'), apiFetch('/api/vendors'),
      ]);
      if (responses.some((response) => response.status === 401)) {
        setUser(null);
        setAuthNotice('Your session could not be verified. Please sign in again.');
        await signOut(auth);
        navigate('/login');
        return;
      }
      const [me, scansResponse, findingsResponse, passportsResponse, clientsResponse, integrationsResponse, vendorsResponse] = responses;
      if (me.ok) { const data = await me.json().catch(() => null); if (!cancelled) setRole(String(data?.role || 'Viewer')); }
      if (scansResponse.ok) { const data = await scansResponse.json().catch(() => []); if (!cancelled && Array.isArray(data)) setScans(data); }
      if (findingsResponse.ok) { const data = await findingsResponse.json().catch(() => []); const rows = Array.isArray(data) ? data : data?.findings; if (!cancelled && Array.isArray(rows)) { setFindings(rows); setAlerts(rows.map((row: any) => ({ id: String(row.id), title: String(row.title || row.control_id || 'Trust finding'), severity: String(row.severity || 'Low').replace(/^./, (s: string) => s.toUpperCase()), category: 'Trust finding', clientName: String(row.client_id || 'Tenant'), description: String(row.description || 'Evidence-backed finding'), timestamp: String(row.updated_at || ''), status: deriveAlertStatus(row.remediation_status, row.status), remediationId: row.remediation_id ? String(row.remediation_id) : null, ownerDisplay: row.remediation_owner_display || null, slaDueAt: row.remediation_sla_due_at || null })) as Alert[]); } }
      if (passportsResponse.ok) { const data = await passportsResponse.json().catch(() => []); const rows = Array.isArray(data) ? data : data?.passports; if (!cancelled && Array.isArray(rows)) { const normalized = rows.map((row: any) => ({ ...row, id: String(row.id), name: String(row.name || 'Unnamed software'), version: String(row.version || 'unknown'), publisher: String(row.publisher || 'unknown'), clientId: row.clientId ? String(row.clientId) : undefined, evidence: Array.isArray(row.evidence) ? row.evidence : [], vulnerabilities: Array.isArray(row.vulnerabilities) ? row.vulnerabilities : [], timeline: toJsonArrayColumn(row.timeline), sbom: toJsonArrayColumn(row.sbom), scores: null, scoreStatus: row.scoreStatus || 'not_authoritatively_scored' })) as SoftwarePassport[]; setPassports(normalized); setAssets(normalized.map((passport: any) => ({ id: passport.id, name: passport.name, hostName: passport.name, type: passport.category || 'software', clientId: passport.clientId, clientName: String(passport.clientId || 'Unobserved'), environment: String(passport.environment || 'Unobserved'), version: passport.version }))); } }
      // normalizeClientRecord is applied server-side too; repeating it here is
      // deliberate and idempotent. It guards against a legacy row, a cached
      // response predating the server fix, or any other route that returns a
      // client, so a raw JSON-string column can never reach a component that
      // calls .some()/.map() on it.
      if (clientsResponse.ok) { const data = await clientsResponse.json().catch(() => []); const rows = Array.isArray(data) ? data : data?.clients; if (!cancelled && Array.isArray(rows)) setClients(rows.map((row: any) => normalizeClientRecord({ ...row, id: String(row.id), name: String(row.name || row.company_name || 'Unnamed client') })) as Client[]); }
      if (integrationsResponse.ok) { const data = await integrationsResponse.json().catch(() => []); if (!cancelled && Array.isArray(data)) setIntegrations(data); }
      if (vendorsResponse.ok) { const data = await vendorsResponse.json().catch(() => []); if (!cancelled && Array.isArray(data)) setVendors(data as Vendor[]); } else if (!cancelled) { setVendors(EMPTY_VENDORS); }
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

  const performAlertAction = async (alert: Alert, action: 'acknowledge' | 'assign' | 'resolve' | 'escalate' | 'snooze' | 'reopen', assigneeDisplay?: string) => {
    let remediationId = alert.remediationId;
    if (!remediationId) {
      const created = await apiFetch('/api/trust-loop/remediations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ findingId: alert.id, title: alert.title, description: alert.description, priority: alert.severity.toUpperCase() }),
      });
      if (!created.ok) return;
      const createdBody = await created.json().catch(() => null);
      remediationId = createdBody?.id ? String(createdBody.id) : undefined;
      if (!remediationId) return;
    }
    const patchBody: Record<string, unknown> = {
      acknowledge: { status: 'IN_PROGRESS' },
      resolve: { status: 'CLOSED' },
      snooze: { status: 'BLOCKED' },
      reopen: { status: 'OPEN' },
      escalate: { status: 'IN_PROGRESS', slaDueAt: new Date(Date.now() + 4 * 3600 * 1000).toISOString() },
      assign: { status: 'IN_PROGRESS', ownerDisplay: assigneeDisplay || '' },
    }[action];
    const response = await apiFetch(`/api/trust-loop/remediations/${encodeURIComponent(remediationId)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patchBody),
    });
    if (!response.ok) return;
    const updated = await response.json().catch(() => null);
    setAlerts((current) => current.map((item) => item.id === alert.id ? {
      ...item,
      remediationId,
      status: deriveAlertStatus(updated?.status ?? String(patchBody.status), null),
      ownerDisplay: updated?.owner_display ?? (patchBody.ownerDisplay as string | undefined) ?? item.ownerDisplay,
      slaDueAt: updated?.sla_due_at ?? (patchBody.slaDueAt as string | undefined) ?? item.slaDueAt,
    } : item));
  };
  const selectedExtension = useMemo(() => { const match = path.match(/^\/extensions\/([^/]+)/); return match ? decodeURIComponent(match[1]) : null; }, [path]);
  const signOutUser = async () => { await signOut(auth); navigate('/login'); };

  if (!authReady) return <AuthLoading />;
  if (path === '/') return <HomePage onCreatePassport={() => navigate('/login')} onExploreTrustNetwork={() => navigate('/free-review')} />;
  if (path === '/login') return <LoginView onLoginSuccess={() => navigate('/dashboard')} />;
  // Public legal documents -- always reachable regardless of auth state,
  // since /terms has no existing authenticated route to preserve. /privacy
  // is intentionally only handled here for signed-out visitors: the existing
  // authenticated '/privacy' route (below, in the CommandCenter switch) is
  // the unrelated internal Privacy Governance tool and must not be replaced.
  if (path === '/terms') return <TermsView />;
  if (!user && path === '/privacy') return <PrivacyPolicyView />;
  if (!user && path === '/free-review') return <FreeReviewView onSignUp={() => navigate('/login')} />;
  if (!user && path === '/pricing') return <MspPricingView isAuthenticated={false} onPrimaryAction={() => navigate('/login')} />;
  if (!user && path === '/msp') return <MspLandingView onEnter={() => navigate('/login')} onViewPricing={() => navigate('/pricing')} />;
  if (!user) return <AuthLoading />;

  let view: ReactNode;
  if (selectedExtension) view = <ExtensionWorkflow id={selectedExtension} onNavigate={navigate} />;
  else switch (path) {
    case '/dashboard': view = <EvidenceDashboardView clients={clients} alerts={alerts} scans={scans} passports={passports} findings={findings} onNavigateTab={onNavigateTab} onOpenQuickAction={quickAction} />; break;
    case '/coverage': view = <CoverageView clients={clients} scans={scans} passports={passports} onNavigateTab={onNavigateTab} />; break;
    case '/evidence-explorer': view = <EvidenceExplorerView passports={passports} />; break;
    case '/assets': view = <AssetsView clients={clients} searchQuery="" assets={assets} />; break;
    case '/passports': case '/registry': view = <PassportsView passports={passports} selectedPassportId={selectedPassportId} setSelectedPassportId={setSelectedPassportId} searchQuery="" clients={clients} assets={assets} role={role} onNavigateTab={onNavigateTab} onUpdatePassport={(passport) => setPassports((current) => current.map((item) => item.id === passport.id ? passport : item))} />; break;
    case '/scans': view = <ScansView scans={scans} clients={clients} assets={assets} passports={passports} role={role} onTriggerNewScan={(scan) => setScans((current) => [scan, ...current.filter((item) => item.id !== scan.id)].slice(0, 100))} />; break;
    case '/alerts': view = <AlertsView alerts={alerts} onAlertAction={performAlertAction} role={role} />; break;
    case '/reports': view = <ReportsView clients={clients} passports={passports} scans={scans} alerts={alerts} findings={findings} role={role} />; break;
    case '/trust-graph': view = <TrustGraphView clients={clients} passports={passports} assets={assets} findings={findings} />; break;
    case '/clients': view = <ClientsView clients={clients} selectedClientId={selectedClientId} setSelectedClientId={setSelectedClientId} passports={passports} onNavigateTab={onNavigateTab} searchQuery="" role={role} onClientCreated={(client) => { setClients((current) => [client, ...current]); setSelectedClientId(client.id); }} />; break;
    case '/vendors': view = <VendorsView vendors={vendors} searchQuery="" role={role} onVendorsChange={setVendors} />; break;
    case '/questionnaires': view = <QuestionnairesView role={role} clients={clients} passports={passports} />; break;
    case '/savings': view = <SavingsView role={role} />; break;
    case '/governance': view = <GovernanceView role={role} />; break;
    case '/privacy': view = <PrivacyView role={role} />; break;
    case '/integrations': view = <IntegrationsView passports={passports} clients={clients} onNavigateTab={onNavigateTab} />; break;
    case '/monitoring': view = <MonitoringView role={role} passports={passports} clients={clients} />; break;
    case '/security': view = <SecurityCenterView clients={clients} passports={passports} />; break;
    case '/compliance': view = <ComplianceView clients={clients} role={role} />; break;
    case '/msp': view = <MSPCommandCenter clients={clients} alerts={alerts} passports={passports} role={role} onSelectClient={setSelectedClientId} onSelectPassport={setSelectedPassportId} onNavigate={navigate} />; break;
    case '/agent-trust': view = <AgentTrustView />; break;
    case '/ai-trust-center': view = <AITrustCenterView role={role} />; break;
    case '/enterprise-readiness': view = <EnterpriseReadinessView clients={clients} />; break;
    case '/investor': view = <InvestorHomeView passports={passports} clients={clients} alerts={alerts} onShowTelemetry={() => navigate('/scans')} onNavigateTab={onNavigateTab} />; break;
    case '/founder': view = <FounderDashboardView userRole={role} />; break;
    case '/billing': view = <BillingView />; break;
    case '/pricing': view = <MspPricingView isAuthenticated={true} onPrimaryAction={() => navigate('/billing')} />; break;
    case '/settings': view = <SettingsView theme={theme} onToggleTheme={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')} />; break;
    case '/team': view = <TeamView role={role} />; break;
    case '/audit-log': view = <AuditLogView />; break;
    case '/extensions': view = <ExtensionMarketplace onNavigateTab={onNavigateTab} role={role} />; break;
    // Free Review is a public tool, but a signed-in user reaching it fell
    // through to the default WorkflowBoundary below - so following the link
    // while authenticated landed on a generic "Workflow" page instead of the
    // scanner. Render it inside the Command Center so the left rail stays.
    case '/free-review': view = <FreeReviewView onSignUp={() => navigate('/passports')} />; break;
    default: view = <WorkflowBoundary title="Workflow" description="This authenticated capability is explicitly routed through the Command Center. Choose its owning workflow from the left rail." onNavigate={navigate} />;
  }

  return (
    <CommandCenter path={path} userEmail={user.email} role={role} onNavigate={navigate} onSignOut={() => void signOutUser()}>
      <ViewErrorBoundary routeKey={path}>{view}</ViewErrorBoundary>
    </CommandCenter>
  );
}
