/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Building2,
  CheckCircle2,
  FileText,
  Palette,
  RefreshCw,
  Users,
} from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

interface Props {
  onNavigateTab: (tab: string, itemId?: string) => void;
  onContinue: () => void;
}

type LaunchState = {
  teamMembers: number | null;
  brandingConfigured: boolean | null;
  monitoringCount: number | null;
  reportSnapshots: number | null;
  discoveredCustomers: number | null;
  mappedCustomers: number | null;
  liveCustomerProviders: string[];
};

type IntegrationRow = {
  provider?: string;
  credentialStatus?: string;
};

const CUSTOMER_DISCOVERY_PROVIDERS = new Set(['connectwise', 'autotask', 'ninjaone', 'hudu']);

function hasBranding(value: any): boolean {
  if (!value || typeof value !== 'object') return false;
  if (typeof value.companyName === 'string' && value.companyName.trim()) return true;
  if (typeof value.brandColor === 'string' && value.brandColor.trim()) return true;
  if (typeof value.logoDataUrl === 'string' && value.logoDataUrl.trim()) return true;
  const theme = value.theme;
  if (!theme || typeof theme !== 'object' || Array.isArray(theme)) return false;
  if (typeof theme.productName === 'string' && theme.productName.trim()) return true;
  if (typeof theme.tagline === 'string' && theme.tagline.trim()) return true;
  if (typeof theme.footerText === 'string' && theme.footerText.trim()) return true;
  if (typeof theme.faviconDataUrl === 'string' && theme.faviconDataUrl.trim()) return true;
  if (theme.colors && typeof theme.colors === 'object' && Object.keys(theme.colors).length > 0) return true;
  return false;
}

export default function MSPLaunchChecklist({ onNavigateTab, onContinue }: Props) {
  const [state, setState] = useState<LaunchState>({
    teamMembers: null,
    brandingConfigured: null,
    monitoringCount: null,
    reportSnapshots: null,
    discoveredCustomers: null,
    mappedCustomers: null,
    liveCustomerProviders: [],
  });
  const [loading, setLoading] = useState(true);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setRefreshError(null);
    try {
      const [teamResponse, brandingResponse, monitoringResponse, passportsResponse, integrationsResponse] = await Promise.all([
        apiFetch('/api/organization/team'),
        apiFetch('/api/organization/branding'),
        apiFetch('/api/monitoring/monitoring-configurations'),
        apiFetch('/api/user/passports'),
        apiFetch('/api/integrations-live'),
      ]);

      const team = await teamResponse.json().catch(() => null);
      const branding = await brandingResponse.json().catch(() => null);
      const monitoring = await monitoringResponse.json().catch(() => null);
      const passports = await passportsResponse.json().catch(() => null);
      const integrations = await integrationsResponse.json().catch(() => null);

      const liveCustomerProviders = Array.isArray(integrations)
        ? (integrations as IntegrationRow[])
            .filter((item) => item?.provider && CUSTOMER_DISCOVERY_PROVIDERS.has(item.provider) && item.credentialStatus === 'LIVE')
            .map((item) => String(item.provider))
        : [];

      let discoveredCustomers: number | null = liveCustomerProviders.length ? 0 : null;
      let mappedCustomers: number | null = liveCustomerProviders.length ? 0 : null;
      if (liveCustomerProviders.length) {
        const customerResponses = await Promise.all(
          liveCustomerProviders.map((provider) =>
            apiFetch(`/api/integrations-live/${encodeURIComponent(provider)}/customers`).catch(() => null)
          )
        );
        for (const response of customerResponses) {
          if (!response?.ok) continue;
          const rows = await response.json().catch(() => []);
          if (!Array.isArray(rows)) continue;
          discoveredCustomers = (discoveredCustomers ?? 0) + rows.length;
          mappedCustomers = (mappedCustomers ?? 0) + rows.filter((row: any) => Boolean(row?.client_id)).length;
        }
      }

      let reportSnapshots: number | null = null;
      const firstPassportId = Array.isArray(passports) && passports.length && passports[0]?.id
        ? String(passports[0].id)
        : null;
      if (firstPassportId) {
        const reportResponse = await apiFetch(
          `/api/trust-loop/reports/${encodeURIComponent(firstPassportId)}/history?type=executive`
        ).catch(() => null);
        if (reportResponse?.ok) {
          const reportHistory = await reportResponse.json().catch(() => null);
          reportSnapshots = Array.isArray(reportHistory?.snapshots) ? reportHistory.snapshots.length : 0;
        }
      } else {
        reportSnapshots = 0;
      }

      setState({
        teamMembers: teamResponse.ok && Array.isArray(team) ? team.length : null,
        brandingConfigured: brandingResponse.ok ? hasBranding(branding) : null,
        monitoringCount: monitoringResponse.ok && Array.isArray(monitoring) ? monitoring.length : null,
        reportSnapshots,
        discoveredCustomers,
        mappedCustomers,
        liveCustomerProviders,
      });
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : 'Launch readiness could not be refreshed.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const tasks = useMemo(() => [
    {
      id: 'team',
      title: 'Invite your team',
      description: 'Add administrators, technicians, viewers, or client-scoped users. Roles are enforced by the server.',
      complete: state.teamMembers !== null && state.teamMembers > 1,
      detail: state.teamMembers === null ? 'Status unavailable' : `${state.teamMembers} workspace member${state.teamMembers === 1 ? '' : 's'}`,
      action: 'Manage team',
      path: '/team',
      icon: Users,
    },
    {
      id: 'customers',
      title: 'Discover and map MSP customers',
      description: 'Connect a supported MSP system, discover its customer roster, and map real provider customers to SPR clients.',
      complete: (state.mappedCustomers ?? 0) > 0,
      detail: state.liveCustomerProviders.length
        ? `${state.mappedCustomers ?? 0} mapped of ${state.discoveredCustomers ?? 0} discovered`
        : 'ConnectWise, Autotask, NinjaOne, or Hudu not live yet',
      action: 'Open integrations',
      path: '/integrations',
      icon: Building2,
    },
    {
      id: 'monitoring',
      title: 'Enable continuous monitoring',
      description: 'Enroll a real client and passport in a supported collector so SPR can detect evidence changes over time.',
      complete: (state.monitoringCount ?? 0) > 0,
      detail: state.monitoringCount === null ? 'Status unavailable' : `${state.monitoringCount} monitoring configuration${state.monitoringCount === 1 ? '' : 's'}`,
      action: 'Configure monitoring',
      path: '/monitoring',
      icon: Activity,
    },
    {
      id: 'branding',
      title: 'Set your MSP brand',
      description: 'Configure the tenant logo, product identity, theme, footer, and white-label presentation from the workspace.',
      complete: state.brandingConfigured === true,
      detail: state.brandingConfigured === null ? 'Status unavailable' : state.brandingConfigured ? 'Branding saved' : 'Using SPR defaults',
      action: 'Configure white label',
      path: '/white-label',
      icon: Palette,
    },
    {
      id: 'report',
      title: 'Create a client-facing report',
      description: 'Load an authoritative report from a real passport so the first evidence snapshot is persisted and shareable.',
      complete: (state.reportSnapshots ?? 0) > 0,
      detail: state.reportSnapshots === null ? 'Status unavailable' : `${state.reportSnapshots} executive snapshot${state.reportSnapshots === 1 ? '' : 's'}`,
      action: 'Open reports',
      path: '/reports',
      icon: FileText,
    },
  ], [state]);

  const completed = tasks.filter((task) => task.complete).length;

  return (
    <section className="spr-panel p-6 space-y-5" id="msp-launch-checklist">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[.22em] text-[var(--spr-highlight)]">MSP launch readiness</div>
          <h2 className="mt-2 text-xl font-display font-extrabold text-[var(--spr-text)]">Finish the setup without founder assistance</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--spr-text-muted)]">
            These checks are read from tenant-scoped server data. Nothing is marked complete from browser storage or a demo flag.
            A solo MSP may skip team and branding steps and return later.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] px-3 py-2 text-xs font-mono text-[var(--spr-text-muted)]">
            {completed}/{tasks.length} launch steps
          </span>
          <button type="button" onClick={() => void refresh()} disabled={loading} className="spr-btn spr-btn-secondary inline-flex items-center gap-2 disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {refreshError && <div role="alert" className="rounded-md border border-[var(--spr-red)]/30 bg-[var(--spr-red)]/10 px-4 py-3 text-xs text-[var(--spr-red)]">{refreshError}</div>}

      <div className="grid gap-3 lg:grid-cols-5">
        {tasks.map((task) => {
          const Icon = task.icon;
          return (
            <article key={task.id} className="flex min-h-[220px] flex-col justify-between rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <Icon className="h-4 w-4 text-[var(--spr-highlight)]" />
                  {task.complete
                    ? <CheckCircle2 className="h-4 w-4 text-[var(--spr-green)]" />
                    : <span className="text-[11px] font-mono uppercase text-[var(--spr-text-faint)]">Ready to configure</span>}
                </div>
                <h3 className="mt-3 text-sm font-bold text-[var(--spr-text)]">{task.title}</h3>
                <p className="mt-2 text-xs leading-5 text-[var(--spr-text-muted)]">{task.description}</p>
                <p className={`mt-3 text-[11px] font-mono ${task.complete ? 'text-[var(--spr-green)]' : 'text-[var(--spr-text-faint)]'}`}>{task.detail}</p>
              </div>
              <button type="button" onClick={() => onNavigateTab(task.path)} className="spr-btn spr-btn-secondary mt-4 inline-flex w-full items-center justify-center gap-1.5 !py-1.5 !text-[12px]">
                {task.action}<ArrowRight className="h-3 w-3" />
              </button>
            </article>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-[var(--spr-text)]">{completed === tasks.length ? 'MSP launch checklist complete' : 'You control when to leave setup'}</p>
          <p className="mt-1 text-xs text-[var(--spr-text-muted)]">
            {completed === tasks.length
              ? 'Team access, customer mapping, monitoring, branding, and a client-facing report are all backed by saved workspace data.'
              : 'Continue to the command center now or finish these revenue-ready steps first. No SPR operator action is required.'}
          </p>
        </div>
        <button type="button" onClick={onContinue} className="spr-btn spr-btn-primary inline-flex shrink-0 items-center justify-center gap-2">
          Continue to dashboard<ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </section>
  );
}
