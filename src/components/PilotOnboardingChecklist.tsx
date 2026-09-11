/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  CheckSquare, Square, CheckCircle2, ArrowRight, Key, Sparkles, RefreshCw, AlertTriangle, Lock
} from 'lucide-react';
import { Github, Gitlab } from 'lucide-react-base';
import { apiFetch } from '../utils/apiClient';

interface PilotOnboardingChecklistProps {
  clientsCount: number;
  passportsCount: number;
  scansCount: number;
  onOpenQuickAction: (actionType: 'add-client' | 'register-passport' | 'scan-sbom') => void;
  onNavigateTab: (tab: string, itemId?: string) => void;
}

// Shapes are the real responses of GET /api/integrations-live and
// GET /api/billing -- nothing here is derived from local state or storage.
type LiveIntegration = { id: string; provider: string; name: string; credentialStatus: string; lastTestedAt: string | null };
type CatalogPlan = { id: string; label: string; priceLabel: string | null; interval: string | null; clientLimit: number | null; checkoutAvailable: boolean };
type BillingStatus = {
  billingConfigured: boolean;
  plans: CatalogPlan[];
  subscription: { plan: string | null; status: string | null; clientLimit: number | null; currentPeriodEnd: string | null } | null;
  clientCount: number;
};

type RepoProvider = 'github' | 'gitlab';

async function responseError(response: Response, fallback: string) {
  const data = await response.json().catch(() => null);
  if (!data) return fallback;
  if (typeof data.error === 'string') return data.error;
  if (typeof data.error?.message === 'string') return data.error.message;
  return fallback;
}

export default function PilotOnboardingChecklist({
  clientsCount,
  passportsCount,
  scansCount,
  onOpenQuickAction,
  onNavigateTab
}: PilotOnboardingChecklistProps) {
  const [activeTab, setActiveTab] = useState<'integrations' | 'billing' | 'none'>('none');
  const [saving, setSaving] = useState<RepoProvider | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Repository credentials. These go to PUT /api/integrations-live/:provider/
  // credentials (encrypted at rest by the integration credential vault) --
  // the same path the full Integrations page uses -- and are never kept
  // here after a successful save.
  const [githubToken, setGithubToken] = useState('');
  const [gitlabToken, setGitlabToken] = useState('');
  const [gitlabBaseUrl, setGitlabBaseUrl] = useState('');

  const [integrations, setIntegrations] = useState<LiveIntegration[]>([]);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);

  const loadIntegrations = useCallback(async () => {
    try {
      const res = await apiFetch('/api/integrations-live');
      const data = await res.json().catch(() => []);
      if (res.ok && Array.isArray(data)) setIntegrations(data);
    } catch (err) {
      console.error('Failed to load live integration status from backend:', err);
    }
  }, []);

  const loadBilling = useCallback(async () => {
    try {
      const res = await apiFetch('/api/billing');
      if (!res.ok) { setBillingError(await responseError(res, 'Billing status is unavailable.')); return; }
      const data = await res.json();
      setBilling(data);
      setBillingError(null);
    } catch (err) {
      console.error('Failed to load billing status from backend:', err);
      setBillingError('Billing status is unavailable.');
    }
  }, []);

  useEffect(() => { void loadIntegrations(); void loadBilling(); }, [loadIntegrations, loadBilling]);

  const statusOf = (provider: RepoProvider) => integrations.find((item) => item.provider === provider)?.credentialStatus ?? 'NOT_CONFIGURED';
  const isConfigured = (provider: RepoProvider) => statusOf(provider) !== 'NOT_CONFIGURED';
  const githubConnected = isConfigured('github');
  const gitlabConnected = isConfigured('gitlab');

  const handleSaveCredentials = async (provider: RepoProvider) => {
    setSaving(provider);
    setSuccessMsg(null);
    setErrorMsg(null);
    try {
      const credentials: Record<string, string> = provider === 'github'
        ? { accessToken: githubToken.trim() }
        : { accessToken: gitlabToken.trim(), ...(gitlabBaseUrl.trim() ? { baseUrl: gitlabBaseUrl.trim() } : {}) };
      const res = await apiFetch(`/api/integrations-live/${provider}/credentials`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials)
      });
      if (!res.ok) throw new Error(await responseError(res, `Unable to save ${provider} credentials.`));
      if (provider === 'github') setGithubToken(''); else { setGitlabToken(''); setGitlabBaseUrl(''); }
      setSuccessMsg(`${provider === 'github' ? 'GitHub' : 'GitLab'} credentials saved and encrypted. Run a test from the Integrations page to collect live evidence before treating the source as verified.`);
      await loadIntegrations();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Network error while saving credentials.');
    } finally {
      setSaving(null);
    }
  };

  const subscription = billing?.subscription ?? null;
  const activePlan = subscription?.plan ? billing?.plans.find((plan) => plan.id === subscription.plan) ?? null : null;
  const planReviewed = Boolean(subscription?.plan);

  const tasks = [
    {
      id: 'onboard-client',
      title: 'Add your first client',
      description: 'Create the client workspace that will own the software and scan records.',
      status: clientsCount > 0,
      actionLabel: 'Create Client',
      action: () => onOpenQuickAction('add-client'),
      completedText: `${clientsCount} client${clientsCount === 1 ? '' : 's'} added`
    },
    {
      id: 'register-passport',
      title: 'Register software',
      description: 'Create a Software Passport for an application you want to track.',
      status: passportsCount > 0,
      actionLabel: 'Create Passport',
      action: () => onOpenQuickAction('register-passport'),
      completedText: `${passportsCount} passport${passportsCount === 1 ? '' : 's'} created`
    },
    {
      id: 'run-scan',
      title: 'Run a software scan',
      description: 'Submit an SBOM or configured repository and follow the scan job status.',
      status: scansCount > 0,
      actionLabel: 'Run Scan',
      action: () => onOpenQuickAction('scan-sbom'),
      completedText: `${scansCount} scan${scansCount === 1 ? '' : 's'} recorded`
    },
    {
      id: 'configure-integrations',
      title: 'Connect a source repository',
      description: 'Add repository access before starting a repository scan.',
      status: githubConnected || gitlabConnected,
      actionLabel: 'Configure Sources',
      action: () => setActiveTab(activeTab === 'integrations' ? 'none' : 'integrations'),
      completedText: [githubConnected ? 'GitHub' : null, gitlabConnected ? 'GitLab' : null].filter(Boolean).join(' + ') + ' configured'
    },
    {
      id: 'verify-limits',
      title: 'Review your plan',
      description: 'Check the current usage limits before adding production workloads.',
      status: planReviewed,
      actionLabel: 'Manage Plan',
      action: () => setActiveTab(activeTab === 'billing' ? 'none' : 'billing'),
      completedText: `Active plan: ${activePlan?.label ?? subscription?.plan ?? 'recorded'}`
    }
  ];

  const completedCount = tasks.filter(t => t.status).length;
  const progressPercent = (completedCount / tasks.length) * 100;

  const statusBadge = (provider: RepoProvider) => {
    const status = statusOf(provider);
    const configured = status !== 'NOT_CONFIGURED';
    return (
      <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded ${configured ? 'bg-[var(--spr-green)]/15 text-[var(--spr-green)] border border-[var(--spr-green)]' : 'bg-[var(--spr-surface-alt)] text-[var(--spr-text-muted)]'}`}>
        {status.replace(/_/g, ' ')}
      </span>
    );
  };

  return (
    <div id="pilot-onboarding-hub" className="spr-panel text-[var(--spr-text)] p-6 space-y-6 relative overflow-hidden">
      {/* Header and Progress Indicator */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative">
        <div className="space-y-1.5 text-left">
          <div className="flex items-center gap-2">
            <span className="bg-[var(--spr-accent-soft)] text-[var(--spr-highlight)] border border-[var(--spr-highlight)] text-[12px] font-mono font-bold px-2 py-0.5 rounded-md uppercase tracking-wider">
              Getting started
            </span>
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--spr-green)] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--spr-green)]"></span>
            </span>
          </div>
          <h2 className="text-lg font-bold text-[var(--spr-text)] font-display flex items-center gap-2">
            <span>Set up SPR</span>
            <span className="text-xs font-normal text-[var(--spr-text-muted)]">Five practical steps</span>
          </h2>
          <p className="text-xs text-[var(--spr-text-muted)] leading-relaxed max-w-2xl">
            Add a client, register its software, run a scan, connect a repository, and review your plan. SPR marks each item complete from saved workspace data.
          </p>
        </div>

        {/* Progress Circle & Counter */}
        <div className="flex items-center gap-4 bg-[var(--spr-surface-alt)] border border-[var(--spr-border)] p-4 rounded-md shrink-0">
          <div className="relative w-12 h-12">
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
              <path
                className="text-[var(--spr-text-faint)]"
                strokeWidth="3.5"
                stroke="currentColor"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
              <path
                className="text-[var(--spr-highlight)] transition-all duration-500 stroke-dasharray"
                strokeDasharray={`${progressPercent}, 100`}
                strokeWidth="3.5"
                strokeLinecap="round"
                stroke="currentColor"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center text-xs font-bold font-mono">
              {completedCount}/{tasks.length}
            </div>
          </div>
          <div className="text-left space-y-0.5">
            <span className="text-[12px] font-mono text-[var(--spr-text-muted)] block uppercase">Setup status</span>
            <span className={`text-xs font-bold ${completedCount === tasks.length ? 'text-[var(--spr-green)]' : 'text-[var(--spr-highlight)]'}`}>
              {completedCount === tasks.length ? 'All steps complete' : `${tasks.length - completedCount} step${tasks.length - completedCount === 1 ? '' : 's'} remaining`}
            </span>
          </div>
        </div>
      </div>

      {/* Success and Error Indicators */}
      {successMsg && (
        <div className="bg-[var(--spr-green)]/15 border border-[var(--spr-green)] text-[var(--spr-green)] p-4 rounded-md text-xs flex items-center gap-2 animate-fadeIn text-left">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div role="alert" className="bg-[var(--spr-red)]/15 border border-[var(--spr-red)] text-[var(--spr-red)] p-4 rounded-md text-xs flex items-center gap-2 animate-fadeIn text-left">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Grid of Tasks */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {tasks.map((task, idx) => (
          <div
            key={task.id}
            className={`p-4 rounded-md border transition-all flex flex-col justify-between space-y-4 ${
              task.status
                ? 'bg-[var(--spr-surface-alt)] border-[var(--spr-green)]'
                : 'bg-[var(--spr-surface-alt)] border-[var(--spr-border)] hover:border-[var(--spr-border)]'
            }`}
          >
            <div className="space-y-2 text-left">
              <div className="flex justify-between items-center">
                <span className="text-[11px] font-mono font-bold text-[var(--spr-highlight)]">STEP 0{idx + 1}</span>
                {task.status ? (
                  <span className="p-0.5 bg-[var(--spr-green)]/15 text-[var(--spr-green)] rounded-md border border-[var(--spr-green)]">
                    <CheckSquare className="w-4 h-4" />
                  </span>
                ) : (
                  <span className="text-[var(--spr-text-muted)]">
                    <Square className="w-4 h-4" />
                  </span>
                )}
              </div>
              <h4 className="text-xs font-bold font-sans text-[var(--spr-text)] line-clamp-1">{task.title}</h4>
              <p className="text-[12px] text-[var(--spr-text-muted)] leading-normal line-clamp-3">{task.description}</p>
            </div>

            <div>
              {task.status ? (
                <div className="text-[12px] font-mono text-[var(--spr-green)] font-semibold flex items-center gap-1 bg-[var(--spr-green)]/15 px-2.5 py-1.5 rounded-md border border-[var(--spr-green)]">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span className="truncate">{task.completedText}</span>
                </div>
              ) : (
                <button
                  onClick={task.action}
                  className="spr-btn spr-btn-primary w-full !py-1.5 !text-[12px] flex items-center justify-center gap-1"
                >
                  <span>{task.actionLabel}</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Expanded configuration area */}
      {(activeTab === 'integrations' || activeTab === 'billing') && (
        <div className="border-t border-[var(--spr-border)] pt-6 animate-fadeIn">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xs font-mono font-bold text-[var(--spr-highlight)] uppercase tracking-widest flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[var(--spr-highlight)]" />
              <span>{activeTab === 'integrations' ? 'Source repository access' : 'Plan and usage'}</span>
            </h3>
            <div className="flex items-center gap-4">
              <button
                onClick={() => onNavigateTab(activeTab === 'integrations' ? '/integrations' : '/billing')}
                className="text-[12px] font-mono text-[var(--spr-highlight)] hover:underline"
              >
                {activeTab === 'integrations' ? 'View full Integrations page →' : 'View full Billing page →'}
              </button>
              <button
                onClick={() => setActiveTab('none')}
                className="text-[12px] font-mono text-[var(--spr-text-muted)] hover:text-[var(--spr-text)] underline"
              >
                Close
              </button>
            </div>
          </div>

          {/* Integrations: GitHub + GitLab, through the real credential vault */}
          {activeTab === 'integrations' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-left">
              <div className="bg-[var(--spr-surface-alt)] border border-[var(--spr-border)] p-5 rounded-md space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Github className="w-4 h-4 text-[var(--spr-highlight)]" />
                    <span className="text-xs font-bold text-[var(--spr-text)] font-sans">GitHub</span>
                  </div>
                  {statusBadge('github')}
                </div>
                <p className="text-[12px] text-[var(--spr-text-muted)] leading-normal">
                  A personal access token with read access to the repositories you want scanned. SPR uses it for immutable commit acquisition, SBOM generation and dependency evidence.
                </p>
                <div className="space-y-3 pt-2">
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-[11px] font-mono font-bold text-[var(--spr-text-muted)] uppercase">TOKEN</span>
                    <input
                      type="password"
                      autoComplete="off"
                      value={githubToken}
                      onChange={(e) => setGithubToken(e.target.value)}
                      placeholder="ghp_..."
                      className="w-full bg-[var(--spr-surface)] border border-[var(--spr-border)] rounded-md text-xs pl-16 pr-3 py-2 text-[var(--spr-text)] font-mono focus:outline-none"
                    />
                  </div>
                  <button
                    onClick={() => void handleSaveCredentials('github')}
                    disabled={saving !== null || !githubToken.trim()}
                    className="w-full py-2 bg-[var(--spr-accent)] hover:bg-[var(--spr-accent)] text-[var(--spr-text)] font-sans font-bold text-[12px] rounded-md transition disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {saving === 'github' ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
                    <span>{githubConnected ? 'Replace GitHub token' : 'Save GitHub token'}</span>
                  </button>
                </div>
              </div>

              <div className="bg-[var(--spr-surface-alt)] border border-[var(--spr-border)] p-5 rounded-md space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Gitlab className="w-4 h-4 text-[var(--spr-highlight)]" />
                    <span className="text-xs font-bold text-[var(--spr-text)] font-sans">GitLab</span>
                  </div>
                  {statusBadge('gitlab')}
                </div>
                <p className="text-[12px] text-[var(--spr-text-muted)] leading-normal">
                  A personal access token with read access to your projects. Leave the base URL empty for gitlab.com; set it only for a self-hosted instance.
                </p>
                <div className="space-y-3 pt-2">
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-[11px] font-mono font-bold text-[var(--spr-text-muted)] uppercase">TOKEN</span>
                    <input
                      type="password"
                      autoComplete="off"
                      value={gitlabToken}
                      onChange={(e) => setGitlabToken(e.target.value)}
                      placeholder="glpat-..."
                      className="w-full bg-[var(--spr-surface)] border border-[var(--spr-border)] rounded-md text-xs pl-16 pr-3 py-2 text-[var(--spr-text)] font-mono focus:outline-none"
                    />
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-[11px] font-mono font-bold text-[var(--spr-text-muted)] uppercase">URL</span>
                    <input
                      type="text"
                      value={gitlabBaseUrl}
                      onChange={(e) => setGitlabBaseUrl(e.target.value)}
                      placeholder="https://gitlab.com (optional)"
                      className="w-full bg-[var(--spr-surface)] border border-[var(--spr-border)] rounded-md text-xs pl-16 pr-3 py-2 text-[var(--spr-text)] font-mono focus:outline-none"
                    />
                  </div>
                  <button
                    onClick={() => void handleSaveCredentials('gitlab')}
                    disabled={saving !== null || !gitlabToken.trim()}
                    className="w-full py-2 bg-[var(--spr-accent-soft)] hover:bg-[var(--spr-accent)] text-[var(--spr-text)] font-sans font-bold text-[12px] rounded-md transition disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {saving === 'gitlab' ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Key className="w-3.5 h-3.5" />}
                    <span>{gitlabConnected ? 'Replace GitLab token' : 'Save GitLab token'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Billing: what the backend and Stripe actually say, nothing local */}
          {activeTab === 'billing' && (
            <div className="bg-[var(--spr-surface-alt)] border border-[var(--spr-border)] p-6 rounded-md space-y-5 text-left">
              {billingError && (
                <div role="alert" className="text-[12px] text-[var(--spr-red)] flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" /><span>{billingError}</span></div>
              )}
              {!billingError && !billing && (
                <p className="text-[12px] text-[var(--spr-text-muted)]">Loading billing status…</p>
              )}
              {billing && (
                <>
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <h3 className="text-sm font-bold text-[var(--spr-text)] flex items-center gap-2">
                        <span>Your plan</span>
                        <span className="bg-[var(--spr-accent-soft)] text-[var(--spr-highlight)] border border-[var(--spr-highlight)] text-[11px] font-mono px-2 py-0.5 rounded">
                          {activePlan?.label ?? subscription?.plan ?? 'No plan recorded'}
                        </span>
                        {subscription?.status && <span className="text-[11px] font-mono text-[var(--spr-text-muted)] uppercase">{subscription.status}</span>}
                      </h3>
                      <p className="text-[11px] text-[var(--spr-text-muted)]">
                        {subscription?.plan
                          ? `Client limit ${subscription.clientLimit ?? 'unlimited'} · ${billing.clientCount} in use${subscription.currentPeriodEnd ? ` · renews ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}` : ''}`
                          : 'This workspace has no subscription on record yet. Choose a plan on the Billing page to start checkout.'}
                      </p>
                    </div>
                    <button onClick={() => onNavigateTab('/billing')} className="spr-btn spr-btn-primary !py-2 !text-[12px]">
                      {subscription?.plan ? 'Manage billing' : 'Choose a plan'}
                    </button>
                  </div>

                  {!billing.billingConfigured && (
                    <p className="text-[12px] text-[var(--spr-text-muted)]">Billing is not configured on this deployment, so checkout is unavailable.</p>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                    {billing.plans.map((plan) => (
                      <div key={plan.id} className={`p-3 rounded-md border ${plan.id === subscription?.plan ? 'border-[var(--spr-highlight)]' : 'border-[var(--spr-border)]'} bg-[var(--spr-surface)] space-y-1`}>
                        <p className="text-xs font-bold text-[var(--spr-text)]">{plan.label}</p>
                        <p className="text-[12px] font-mono text-[var(--spr-text-muted)]">{plan.priceLabel ?? (plan.id === 'enterprise' ? 'Custom pricing' : 'Not available for checkout')}</p>
                        <p className="text-[11px] text-[var(--spr-text-muted)]">{plan.clientLimit === null ? 'Unlimited clients' : `Up to ${plan.clientLimit} client${plan.clientLimit === 1 ? '' : 's'}`}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-[var(--spr-text-muted)]">Prices are read from Stripe, the system that charges them. Plan changes happen through checkout or the billing portal on the Billing page — nothing here changes your plan directly.</p>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
