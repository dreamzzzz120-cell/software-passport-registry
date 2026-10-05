import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, ExternalLink, RefreshCw, Settings2, ShieldAlert } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

type FeatureState = 'AVAILABLE' | 'CONFIG_REQUIRED' | 'DEPENDENCY_DOWN' | 'PERMISSION_BLOCKED' | 'UNKNOWN';
type FeatureRow = {
  id: string;
  group: string;
  name: string;
  path?: string;
  dependency?: string;
  access: string;
  state: FeatureState;
  reason: string;
  actionLabel: string;
  actionPath: string;
};

type FounderConnection = { key: string; name: string; status: 'ok' | 'error' | 'not_configured'; detail: string };
type CommandCenterPayload = { connections?: FounderConnection[] };
type OverviewPayload = {
  pulse?: {
    database?: { ok?: boolean };
    tenantRls?: boolean | null;
    leastPrivilege?: boolean | null;
    worker?: { lastSeenAt?: string | null; lastSeenSource?: string | null };
  };
};
type BillingPayload = { billingConfigured?: boolean };
type IntegrationItem = { id: string; name: string; provider: string; capability: 'live' | 'planned'; credentialStatus: 'NOT_CONFIGURED' | 'CONFIGURED' | 'LIVE' | 'ERROR' };
type HealthPayload = { status?: string; mcpAvailable?: boolean };

const ROUTED_FEATURES: Array<Omit<FeatureRow, 'state' | 'reason'>> = [
  { id:'overview', group:'Core workspace', name:'Overview dashboard', path:'/dashboard', access:'Authenticated workspace', actionLabel:'Open', actionPath:'/dashboard' },
  { id:'msp', group:'Core workspace', name:'MSP Command Center', path:'/msp', access:'Authenticated workspace', actionLabel:'Open', actionPath:'/msp' },
  { id:'assets', group:'Core workspace', name:'Assets', path:'/assets', access:'Authenticated workspace', actionLabel:'Open', actionPath:'/assets' },
  { id:'passports', group:'Core workspace', name:'Software Passports', path:'/passports', access:'Authenticated workspace', actionLabel:'Open', actionPath:'/passports' },
  { id:'coverage', group:'Evidence & trust', name:'Evidence coverage', path:'/coverage', access:'Authenticated workspace', actionLabel:'Open', actionPath:'/coverage' },
  { id:'evidence-explorer', group:'Evidence & trust', name:'Evidence Explorer', path:'/evidence-explorer', access:'Authenticated workspace', actionLabel:'Open', actionPath:'/evidence-explorer' },
  { id:'evidence-exchange', group:'Evidence & trust', name:'Evidence Exchange', path:'/evidence-exchange', access:'Authenticated workspace', actionLabel:'Open', actionPath:'/evidence-exchange' },
  { id:'procurement-gate', group:'Evidence & trust', name:'Procurement Gate', path:'/procurement-gate', access:'Authenticated workspace', actionLabel:'Open', actionPath:'/procurement-gate' },
  { id:'vendor-evidence', group:'Evidence & trust', name:'Vendor Evidence Exchange', path:'/vendor-evidence-exchange', access:'Authenticated workspace', actionLabel:'Open', actionPath:'/vendor-evidence-exchange' },
  { id:'scans', group:'Scanning & monitoring', name:'Repository / SBOM scans', path:'/scans', access:'Owner/Admin/Operator for mutations', actionLabel:'Open scans', actionPath:'/scans' },
  { id:'monitoring', group:'Scanning & monitoring', name:'Continuous monitoring', path:'/monitoring', access:'Role-scoped mutations', dependency:'worker', actionLabel:'Open monitoring', actionPath:'/monitoring' },
  { id:'alerts', group:'Scanning & monitoring', name:'Alerts & remediation', path:'/alerts', access:'Role-scoped mutations', actionLabel:'Open alerts', actionPath:'/alerts' },
  { id:'registry', group:'Registry', name:'Public software registry', path:'/registry', access:'Authenticated registry workspace + public registry APIs', actionLabel:'Open registry', actionPath:'/registry' },
  { id:'trust-graph', group:'Evidence & trust', name:'Trust Graph', path:'/trust-graph', access:'Authenticated workspace', actionLabel:'Open graph', actionPath:'/trust-graph' },
  { id:'clients', group:'MSP operations', name:'Client management', path:'/clients', access:'Role-scoped', actionLabel:'Open clients', actionPath:'/clients' },
  { id:'vendors', group:'MSP operations', name:'Vendor risk', path:'/vendors', access:'Role-scoped', actionLabel:'Open vendors', actionPath:'/vendors' },
  { id:'questionnaires', group:'Governance', name:'Trust Response questionnaires', path:'/questionnaires', access:'Role-scoped', actionLabel:'Open', actionPath:'/questionnaires' },
  { id:'security', group:'Governance', name:'Security Center', path:'/security', access:'Authenticated workspace', actionLabel:'Open', actionPath:'/security' },
  { id:'compliance', group:'Governance', name:'Compliance', path:'/compliance', access:'Authenticated workspace', actionLabel:'Open', actionPath:'/compliance' },
  { id:'governance', group:'Governance', name:'Governance', path:'/governance', access:'Role-scoped', actionLabel:'Open', actionPath:'/governance' },
  { id:'privacy', group:'Governance', name:'Privacy governance', path:'/privacy', access:'Role-scoped', actionLabel:'Open', actionPath:'/privacy' },
  { id:'audit-log', group:'Governance', name:'Audit Log', path:'/audit-log', access:'Authenticated workspace', actionLabel:'Open', actionPath:'/audit-log' },
  { id:'reports', group:'Reports', name:'Reports Center', path:'/reports', access:'Role-scoped', actionLabel:'Open reports', actionPath:'/reports' },
  { id:'savings', group:'Commercial', name:'Time & Savings / ROI', path:'/savings', access:'Authenticated workspace', actionLabel:'Open', actionPath:'/savings' },
  { id:'team', group:'Administration', name:'Team & roles', path:'/team', access:'Owner/Admin for management', actionLabel:'Open team', actionPath:'/team' },
  { id:'white-label', group:'Administration', name:'White-label branding & domains', path:'/white-label', access:'Owner/Admin for changes', actionLabel:'Open branding', actionPath:'/white-label' },
  { id:'settings', group:'Administration', name:'Platform settings & sessions', path:'/settings', access:'Role-scoped', actionLabel:'Open settings', actionPath:'/settings' },
  { id:'extensions', group:'Extensions', name:'Extension Marketplace', path:'/extensions', access:'Owner/Admin/Operator for install/remove', actionLabel:'Open extensions', actionPath:'/extensions' },
  { id:'agent-trust', group:'AI trust', name:'AI Agent Trust', path:'/agent-trust', access:'Authenticated workspace', actionLabel:'Open', actionPath:'/agent-trust' },
  { id:'ai-trust', group:'AI trust', name:'AI Trust Center', path:'/ai-trust-center', access:'Authenticated workspace', actionLabel:'Open', actionPath:'/ai-trust-center' },
  { id:'enterprise', group:'Executive', name:'Enterprise Readiness', path:'/enterprise-readiness', access:'Authenticated workspace', actionLabel:'Open', actionPath:'/enterprise-readiness' },
  { id:'investor', group:'Executive', name:'Investor View', path:'/investor', access:'Authenticated workspace', actionLabel:'Open', actionPath:'/investor' },
  { id:'free-review', group:'Public acquisition', name:'Free Review', path:'/free-review', access:'Public', actionLabel:'Open public flow', actionPath:'/free-review' },
  { id:'billing', group:'Commercial', name:'Stripe billing, plans, add-ons & one-time products', path:'/billing', access:'Authenticated workspace', dependency:'billing', actionLabel:'Open billing', actionPath:'/billing' },
  { id:'mcp', group:'Machine interfaces', name:'SPR Trust MCP', path:'/mcp', access:'Bearer credential; read-only by design', dependency:'mcp', actionLabel:'Open connections', actionPath:'/founder#founder-connections' },
  { id:'public-api', group:'Machine interfaces', name:'Public API v1 & API keys', path:'/api/agent/v1', access:'Owner/Admin create keys; scoped machine access', actionLabel:'Open integrations', actionPath:'/integrations' },
  { id:'webhooks', group:'Machine interfaces', name:'Signed outbound webhooks', path:'/integrations', access:'Owner/Admin management', actionLabel:'Open integrations', actionPath:'/integrations' },
];

const stateClasses: Record<FeatureState,string> = {
  AVAILABLE:'border-[var(--spr-green)]/40 bg-[var(--spr-green)]/10 text-[var(--spr-green)]',
  CONFIG_REQUIRED:'border-[var(--spr-amber)]/40 bg-[var(--spr-amber)]/10 text-[var(--spr-amber)]',
  DEPENDENCY_DOWN:'border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 text-[var(--spr-red)]',
  PERMISSION_BLOCKED:'border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 text-[var(--spr-red)]',
  UNKNOWN:'border-[var(--spr-border)] bg-[var(--spr-surface-alt)] text-[var(--spr-text-muted)]',
};

function connectionState(connection: FounderConnection | undefined): { state: FeatureState; reason: string } {
  if (!connection) return { state:'UNKNOWN', reason:'Founder connection telemetry did not return this dependency.' };
  if (connection.status === 'ok') return { state:'AVAILABLE', reason:connection.detail || 'Live connection check passed.' };
  if (connection.status === 'not_configured') return { state:'CONFIG_REQUIRED', reason:connection.detail || 'Required connection settings are not configured.' };
  return { state:'DEPENDENCY_DOWN', reason:connection.detail || 'Live connection check failed.' };
}

function minutesSince(value?: string | null) {
  if (!value) return null;
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 60000));
}

export default function FounderFeatureControlMatrix() {
  const [command, setCommand] = useState<CommandCenterPayload | null>(null);
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [billing, setBilling] = useState<BillingPayload | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationItem[] | null>(null);
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [openGroups, setOpenGroups] = useState<Record<string,boolean>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    const errors:string[] = [];
    const [cc, ov, bill, ints, hp] = await Promise.all([
      apiFetch('/api/founder/command-center').then(async r => r.ok ? r.json() : Promise.reject(new Error('Founder connections unavailable'))).catch(e => { errors.push(e.message); return null; }),
      apiFetch('/api/founder/overview').then(async r => r.ok ? r.json() : Promise.reject(new Error('Founder overview unavailable'))).catch(e => { errors.push(e.message); return null; }),
      apiFetch('/api/billing').then(async r => r.ok ? r.json() : Promise.reject(new Error('Billing status unavailable'))).catch(e => { errors.push(e.message); return null; }),
      apiFetch('/api/integrations-live').then(async r => r.ok ? r.json() : Promise.reject(new Error('Integration catalog unavailable'))).catch(e => { errors.push(e.message); return null; }),
      fetch('/health', { cache:'no-store' }).then(async r => r.ok ? r.json() : Promise.reject(new Error('Health endpoint unavailable'))).catch(e => { errors.push(e.message); return null; }),
    ]);
    setCommand(cc); setOverview(ov); setBilling(bill); setIntegrations(Array.isArray(ints) ? ints : null); setHealth(hp); setLoadErrors(errors); setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const rows = useMemo<FeatureRow[]>(() => {
    const pulse = overview?.pulse;
    const workerAge = minutesSince(pulse?.worker?.lastSeenAt);
    const base = ROUTED_FEATURES.map((item):FeatureRow => {
      if (item.dependency === 'billing') {
        if (!billing) return { ...item, state:'UNKNOWN', reason:'Billing endpoint could not be verified.' };
        return billing.billingConfigured
          ? { ...item, state:'AVAILABLE', reason:'Stripe billing is configured and the billing route is available.' }
          : { ...item, state:'CONFIG_REQUIRED', reason:'Billing route exists, but Stripe credentials/prices are not fully configured.' };
      }
      if (item.dependency === 'mcp') {
        if (!health) return { ...item, state:'UNKNOWN', reason:'Health endpoint could not verify MCP availability.' };
        return health.mcpAvailable
          ? { ...item, state:'AVAILABLE', reason:'Server reports MCP transport enabled. It remains read-only by design.' }
          : { ...item, state:'CONFIG_REQUIRED', reason:'MCP code is shipped but SPR_MCP_BEARER_TOKEN is not active on this deployment.' };
      }
      if (item.dependency === 'worker') {
        if (workerAge == null) return { ...item, state:'UNKNOWN', reason:'Worker last-seen evidence is unavailable.' };
        return workerAge <= 30
          ? { ...item, state:'AVAILABLE', reason:`Worker evidence observed ${workerAge} minute${workerAge === 1 ? '' : 's'} ago from ${pulse?.worker?.lastSeenSource || 'worker telemetry'}.` }
          : { ...item, state:'DEPENDENCY_DOWN', reason:`Last worker evidence is ${workerAge} minutes old; monitoring cannot be called current.` };
      }
      return { ...item, state:'AVAILABLE', reason:'Capability is explicitly wired into the current SPR route/workflow map.' };
    });

    const connectionRows:FeatureRow[] = (command?.connections ?? []).map((connection) => {
      const resolved = connectionState(connection);
      return {
        id:`connection-${connection.key}`, group:'Platform connections', name:connection.name,
        dependency:connection.key, access:'Founder-only connection telemetry',
        state:resolved.state, reason:resolved.reason,
        actionLabel:resolved.state === 'AVAILABLE' ? 'Inspect' : 'Configure / fix',
        actionPath:'/founder#founder-connections',
      };
    });

    const integrationRows:FeatureRow[] = (integrations ?? []).map((item) => {
      let state:FeatureState = 'AVAILABLE';
      let reason = 'Provider adapter is shipped and accepts real authenticated evidence collection.';
      if (item.capability !== 'live') { state='CONFIG_REQUIRED'; reason='Provider is cataloged but no live collector is shipped.'; }
      else if (item.credentialStatus === 'NOT_CONFIGURED') { state='CONFIG_REQUIRED'; reason='Live adapter is shipped; provider credentials have not been configured for this tenant.'; }
      else if (item.credentialStatus === 'ERROR') { state='DEPENDENCY_DOWN'; reason='Live adapter is shipped, but the last authenticated provider test failed.'; }
      else if (item.credentialStatus === 'CONFIGURED') { state='CONFIG_REQUIRED'; reason='Credentials are saved but have not yet passed a live evidence test.'; }
      else if (item.credentialStatus === 'LIVE') { reason='Live authenticated provider test succeeded and evidence collection is enabled.'; }
      return { id:`integration-${item.provider}`, group:'Live integrations', name:item.name, dependency:item.provider, access:'Owner/Admin credentials; Owner/Admin/Operator test/collect', state, reason, actionLabel:state === 'AVAILABLE' ? 'Open integration' : 'Connect / test', actionPath:'/integrations' };
    });

    if (!integrations) {
      base.push({ id:'integrations-unverified', group:'Live integrations', name:'Integration catalog', dependency:'integrations-live', access:'Authenticated workspace', state:'UNKNOWN', reason:'The live integration catalog could not be loaded, so provider availability is not being guessed.', actionLabel:'Open integrations', actionPath:'/integrations' });
    }

    if (pulse) {
      const runtimeOk = pulse.database?.ok === true && pulse.tenantRls === true && pulse.leastPrivilege === true;
      base.unshift({
        id:'runtime-control-plane', group:'Platform health', name:'Database + tenant isolation + least-privileged runtime',
        dependency:'runtime', access:'Founder telemetry', state:runtimeOk ? 'AVAILABLE' : (pulse.database?.ok === false || pulse.tenantRls === false || pulse.leastPrivilege === false) ? 'DEPENDENCY_DOWN' : 'UNKNOWN',
        reason:runtimeOk ? 'Database, tenant RLS assertion and least-privileged runtime role are all observed healthy.' : 'One or more runtime controls are failed or unverified.',
        actionLabel:'Inspect mission control', actionPath:'/founder#spr-founder-command-center',
      });
    } else {
      base.unshift({ id:'runtime-control-plane', group:'Platform health', name:'Database + tenant isolation + least-privileged runtime', dependency:'runtime', access:'Founder telemetry', state:'UNKNOWN', reason:'Founder runtime telemetry could not be loaded.', actionLabel:'Inspect mission control', actionPath:'/founder#spr-founder-command-center' });
    }

    return [...base, ...connectionRows, ...integrationRows];
  }, [command, overview, billing, integrations, health]);

  const groups = useMemo(() => Array.from(new Set(rows.map(r => r.group))), [rows]);
  const counts = useMemo(() => rows.reduce((acc, row) => { acc[row.state]=(acc[row.state]||0)+1; return acc; }, {} as Record<FeatureState,number>), [rows]);

  return <section id="founder-feature-matrix" className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-5">
    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[.2em] text-[var(--spr-highlight)]">Founder control plane</div>
        <h2 className="mt-1 text-lg font-semibold text-[var(--spr-text)]">Feature Control Matrix</h2>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--spr-text-muted)]">Every major SPR surface in one place. Green means the capability is routed or live-tested as described; configuration, dependency failures and unknowns stay explicit. Security boundaries are shown, not removed.</p>
      </div>
      <button type="button" onClick={() => void refresh()} disabled={loading} className="spr-btn spr-btn-secondary inline-flex items-center gap-2 text-xs"><RefreshCw className={loading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />{loading ? 'Refreshing' : 'Refresh states'}</button>
    </div>

    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
      {(['AVAILABLE','CONFIG_REQUIRED','DEPENDENCY_DOWN','PERMISSION_BLOCKED','UNKNOWN'] as FeatureState[]).map(state => <div key={state} className={`rounded-md border px-3 py-2 ${stateClasses[state]}`}><div className="text-[10px] font-bold uppercase tracking-[.12em]">{state.replaceAll('_',' ')}</div><div className="mt-1 text-xl font-semibold">{counts[state] || 0}</div></div>)}
    </div>

    {loadErrors.length > 0 && <div className="mt-3 rounded-md border border-[var(--spr-amber)]/30 bg-[var(--spr-amber)]/10 px-3 py-2 text-xs text-[var(--spr-amber)]"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />{loadErrors.join(' · ')}</div>}

    <div className="mt-5 space-y-2">
      {groups.map(group => {
        const groupRows = rows.filter(r => r.group === group);
        const hasProblem = groupRows.some(r => r.state !== 'AVAILABLE');
        const open = openGroups[group] ?? hasProblem;
        return <div key={group} className="overflow-hidden rounded-md border border-[var(--spr-border)]">
          <button type="button" onClick={() => setOpenGroups(current => ({...current,[group]:!open}))} className="flex w-full items-center justify-between gap-3 bg-[var(--spr-surface-alt)] px-3 py-2 text-left">
            <span className="flex items-center gap-2 text-xs font-semibold text-[var(--spr-text)]">{hasProblem ? <ShieldAlert className="h-3.5 w-3.5 text-[var(--spr-amber)]" /> : <CheckCircle2 className="h-3.5 w-3.5 text-[var(--spr-green)]" />}{group}<span className="text-[11px] font-normal text-[var(--spr-text-muted)]">{groupRows.length} capabilities</span></span>
            {open ? <ChevronDown className="h-4 w-4 text-[var(--spr-text-muted)]" /> : <ChevronRight className="h-4 w-4 text-[var(--spr-text-muted)]" />}
          </button>
          {open && <div className="divide-y divide-[var(--spr-border)]">
            {groupRows.map(row => <div key={row.id} className="grid gap-3 px-3 py-3 lg:grid-cols-[minmax(180px,1.1fr)_150px_minmax(260px,2fr)_150px] lg:items-center">
              <div><div className="text-sm font-semibold text-[var(--spr-text)]">{row.name}</div><div className="mt-0.5 text-[11px] text-[var(--spr-text-faint)]">{row.path || row.dependency || 'internal capability'}</div></div>
              <div><span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-[.08em] ${stateClasses[row.state]}`}>{row.state.replaceAll('_',' ')}</span></div>
              <div><p className="text-xs leading-5 text-[var(--spr-text-muted)]">{row.reason}</p><p className="mt-1 text-[11px] text-[var(--spr-text-faint)]"><CircleHelp className="mr-1 inline h-3 w-3" />Access: {row.access}</p></div>
              <a href={row.actionPath} className="spr-btn spr-btn-secondary inline-flex items-center justify-center gap-1.5 text-xs"><Settings2 className="h-3.5 w-3.5" />{row.actionLabel}<ExternalLink className="h-3 w-3" /></a>
            </div>)}
          </div>}
        </div>;
      })}
    </div>
  </section>;
}
