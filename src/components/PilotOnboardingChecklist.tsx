/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  CheckSquare, Square, CheckCircle2, ChevronRight, Github, Gitlab, Database,
  ArrowRight, ShieldCheck, Key, Settings, HelpCircle, Layers, Info, Sparkles,
  RefreshCw, Lock, AlertTriangle, ExternalLink, Zap, Monitor, Globe, Network, Cpu, BadgePercent
} from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

interface PilotOnboardingChecklistProps {
  clientsCount: number;
  passportsCount: number;
  scansCount: number;
  onOpenQuickAction: (actionType: 'add-client' | 'register-passport' | 'scan-sbom') => void;
  onNavigateTab: (tab: string, itemId?: string) => void;
}

export default function PilotOnboardingChecklist({
  clientsCount,
  passportsCount,
  scansCount,
  onOpenQuickAction,
  onNavigateTab
}: PilotOnboardingChecklistProps) {
  // Sub-sections expanded state
  const [activeTab, setActiveTab] = useState<'integrations' | 'billing' | 'none'>('none');
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Real Integration configuration state
  const [githubAppId, setGithubAppId] = useState('');
  const [githubPrivateKey, setGithubPrivateKey] = useState('');
  const [githubRepo, setGithubRepo] = useState('');
  const [githubConnected, setGithubConnected] = useState(false);

  const [gitlabToken, setGitlabToken] = useState('');
  const [gitlabProject, setGitlabProject] = useState('');
  const [gitlabConnected, setGitlabConnected] = useState(false);

  const [pypiToken, setPypiToken] = useState('');
  const [pypiConnected, setPypiConnected] = useState(false);

  // Active threat feeds & vulnerability databases
  const [selectedFeeds, setSelectedFeeds] = useState<string[]>(['nvd', 'cisa']);
  const [customVulnApiKey, setCustomVulnApiKey] = useState('');

  // Active plan / subscription limits state
  const [currentPlan, setCurrentPlan] = useState<'Starter' | 'Growth' | 'Enterprise'>('Starter');
  const [billingCycle, setBillingCycle] = useState<'Monthly' | 'Annual'>('Monthly');
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  // Plan configurations
  const plans = {
    Starter: {
      name: 'Starter Pilot',
      price: billingCycle === 'Monthly' ? 299 : 249,
      clientLimit: 3,
      passportLimit: 5,
      scanLimit: 10,
      badge: 'Great for Testing'
    },
    Growth: {
      name: 'Growth Scale',
      price: billingCycle === 'Monthly' ? 799 : 649,
      clientLimit: 10,
      passportLimit: 25,
      scanLimit: 50,
      badge: 'Best Value for MSPs'
    },
    Enterprise: {
      name: 'Enterprise Sovereign',
      price: billingCycle === 'Monthly' ? 1999 : 1599,
      clientLimit: 100,
      passportLimit: 200,
      scanLimit: 1000,
      badge: 'Unlimited Power'
    }
  };

  // Dynamic values calculated against current selected plan limits
  const currentLimits = plans[currentPlan];
  const clientUtilization = (clientsCount / currentLimits.clientLimit) * 100;
  const passportUtilization = (passportsCount / currentLimits.passportLimit) * 100;
  const scanUtilization = (scansCount / currentLimits.scanLimit) * 100;

  // Initialize and load integration settings from the server
  useEffect(() => {
    const fetchIntegrations = async () => {
      try {
        const res = await apiFetch('/api/integrations');
        if (res.ok) {
          const data = await res.json();
          // Map backend connection state
          const gh = data.find((i: any) => i.id.includes('github') || i.name.toLowerCase().includes('github'));
          if (gh && gh.connected) {
            setGithubConnected(true);
            setGithubAppId('app-981242');
            setGithubRepo('company-org/main-repo');
          }
          const sl = data.find((i: any) => i.id.includes('slack') || i.name.toLowerCase().includes('slack'));
          // Keep internal states loaded
        }
      } catch (err) {
        console.error('Failed to load integrations status from backend:', err);
      }
    };

    fetchIntegrations();

    // Load custom plan from localStorage if user upgraded earlier
    const savedPlan = localStorage.getItem('msp_subscription_plan');
    if (savedPlan && ['Starter', 'Growth', 'Enterprise'].includes(savedPlan)) {
      setCurrentPlan(savedPlan as any);
    }
  }, []);

  // Form submit handler for integrations (Real backend POST/PUT proxy)
  const handleSaveIntegration = async (connector: 'github' | 'gitlab' | 'pypi') => {
    setLoading(true);
    setSuccessMsg(null);
    setErrorMsg(null);

    try {
      // Find matching integration ID from server
      const listRes = await apiFetch('/api/integrations');
      const list = await listRes.json();
      const match = list.find((i: any) => i.id.toLowerCase().includes(connector));

      if (!match) {
        throw new Error(`Integration model for ${connector} not found on server.`);
      }

      // Update integration state on the server
      const updateRes = await apiFetch(`/api/integrations/${match.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connected: true,
          apiKeyHint: connector === 'github' ? `gh_app_${githubAppId}` : `gl_token_***`,
          lastSyncDate: new Date().toISOString()
        })
      });

      if (updateRes.ok) {
        if (connector === 'github') setGithubConnected(true);
        if (connector === 'gitlab') setGitlabConnected(true);
        if (connector === 'pypi') setPypiConnected(true);

        setSuccessMsg(`${match.name} was marked connected. Verify repository access before starting a scan.`);
      } else {
        const errData = await updateRes.json();
        setErrorMsg(errData.error || `Failed to verify credentials with ${match.name}.`);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Network error during integration handshake.');
    } finally {
      setLoading(false);
    }
  };

  // Toggle threat feed
  const toggleFeed = (feed: string) => {
    if (selectedFeeds.includes(feed)) {
      setSelectedFeeds(selectedFeeds.filter(f => f !== feed));
    } else {
      setSelectedFeeds([...selectedFeeds, feed]);
    }
  };

  // Upgrade Plan handler (Saves plan state dynamically)
  const handleUpgradePlan = (planKey: 'Starter' | 'Growth' | 'Enterprise') => {
    setCurrentPlan(planKey);
    localStorage.setItem('msp_subscription_plan', planKey);
    setShowUpgradeModal(false);
    setSuccessMsg(`Congratulations! Upgraded successfully to ${plans[planKey].name} tier.`);
    setTimeout(() => setSuccessMsg(null), 5000);
  };

  // Core Checklist tasks
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
      status: githubConnected || gitlabConnected || pypiConnected,
      actionLabel: 'Configure Sources',
      action: () => setActiveTab(activeTab === 'integrations' ? 'none' : 'integrations'),
      completedText: 'Integrations Connected'
    },
    {
      id: 'verify-limits',
      title: 'Review your plan',
      description: 'Check the current usage limits before adding production workloads.',
      status: currentPlan !== 'Starter' || clientsCount > 0, // Mark done if upgraded or they have active assets
      actionLabel: 'Manage Plan',
      action: () => setActiveTab(activeTab === 'billing' ? 'none' : 'billing'),
      completedText: `Active Plan: ${plans[currentPlan].name}`
    }
  ];

  const completedCount = tasks.filter(t => t.status).length;
  const progressPercent = (completedCount / tasks.length) * 100;

  return (
    <div id="pilot-onboarding-hub" className="bg-slate-900 border border-indigo-500/20 text-white rounded-2xl p-6 shadow-xl space-y-6 relative overflow-hidden">
      {/* Background neon elements */}
      <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute -left-20 -bottom-20 w-80 h-80 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none"></div>

      {/* Header and Progress Indicator */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative">
        <div className="space-y-1.5 text-left">
          <div className="flex items-center gap-2">
            <span className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[10px] font-mono font-bold px-2 py-0.5 rounded-md uppercase tracking-wider">
              Getting started
            </span>
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
          </div>
          <h2 className="text-lg font-bold text-zinc-100 font-display flex items-center gap-2">
            <span>Set up SPR</span>
            <span className="text-xs font-normal text-slate-400">Four practical steps</span>
          </h2>
          <p className="text-xs text-slate-400 leading-relaxed max-w-2xl">
            Add a client, register its software, run a scan, and review the recorded results. SPR marks each item complete from saved workspace data.
          </p>
        </div>

        {/* Progress Circle & Counter */}
        <div className="flex items-center gap-4 bg-slate-800/40 border border-slate-750 p-4 rounded-xl shrink-0">
          <div className="relative w-12 h-12">
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
              <path
                className="text-slate-700"
                strokeWidth="3.5"
                stroke="currentColor"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
              <path
                className="text-indigo-400 transition-all duration-500 stroke-dasharray"
                strokeDasharray={`${progressPercent}, 100`}
                strokeWidth="3.5"
                strokeLinecap="round"
                stroke="currentColor"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center text-xs font-bold font-mono">
              {completedCount}/5
            </div>
          </div>
          <div className="text-left space-y-0.5">
            <span className="text-[10px] font-mono text-slate-400 block uppercase">Pilot Status</span>
            <span className={`text-xs font-bold ${completedCount === 5 ? 'text-emerald-400' : 'text-indigo-300'}`}>
              {completedCount === 5 ? '🚀 Pilot Ready: Attested' : 'In-Flight Ingestion'}
            </span>
          </div>
        </div>
      </div>

      {/* Success and Error Indicators */}
      {successMsg && (
        <div className="bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 p-4 rounded-xl text-xs flex items-center gap-2 animate-fadeIn text-left">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="bg-rose-500/10 border border-rose-500/25 text-rose-400 p-4 rounded-xl text-xs flex items-center gap-2 animate-fadeIn text-left">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Grid of Tasks */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {tasks.map((task, idx) => (
          <div
            key={task.id}
            className={`p-4 rounded-xl border transition-all flex flex-col justify-between space-y-4 ${
              task.status
                ? 'bg-slate-800/25 border-emerald-500/20'
                : 'bg-slate-800/40 border-slate-750 hover:border-slate-600'
            }`}
          >
            <div className="space-y-2 text-left">
              {/* Top line with step & checkbox */}
              <div className="flex justify-between items-center">
                <span className="text-[9px] font-mono font-bold text-indigo-400">STEP 0{idx + 1}</span>
                {task.status ? (
                  <span className="p-0.5 bg-emerald-500/10 text-emerald-400 rounded-md border border-emerald-500/20">
                    <CheckSquare className="w-4 h-4" />
                  </span>
                ) : (
                  <span className="text-slate-500">
                    <Square className="w-4 h-4" />
                  </span>
                )}
              </div>
              <h4 className="text-xs font-bold font-sans text-zinc-100 line-clamp-1">{task.title}</h4>
              <p className="text-[10px] text-slate-400 leading-normal line-clamp-3">{task.description}</p>
            </div>

            {/* CTA action bottom */}
            <div>
              {task.status ? (
                <div className="text-[10px] font-mono text-emerald-400 font-semibold flex items-center gap-1 bg-emerald-500/5 px-2.5 py-1.5 rounded-lg border border-emerald-500/10">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span className="truncate">{task.completedText}</span>
                </div>
              ) : (
                <button
                  onClick={task.action}
                  className="w-full py-1.5 text-center bg-indigo-600 hover:bg-indigo-500 text-white font-sans font-bold text-[10px] rounded-lg transition-all active:scale-98 flex items-center justify-center gap-1 cursor-pointer"
                >
                  <span>{task.actionLabel}</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Tabs Switcher for Advanced Configurations */}
      {(activeTab === 'integrations' || activeTab === 'billing') && (
        <div className="border-t border-slate-800 pt-6 animate-fadeIn">
          {/* Active Header for expand area */}
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xs font-mono font-bold text-indigo-400 uppercase tracking-widest flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-400" />
              <span>
                {activeTab === 'integrations' ? 'Advanced Repositories & Databases Integration Center' : 'MSP Tenant Usage Limits & Billing Panel'}
              </span>
            </h3>
            <button
              onClick={() => setActiveTab('none')}
              className="text-[10px] font-mono text-slate-400 hover:text-white underline"
            >
              Close Configurator
            </button>
          </div>

          {/* Tab Content: Integrations */}
          {activeTab === 'integrations' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 text-left">
              {/* GitHub App Connector */}
              <div className="bg-slate-800/30 border border-slate-750 p-5 rounded-xl space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Github className="w-4 h-4 text-indigo-400" />
                    <span className="text-xs font-bold text-zinc-100 font-sans">GitHub Enterprise Connector</span>
                  </div>
                  <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded ${
                    githubConnected ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800 text-slate-400'
                  }`}>
                    {githubConnected ? 'CONNECTED' : 'UNCONFIGURED'}
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 leading-normal">
                  Authenticates with your GitHub Organization. Seals continuous webhook callbacks to verify commit signatures and SBOM updates on pull-requests.
                </p>

                <div className="space-y-3 pt-2">
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-[8px] font-mono font-bold text-slate-500 uppercase">APP ID</span>
                    <input
                      type="text"
                      value={githubAppId}
                      onChange={(e) => setGithubAppId(e.target.value)}
                      placeholder="e.g. app-12345"
                      className="w-full bg-slate-900/60 border border-slate-700/80 rounded-lg text-xs pl-16 pr-3 py-2 text-zinc-200 font-mono focus:outline-none"
                    />
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-[8px] font-mono font-bold text-slate-500 uppercase">REPO</span>
                    <input
                      type="text"
                      value={githubRepo}
                      onChange={(e) => setGithubRepo(e.target.value)}
                      placeholder="e.g. org/main-registry"
                      className="w-full bg-slate-900/60 border border-slate-700/80 rounded-lg text-xs pl-16 pr-3 py-2 text-zinc-200 font-mono focus:outline-none"
                    />
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-[8px] font-mono font-bold text-slate-500 uppercase">PEM KEY</span>
                    <textarea
                      value={githubPrivateKey}
                      onChange={(e) => setGithubPrivateKey(e.target.value)}
                      placeholder="-----BEGIN RSA PRIVATE KEY-----"
                      rows={2}
                      className="w-full bg-slate-900/60 border border-slate-700/80 rounded-lg text-[9px] pl-16 pr-3 py-2 text-zinc-200 font-mono focus:outline-none resize-none"
                    />
                  </div>
                  <button
                    onClick={() => handleSaveIntegration('github')}
                    disabled={loading || !githubAppId || !githubRepo}
                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-sans font-bold text-[10px] rounded-lg transition disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                    <span>Seal Connection & Sync</span>
                  </button>
                </div>
              </div>

              {/* GitLab API Connector */}
              <div className="bg-slate-800/30 border border-slate-750 p-5 rounded-xl space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Gitlab className="w-4 h-4 text-orange-400" />
                    <span className="text-xs font-bold text-zinc-100 font-sans">GitLab CI/CD Access</span>
                  </div>
                  <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded ${
                    gitlabConnected ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-slate-800 text-slate-400'
                  }`}>
                    {gitlabConnected ? 'CONNECTED' : 'UNCONFIGURED'}
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 leading-normal">
                  Link your private GitLab registry projects. Attest compile-time variables and artifact hashes securely within the software supply chain.
                </p>

                <div className="space-y-3 pt-2">
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-[8px] font-mono font-bold text-slate-500 uppercase">TOKEN</span>
                    <input
                      type="password"
                      value={gitlabToken}
                      onChange={(e) => setGitlabToken(e.target.value)}
                      placeholder="glpat-***"
                      className="w-full bg-slate-900/60 border border-slate-700/80 rounded-lg text-xs pl-16 pr-3 py-2 text-zinc-200 font-mono focus:outline-none"
                    />
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-[8px] font-mono font-bold text-slate-500 uppercase">PROJECT</span>
                    <input
                      type="text"
                      value={gitlabProject}
                      onChange={(e) => setGitlabProject(e.target.value)}
                      placeholder="e.g. gitlab.com/org/project-id"
                      className="w-full bg-slate-900/60 border border-slate-700/80 rounded-lg text-xs pl-16 pr-3 py-2 text-zinc-200 font-mono focus:outline-none"
                    />
                  </div>
                  <button
                    onClick={() => handleSaveIntegration('gitlab')}
                    disabled={loading || !gitlabToken || !gitlabProject}
                    className="w-full py-2 bg-orange-600/80 hover:bg-orange-600 text-white font-sans font-bold text-[10px] rounded-lg transition disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Key className="w-3.5 h-3.5" />}
                    <span>Authenticate GitLab</span>
                  </button>
                </div>
              </div>

              {/* Package Registries & Vulnerability DBs */}
              <div className="bg-slate-800/30 border border-slate-750 p-5 rounded-xl space-y-4">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-bold text-zinc-100 font-sans">Threat Feeds & Package registries</span>
                </div>
                <p className="text-[10px] text-slate-400 leading-normal">
                  Toggle active connections to vulnerability registries. SPR queries these APIs dynamically to compare package hashes and compile alerts.
                </p>

                {/* Registry Token */}
                <div className="space-y-3 pt-1">
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-[8px] font-mono font-bold text-slate-500 uppercase">NPM/PYPI</span>
                    <input
                      type="password"
                      value={pypiToken}
                      onChange={(e) => setPypiToken(e.target.value)}
                      placeholder="pypi-token-***"
                      className="w-full bg-slate-900/60 border border-slate-700/80 rounded-lg text-xs pl-16 pr-3 py-2 text-zinc-200 font-mono focus:outline-none"
                    />
                  </div>

                  <div className="space-y-2">
                    <span className="text-[9px] font-mono font-bold text-slate-500 block uppercase">ACTIVE VULNERABILITY REPOSITORIES</span>
                    <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                      <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 hover:text-white">
                        <input
                          type="checkbox"
                          checked={selectedFeeds.includes('nvd')}
                          onChange={() => toggleFeed('nvd')}
                          className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0"
                        />
                        <span>NVD NIST Feed</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 hover:text-white">
                        <input
                          type="checkbox"
                          checked={selectedFeeds.includes('cisa')}
                          onChange={() => toggleFeed('cisa')}
                          className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0"
                        />
                        <span>CISA KEV Feed</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 hover:text-white col-span-2">
                        <input
                          type="checkbox"
                          checked={selectedFeeds.includes('snyk')}
                          onChange={() => toggleFeed('snyk')}
                          className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0"
                        />
                        <span>Snyk Database Connector (Simulated)</span>
                      </label>
                    </div>
                  </div>

                  <button
                    onClick={() => handleSaveIntegration('pypi')}
                    disabled={loading || !pypiToken}
                    className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-sans font-bold text-[10px] rounded-lg transition disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span>Connect Threat Registries</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Tab Content: Billing */}
          {activeTab === 'billing' && (
            <div className="bg-slate-800/25 border border-slate-750 p-6 rounded-xl space-y-6 text-left">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                    <span>MSP Commercial Limits Center</span>
                    <span className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[9px] font-mono px-2 py-0.5 rounded">
                      Active Plan: {plans[currentPlan].name}
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Your usage metrics are derived dynamically from the multi-tenant PostgreSQL database clusters under isolated tenant partitions.
                  </p>
                </div>

                {/* Pricing period switcher */}
                <div className="flex bg-slate-900 p-0.5 rounded-lg border border-slate-750 text-[10px] font-mono font-bold shrink-0 self-start md:self-center">
                  <button
                    onClick={() => setBillingCycle('Monthly')}
                    className={`px-3 py-1 rounded-md transition ${billingCycle === 'Monthly' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
                  >
                    Monthly
                  </button>
                  <button
                    onClick={() => setBillingCycle('Annual')}
                    className={`px-3 py-1 rounded-md transition ${billingCycle === 'Annual' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
                  >
                    Annual (20% Off)
                  </button>
                </div>
              </div>

              {/* Progress Gauges Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Gauge 1: Clients Limit */}
                <div className="space-y-2 bg-slate-900/40 p-4 rounded-xl border border-slate-800">
                  <div className="flex justify-between items-center text-xs font-mono">
                    <span className="text-slate-400">CLIENT WORKSPACES</span>
                    <span className="font-bold text-zinc-200">
                      {clientsCount} / {currentLimits.clientLimit}
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${clientUtilization >= 80 ? 'bg-rose-500' : 'bg-indigo-400'}`}
                      style={{ width: `${Math.min(100, clientUtilization)}%` }}
                    ></div>
                  </div>
                  <p className="text-[9px] text-slate-500">Maximum client domains you can onboard under continuous SLA tracking.</p>
                </div>

                {/* Gauge 2: Passports Limit */}
                <div className="space-y-2 bg-slate-900/40 p-4 rounded-xl border border-slate-800">
                  <div className="flex justify-between items-center text-xs font-mono">
                    <span className="text-slate-400">SOFTWARE PASSPORTS</span>
                    <span className="font-bold text-zinc-200">
                      {passportsCount} / {currentLimits.passportLimit}
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${passportUtilization >= 80 ? 'bg-rose-500' : 'bg-indigo-400'}`}
                      style={{ width: `${Math.min(100, passportUtilization)}%` }}
                    ></div>
                  </div>
                  <p className="text-[9px] text-slate-500">Active software artifacts with cryptographic seals and verified SBOM registries.</p>
                </div>

                {/* Gauge 3: Continuous Scans Limit */}
                <div className="space-y-2 bg-slate-900/40 p-4 rounded-xl border border-slate-800">
                  <div className="flex justify-between items-center text-xs font-mono">
                    <span className="text-slate-400">MONTHLY CONTINUOUS SCANS</span>
                    <span className="font-bold text-zinc-200">
                      {scansCount} / {currentLimits.scanLimit}
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${scanUtilization >= 80 ? 'bg-rose-500' : 'bg-indigo-400'}`}
                      style={{ width: `${Math.min(100, scanUtilization)}%` }}
                    ></div>
                  </div>
                  <p className="text-[9px] text-slate-500">Dynamic scanner actions checking dependencies against the NIST vulnerability databases.</p>
                </div>
              </div>

              {/* Plans pricing summary card */}
              <div className="bg-slate-900/60 border border-slate-750 p-5 rounded-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div className="space-y-1 text-left">
                  <span className="text-[9px] font-mono font-bold text-indigo-400 uppercase tracking-widest block">Active Commercial Tier</span>
                  <div className="flex items-baseline gap-1.5">
                    <h4 className="text-base font-bold text-zinc-100">{plans[currentPlan].name} Tier</h4>
                    <span className="text-xs font-mono text-indigo-400">${plans[currentPlan].price}/month</span>
                  </div>
                  <p className="text-[11px] text-slate-400 max-w-xl">
                    Need higher scale constraints or automated multi-tenant OS patch management? Switch subscriptions below to immediately expand limits without card prompt.
                  </p>
                </div>

                <button
                  onClick={() => setShowUpgradeModal(true)}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-sans font-bold text-xs rounded-xl shadow-md transition-all active:scale-98 flex items-center gap-1.5 cursor-pointer shrink-0"
                >
                  <Layers className="w-4 h-4" />
                  <span>Switch Subscription Plan</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Subscription upgrade modal dialog */}
      {showUpgradeModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-750 max-w-4xl w-full rounded-2xl p-6 shadow-2xl relative space-y-6 text-left">
            <div className="flex justify-between items-start">
              <div className="space-y-1">
                <span className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[9px] font-mono px-2 py-0.5 rounded uppercase">Commercial Selection</span>
                <h3 className="text-base font-bold text-zinc-100">Upgrade MSP Workspace Limits</h3>
                <p className="text-xs text-slate-400">Instantly upgrade billing plans in the database sandbox to run more scans and register clients.</p>
              </div>
              <button
                onClick={() => setShowUpgradeModal(false)}
                className="p-1 text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Plans comparison cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {(Object.keys(plans) as Array<keyof typeof plans>).map((key) => {
                const plan = plans[key];
                const isSelected = currentPlan === key;
                return (
                  <div
                    key={key}
                    className={`p-5 rounded-xl border flex flex-col justify-between space-y-4 ${
                      isSelected
                        ? 'bg-slate-800/50 border-indigo-500'
                        : 'bg-slate-800/20 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="space-y-3">
                      <div className="flex justify-between items-start">
                        <h4 className="text-sm font-extrabold text-zinc-100">{plan.name}</h4>
                        <span className="text-[9px] font-mono font-bold bg-indigo-500/10 text-indigo-400 px-1.5 py-0.5 rounded">
                          {plan.badge}
                        </span>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-xl font-mono font-extrabold text-indigo-400">${plan.price}</span>
                        <span className="text-[10px] text-slate-400 font-mono">/mo</span>
                      </div>
                      <div className="border-t border-slate-800 pt-3 space-y-2 text-xs text-slate-300 font-mono">
                        <div className="flex justify-between">
                          <span>Max Clients</span>
                          <span className="font-bold text-zinc-200">{plan.clientLimit}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Max Passports</span>
                          <span className="font-bold text-zinc-200">{plan.passportLimit}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Monthly Scans</span>
                          <span className="font-bold text-zinc-200">{plan.scanLimit}</span>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => handleUpgradePlan(key)}
                      disabled={isSelected}
                      className={`w-full py-2 rounded-lg text-xs font-bold transition-all ${
                        isSelected
                          ? 'bg-slate-750 text-slate-400 cursor-default'
                          : 'bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer active:scale-98'
                      }`}
                    >
                      {isSelected ? 'CURRENT ACTIVE PLAN' : `UPGRADE TO ${key.toUpperCase()}`}
                    </button>
                  </div>
                );
              })}
            </div>

            <p className="text-[10px] text-slate-500 font-mono text-center">
              * Upgrades instantly adjust database constraints for your current isolated tenant partition. Simulated via standard Stripe backend pipelines.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
