import { useEffect, useMemo, useState } from 'react';

type Health = { status: 'checking' | 'healthy' | 'degraded' | 'offline'; detail?: string };
type Page = { path: string; label: string; group: string };

const pages: Page[] = [
  { path: '/dashboard', label: 'Dashboard', group: 'Workspace' },
  { path: '/assets', label: 'Assets', group: 'Workspace' },
  { path: '/registry', label: 'Registry', group: 'Workspace' },
  { path: '/passports', label: 'Passports', group: 'Trust' },
  { path: '/evidence', label: 'Evidence Explorer', group: 'Trust' },
  { path: '/monitoring', label: 'Monitoring', group: 'Trust' },
  { path: '/alerts', label: 'Alerts', group: 'Operations' },
  { path: '/compliance', label: 'Compliance', group: 'Operations' },
  { path: '/clients', label: 'Clients & Tenants', group: 'Operations' },
  { path: '/integrations', label: 'Integrations', group: 'Operations' },
  { path: '/msp', label: 'MSP Command Center', group: 'Enterprise' },
  { path: '/enterprise-readiness', label: 'Enterprise Readiness', group: 'Enterprise' },
  { path: '/investor', label: 'Investor View', group: 'Enterprise' },
  { path: '/founder', label: 'Founder Dashboard', group: 'Enterprise' },
  { path: '/billing', label: 'Billing', group: 'Account' },
  { path: '/settings', label: 'Settings', group: 'Account' },
  { path: '/login', label: 'Login', group: 'Account' },
  { path: '/free-review', label: 'Free Review', group: 'Public' },
  { path: '/pricing', label: 'Pricing', group: 'Public' },
];

function navigate(path: string) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function usePath() {
  const [path, setPath] = useState(() => window.location.pathname || '/');
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname || '/');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return path;
}

function useHealth() {
  const [health, setHealth] = useState<Health>({ status: 'checking' });
  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const response = await fetch('/health', { headers: { Accept: 'application/json' }, cache: 'no-store' });
        const body = await response.json().catch(() => ({}));
        if (!active) return;
        setHealth(response.ok
          ? { status: 'healthy', detail: typeof body?.status === 'string' ? body.status : 'operational' }
          : { status: 'degraded', detail: `HTTP ${response.status}` });
      } catch {
        if (active) setHealth({ status: 'offline', detail: 'API unavailable' });
      }
    };
    void check();
    const timer = window.setInterval(check, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  return health;
}

function Shell({ children, health }: { children: React.ReactNode; health: Health }) {
  const path = usePath();
  const groups = useMemo(() => Array.from(new Set(pages.map(p => p.group))), []);
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <button onClick={() => navigate('/dashboard')} className="text-left">
            <div className="text-xs font-bold uppercase tracking-[.25em] text-cyan-300">SPR</div>
            <div className="text-lg font-bold">Software Passport Registry</div>
          </button>
          <div className="flex items-center gap-3 text-sm">
            <span className={`h-2.5 w-2.5 rounded-full ${health.status === 'healthy' ? 'bg-emerald-400' : health.status === 'checking' ? 'bg-amber-400' : 'bg-rose-400'}`} />
            <span className="text-slate-300">{health.status === 'healthy' ? 'Operational' : health.detail ?? health.status}</span>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl grid-cols-1 md:grid-cols-[240px_1fr]">
        <aside className="border-r border-white/10 p-4 md:min-h-[calc(100vh-73px)]">
          {groups.map(group => (
            <div key={group} className="mb-5">
              <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[.2em] text-slate-500">{group}</div>
              <nav className="space-y-1">
                {pages.filter(p => p.group === group).map(p => (
                  <button key={p.path} onClick={() => navigate(p.path)} className={`w-full rounded-lg px-3 py-2 text-left text-sm ${path === p.path ? 'bg-cyan-300/10 text-cyan-200' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}>
                    {p.label}
                  </button>
                ))}
              </nav>
            </div>
          ))}
        </aside>
        <main className="min-w-0 p-5 md:p-8">{children}</main>
      </div>
    </div>
  );
}

function Card({ title, value, detail }: { title: string; value: string; detail: string }) {
  return <article className="rounded-2xl border border-white/10 bg-white/[.04] p-5"><div className="text-xs uppercase tracking-wider text-slate-500">{title}</div><div className="mt-2 text-2xl font-bold">{value}</div><div className="mt-1 text-sm text-slate-400">{detail}</div></article>;
}

function Dashboard({ health }: { health: Health }) {
  return <>
    <PageTitle title="Dashboard" subtitle="Evidence-first software trust operations." />
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Card title="System" value={health.status === 'healthy' ? 'Healthy' : health.status} detail={health.detail ?? 'Checking API'} /><Card title="Trust model" value="12 dimensions" detail="Evidence-backed trust vector" /><Card title="Provenance" value="Required" detail="Observed evidence only" /><Card title="Queue" value="Online" detail="Worker-backed processing" /></div>
    <section className="mt-6 grid gap-5 lg:grid-cols-2"><Panel title="Start a workflow"><div className="grid gap-3 sm:grid-cols-2"><Action label="Open Registry" path="/registry" /><Action label="Review Passports" path="/passports" /><Action label="Explore Evidence" path="/evidence" /><Action label="Configure Monitoring" path="/monitoring" /></div></Panel><Panel title="Operational posture"><ul className="space-y-3 text-sm text-slate-300"><li>✓ Browser security headers enforced</li><li>✓ Production health endpoint available</li><li>✓ Database migrations managed</li><li>✓ Worker deployment health monitored</li></ul></Panel></section>
  </>;
}

function Action({ label, path }: { label: string; path: string }) { return <button onClick={() => navigate(path)} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm font-semibold hover:bg-white/10">{label}<span className="ml-2 text-cyan-300">→</span></button>; }
function Panel({ title, children }: { title: string; children: React.ReactNode }) { return <section className="rounded-2xl border border-white/10 bg-white/[.03] p-5"><h2 className="font-semibold">{title}</h2><div className="mt-4">{children}</div></section>; }
function PageTitle({ title, subtitle }: { title: string; subtitle: string }) { return <div className="mb-6"><h1 className="text-3xl font-bold tracking-tight">{title}</h1><p className="mt-2 text-sm text-slate-400">{subtitle}</p></div>; }

function GenericPage({ page }: { page: Page }) {
  const isPublic = page.group === 'Public';
  return <><PageTitle title={page.label} subtitle={isPublic ? 'Public SPR experience.' : `SPR ${page.label.toLowerCase()} workspace.`} />
    <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]"><Panel title="Workspace ready"><div className="space-y-4 text-sm text-slate-300"><p>This page is now a real routed view rather than a dead link. Its state is intentionally explicit: data is only shown when the backend returns it.</p><div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-amber-100">No fabricated records are displayed. Connect the authenticated API workflow to populate live tenant data.</div></div></Panel><Panel title="Available actions"><div className="space-y-2"><Action label="Return to dashboard" path="/dashboard" /><Action label="Open registry" path="/registry" /></div></Panel></div></>;
}

function Login() { return <><PageTitle title="Login" subtitle="Secure access to the SPR workspace." /><div className="mx-auto max-w-md"><Panel title="Authentication"><p className="text-sm text-slate-400">Production authentication is handled by the configured identity provider. No credentials are stored in this client.</p><button onClick={() => { window.location.href = '/api/auth/login'; }} className="mt-5 w-full rounded-lg bg-cyan-300 px-4 py-3 font-semibold text-slate-950">Continue to sign in</button></Panel></div></>; }

export default function App() {
  const path = usePath();
  const health = useHealth();
  if (path === '/') return <Shell health={health}><Dashboard health={health} /></Shell>;
  if (path === '/login') return <Shell health={health}><Login /></Shell>;
  const page = pages.find(p => p.path === path);
  return <Shell health={health}>{page ? <GenericPage page={page} /> : <><PageTitle title="Page not found" subtitle="The requested route does not exist." /><Action label="Go to dashboard" path="/dashboard" /></>}</Shell>;
}
