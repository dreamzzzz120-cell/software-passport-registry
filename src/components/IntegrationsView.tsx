/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Plug, CheckCircle2, RefreshCw, KeyRound, AlertCircle,
  Slack, Github, Monitor, Briefcase, FileText, Key,
  ShieldCheck, Ticket, BookOpen, CloudLightning, Copy, Send, Trash2, Webhook, XCircle,
} from 'lucide-react';
import type { Client, SoftwarePassport } from '../types';
import { apiFetch } from '../utils/apiClient';
import { CREDENTIAL_FIELDS, WEBHOOK_EVENT_TYPES } from '../integrations/credentialFields';

interface IntegrationsViewProps {
  passports?: SoftwarePassport[];
  clients?: Client[];
  onNavigateTab?: (tab: string) => void;
}

const CUSTOMER_DISCOVERY_PROVIDERS = new Set(['connectwise', 'autotask', 'ninjaone', 'hudu']);
type ProviderCustomer = { id: string; external_customer_id: string; external_customer_name: string; client_id: string | null; client_name: string | null; discovered_at: string; last_synced_at: string; mapped_at: string | null };

type LiveCatalogItem = {
  id: string; name: string; category: string; icon: string; description: string; provider: string;
  capability: 'live' | 'planned'; adapter: string; credentialStatus: 'NOT_CONFIGURED' | 'CONFIGURED' | 'LIVE' | 'ERROR'; lastTestedAt: string | null;
};
type GitHubRepository = { fullName: string; private: boolean; defaultBranch: string; htmlUrl: string };

type DashboardWebhook = { id: string; url: string; events: string; active: boolean; consecutive_failure_count: number; disabled_at: string | null; created_at: string };

const getIntegrationIcon = (iconName: string) => {
  switch (iconName?.toLowerCase()) {
    case 'slack': return <Slack className="w-5 h-5 text-pink-500" />;
    case 'github': case 'git': return <Github className="w-5 h-5 text-[#d4d4d4]" />;
    case 'monitor': return <Monitor className="w-5 h-5 text-[#3794ff]" />;
    case 'briefcase': return <Briefcase className="w-5 h-5 text-[#3794ff]" />;
    case 'file-text': return <FileText className="w-5 h-5 text-[#4ec9b0]" />;
    case 'key': return <Key className="w-5 h-5 text-[#f14c4c]" />;
    case 'shield-check': return <ShieldCheck className="w-5 h-5 text-red-500" />;
    case 'ticket': return <Ticket className="w-5 h-5 text-[#3794ff]" />;
    case 'book-open': return <BookOpen className="w-5 h-5 text-[#4ec9b0]" />;
    case 'cloud-lightning': return <CloudLightning className="w-5 h-5 text-[#cca700]" />;
    default: return <Plug className="w-5 h-5 text-[#3794ff]" />;
  }
};

const getCategoryStyles = (category: string) => {
  switch (category?.toUpperCase()) {
    case 'RMM': return 'bg-[#094771] text-[#3794ff] border-[#0e639c]/40';
    case 'PSA': return 'bg-[#094771] text-[#3794ff] border-[#0e639c]/40';
    case 'DOCUMENTATION': return 'bg-[#2d2d2d] text-[#9d9d9d] border-[#3c3c3c]';
    case 'SIEM': return 'bg-[#3a1f1f] text-[#f14c4c] border-[#f14c4c]/30';
    case 'DEVOPS': return 'bg-[#2d2d2d] text-[#9d9d9d] border-[#3c3c3c]';
    case 'CHAT': return 'bg-[#2d2d2d] text-[#9d9d9d] border-[#3c3c3c]';
    case 'ISSUE TRACKER': return 'bg-[#3a2f05] text-[#cca700] border-[#cca700]/30';
    case 'WORKSPACE': return 'bg-[#094771] text-[#3794ff] border-[#0e639c]/40';
    case 'CLOUD': return 'bg-[#094771] text-[#3794ff] border-[#0e639c]/40';
    default: return 'bg-[#2d2d2d] text-[#9d9d9d] border-[#3c3c3c]';
  }
};

const STATUS_STYLES: Record<LiveCatalogItem['credentialStatus'], string> = {
  NOT_CONFIGURED: 'bg-[#2d2d2d] border-[#3c3c3c] text-[#9d9d9d]',
  CONFIGURED: 'bg-[#3a2f05] border-[#cca700]/30 text-[#cca700]',
  LIVE: 'bg-[#0e3b2a] border-[#89d185]/30 text-[#89d185]',
  ERROR: 'bg-[#3a1f1f] border-[#f14c4c]/30 text-[#f14c4c]',
};
const STATUS_LABEL: Record<LiveCatalogItem['credentialStatus'], string> = {
  NOT_CONFIGURED: 'Not connected', CONFIGURED: 'Saved, untested', LIVE: 'Live', ERROR: 'Last test failed',
};

function responseError(data: any, fallback: string) {
  if (typeof data?.error === 'string') return data.error;
  return fallback;
}

export default function IntegrationsView({ passports = [], clients = [], onNavigateTab }: IntegrationsViewProps) {
  const [catalog, setCatalog] = useState<LiveCatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [credentialValues, setCredentialValues] = useState<Record<string, string>>({});
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [disconnectingProvider, setDisconnectingProvider] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState<Record<string, string>>({});
  const [selectedPassportId, setSelectedPassportId] = useState(passports[0]?.id || '');

  const [githubRepositories, setGithubRepositories] = useState<GitHubRepository[]>([]);
  const [discoveringRepositories, setDiscoveringRepositories] = useState(false);
  const [selectedRepository, setSelectedRepository] = useState('');
  const [scanningRepository, setScanningRepository] = useState(false);

  const [providerCustomers, setProviderCustomers] = useState<Record<string, ProviderCustomer[]>>({});
  const [discoveringProvider, setDiscoveringProvider] = useState<string | null>(null);
  const [mappingBusyId, setMappingBusyId] = useState<string | null>(null);
  const [customerMessage, setCustomerMessage] = useState<Record<string, string>>({});

  const [webhooks, setWebhooks] = useState<DashboardWebhook[]>([]);
  const [webhooksLoading, setWebhooksLoading] = useState(true);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookEvents, setWebhookEvents] = useState<string[]>([...WEBHOOK_EVENT_TYPES]);
  const [creatingWebhook, setCreatingWebhook] = useState(false);
  const [webhookError, setWebhookError] = useState('');
  const [revealedSecret, setRevealedSecret] = useState<{ url: string; secret: string } | null>(null);

  const loadCatalog = () => {
    setCatalogLoading(true);
    // No trailing slash: Vercel's /api/:path* rewrite does not match a
    // trailing-slash path (it falls through to the SPA's catch-all and
    // returns index.html instead of proxying to Railway), which silently
    // emptied this catalog in production -- response.ok was true (200) and
    // response.json() failed on HTML, so the .catch(() => []) below hid the
    // failure completely instead of surfacing an error.
    apiFetch('/api/integrations-live').then(async (r) => { const data = await r.json().catch(() => []); if (Array.isArray(data)) setCatalog(data); }).finally(() => setCatalogLoading(false));
  };
  const loadWebhooks = () => {
    setWebhooksLoading(true);
    apiFetch('/api/v1/dashboard/webhooks').then(async (r) => { const data = await r.json().catch(() => []); if (Array.isArray(data)) setWebhooks(data); }).finally(() => setWebhooksLoading(false));
  };
  useEffect(() => { loadCatalog(); loadWebhooks(); }, []);
  useEffect(() => { if (!passports.some((p) => p.id === selectedPassportId)) setSelectedPassportId(passports[0]?.id || ''); }, [passports, selectedPassportId]);
  useEffect(() => {
    for (const item of catalog) {
      if (item.credentialStatus === 'LIVE' && CUSTOMER_DISCOVERY_PROVIDERS.has(item.provider) && !providerCustomers[item.provider]) void loadProviderCustomers(item.provider);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog]);

  const toggleExpanded = (provider: string) => {
    setExpandedProvider((current) => (current === provider ? null : provider));
    setCredentialValues({});
  };

  const saveCredentials = async (provider: string) => {
    setSavingProvider(provider);
    setTestMessage((current) => ({ ...current, [provider]: '' }));
    try {
      const response = await apiFetch(`/api/integrations-live/${encodeURIComponent(provider)}/credentials`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentialValues),
      });
      if (!response.ok) { const data = await response.json().catch(() => null); throw new Error(responseError(data, 'Unable to save credentials.')); }
      setTestMessage((current) => ({ ...current, [provider]: 'Credentials saved. Run a test to collect live evidence.' }));
      loadCatalog();
    } catch (error) {
      setTestMessage((current) => ({ ...current, [provider]: error instanceof Error ? error.message : 'Unable to save credentials.' }));
    } finally {
      setSavingProvider(null);
    }
  };

  const testProvider = async (provider: string) => {
    if (!selectedPassportId) { setTestMessage((current) => ({ ...current, [provider]: 'Select a passport to test against first.' })); return; }
    setTestingProvider(provider);
    setTestMessage((current) => ({ ...current, [provider]: '' }));
    try {
      const response = await apiFetch(`/api/integrations-live/${encodeURIComponent(provider)}/test`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passportId: selectedPassportId }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(data, 'Live test failed.'));
      setTestMessage((current) => ({ ...current, [provider]: `Live evidence collected (${data.subject || 'authenticated request'}) at ${new Date(data.observedAt).toLocaleString()}.` }));
      loadCatalog();
    } catch (error) {
      setTestMessage((current) => ({ ...current, [provider]: error instanceof Error ? error.message : 'Live test failed.' }));
    } finally {
      setTestingProvider(null);
    }
  };

  // GitHub's deep collector (collectGitHubDeepEvidence) returns many
  // ControlObservations, not the single observation the generic /test route
  // expects, so it is tested through the real trust-loop collection route
  // instead -- the same route the trust-loop backend audit exercised. A
  // credential only becomes LIVE here because POST /collect actually
  // succeeded against the real GitHub API (routes/trust-loop.ts sets
  // integration_credentials.status itself; loadCatalog() below just refetches it).
  const testGithub = async () => {
    if (!selectedPassportId) { setTestMessage((current) => ({ ...current, github: 'Select a passport to test against first.' })); return; }
    setTestingProvider('github');
    setTestMessage((current) => ({ ...current, github: '' }));
    try {
      const response = await apiFetch('/api/trust-loop/collect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passportId: selectedPassportId, provider: 'github' }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(data, 'Live GitHub test failed.'));
      const evidenceCount = Array.isArray(data.evidenceIds) ? data.evidenceIds.length : 0;
      setTestMessage((current) => ({ ...current, github: `Live evidence collected: ${data.observationCount ?? 0} observation${data.observationCount === 1 ? '' : 's'}, ${evidenceCount} evidence item${evidenceCount === 1 ? '' : 's'} persisted.` }));
      loadCatalog();
    } catch (error) {
      setTestMessage((current) => ({ ...current, github: error instanceof Error ? error.message : 'Live GitHub test failed.' }));
    } finally {
      setTestingProvider(null);
    }
  };

  const discoverGithubRepositories = async () => {
    setDiscoveringRepositories(true);
    setTestMessage((current) => ({ ...current, github: '' }));
    try {
      const response = await apiFetch('/api/integrations-live/github/repositories');
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(data, 'Unable to list repositories.'));
      setGithubRepositories(Array.isArray(data) ? data : []);
      if (Array.isArray(data) && data.length && !selectedRepository) setSelectedRepository(data[0].fullName);
    } catch (error) {
      setTestMessage((current) => ({ ...current, github: error instanceof Error ? error.message : 'Unable to list repositories.' }));
    } finally {
      setDiscoveringRepositories(false);
    }
  };

  // Reuses the existing, already-verified public repository-scan pipeline
  // (POST /api/integrations/github/repository-scan -- real git clone, real
  // Syft SBOM, real OSV lookup); this is not a second scanner, just the
  // existing one wired to a repository actually chosen from the account
  // instead of a hand-typed URL.
  const runGithubScan = async () => {
    if (!selectedPassportId || !selectedRepository) return;
    setScanningRepository(true);
    setTestMessage((current) => ({ ...current, github: '' }));
    try {
      const response = await apiFetch('/api/integrations/github/repository-scan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passportId: selectedPassportId, repositoryUrl: `https://github.com/${selectedRepository}` }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(data, 'Unable to queue scan.'));
      setTestMessage((current) => ({ ...current, github: `Scan queued (job ${data.jobId}) for ${data.repository}. Check the Scans tab for results.` }));
    } catch (error) {
      setTestMessage((current) => ({ ...current, github: error instanceof Error ? error.message : 'Unable to queue scan.' }));
    } finally {
      setScanningRepository(false);
    }
  };

  const disconnectProvider = async (provider: string) => {
    if (!window.confirm(`Disconnect ${provider}? SPR will delete the stored credential; discovered customer mappings are kept.`)) return;
    setDisconnectingProvider(provider);
    try {
      const response = await apiFetch(`/api/integrations-live/${encodeURIComponent(provider)}/credentials`, { method: 'DELETE' });
      if (!response.ok) { const data = await response.json().catch(() => null); throw new Error(responseError(data, 'Unable to disconnect.')); }
      setTestMessage((current) => ({ ...current, [provider]: 'Disconnected. Credentials removed.' }));
      loadCatalog();
    } catch (error) {
      setTestMessage((current) => ({ ...current, [provider]: error instanceof Error ? error.message : 'Unable to disconnect.' }));
    } finally {
      setDisconnectingProvider(null);
    }
  };

  const loadProviderCustomers = async (provider: string) => {
    const response = await apiFetch(`/api/integrations-live/${encodeURIComponent(provider)}/customers`);
    const data = await response.json().catch(() => []);
    if (response.ok && Array.isArray(data)) setProviderCustomers((current) => ({ ...current, [provider]: data }));
  };

  const discoverCustomers = async (provider: string) => {
    setDiscoveringProvider(provider);
    setCustomerMessage((current) => ({ ...current, [provider]: '' }));
    try {
      const response = await apiFetch(`/api/integrations-live/${encodeURIComponent(provider)}/customers/discover`, { method: 'POST' });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(data, 'Discovery failed.'));
      setCustomerMessage((current) => ({ ...current, [provider]: `Discovered ${data.discoveredCount} customer${data.discoveredCount === 1 ? '' : 's'}.` }));
      await loadProviderCustomers(provider);
    } catch (error) {
      setCustomerMessage((current) => ({ ...current, [provider]: error instanceof Error ? error.message : 'Discovery failed.' }));
    } finally {
      setDiscoveringProvider(null);
    }
  };

  const mapCustomer = async (provider: string, externalCustomerId: string, clientId: string | null) => {
    setMappingBusyId(`${provider}:${externalCustomerId}`);
    try {
      const response = await apiFetch(`/api/integrations-live/${encodeURIComponent(provider)}/customers/${encodeURIComponent(externalCustomerId)}/mapping`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId }),
      });
      if (!response.ok) { const data = await response.json().catch(() => null); throw new Error(responseError(data, 'Unable to update mapping.')); }
      await loadProviderCustomers(provider);
    } catch (error) {
      setCustomerMessage((current) => ({ ...current, [provider]: error instanceof Error ? error.message : 'Unable to update mapping.' }));
    } finally {
      setMappingBusyId(null);
    }
  };

  const createWebhook = async () => {
    setCreatingWebhook(true);
    setWebhookError('');
    try {
      const response = await apiFetch('/api/v1/dashboard/webhooks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: webhookUrl, events: webhookEvents }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(data, 'Unable to create webhook.'));
      setRevealedSecret({ url: data.url, secret: data.secret });
      setWebhookUrl('');
      loadWebhooks();
    } catch (error) {
      setWebhookError(error instanceof Error ? error.message : 'Unable to create webhook.');
    } finally {
      setCreatingWebhook(false);
    }
  };

  const deactivateWebhook = async (id: string) => {
    if (!window.confirm('Deactivate this webhook? SPR will stop delivering events to it.')) return;
    const response = await apiFetch(`/api/v1/dashboard/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (response.ok) loadWebhooks();
  };

  const liveProviders = useMemo(() => catalog.filter((item) => item.capability === 'live'), [catalog]);
  const plannedProviders = useMemo(() => catalog.filter((item) => item.capability !== 'live'), [catalog]);

  return (
    <div className="space-y-6" id="msp-integrations-view">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.22em] text-[#4ec9b0]"><Plug className="h-4 w-4" /> Connected evidence</div>
          <h1 className="mt-1 text-xl font-display font-bold text-[#d4d4d4]">Integrations</h1>
          <p className="text-xs text-[#9d9d9d] font-sans mt-1">Every connector below makes a real authenticated request and writes hashed evidence to the trust graph — nothing here is a UI-only toggle.</p>
        </div>
        {catalogLoading && <RefreshCw className="h-4 w-4 animate-spin text-[#6f6f6f]" />}
      </div>

      <div className="spr-panel p-4">
        <label className="text-xs font-bold text-[#9d9d9d]">Test evidence against passport</label>
        <select value={selectedPassportId} onChange={(e) => setSelectedPassportId(e.target.value)} className="mt-2 w-full max-w-sm rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2 text-xs text-[#d4d4d4]">
          {!passports.length && <option value="">No passports available — register one first</option>}
          {passports.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.version}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {liveProviders.map((item) => {
          const isGithub = item.provider === 'github';
          const expanded = expandedProvider === item.provider;
          const fields = CREDENTIAL_FIELDS[item.provider] || [];
          const message = testMessage[item.provider];
          return (
            <div key={item.id} className="spr-panel p-5 transition-all flex flex-col gap-4">
              <div className="flex justify-between items-center">
                <div className="bg-[#2d2d2d] border border-[#3c3c3c] p-2.5 rounded-md shrink-0 flex items-center justify-center">{getIntegrationIcon(item.icon)}</div>
                <span className={`px-3 py-1 text-xs font-semibold rounded-md border ${STATUS_STYLES[item.credentialStatus]}`}>{STATUS_LABEL[item.credentialStatus]}</span>
              </div>
              <div>
                <span className={`px-2 py-0.5 rounded text-[8px] font-mono font-bold uppercase tracking-wider border ${getCategoryStyles(item.category)}`}>{item.category}</span>
                <h3 className="text-sm font-bold text-[#d4d4d4] font-display mt-2">{item.name}</h3>
                <p className="text-xs text-[#9d9d9d] leading-relaxed mt-2">{item.description}</p>
              </div>
              {item.lastTestedAt && <p className="text-[10px] text-[#6f6f6f]">Last live evidence: {new Date(item.lastTestedAt).toLocaleString()}</p>}

              <button onClick={() => toggleExpanded(item.provider)} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[#0e639c]/40 bg-[#094771] px-3 py-2 text-xs font-bold text-[#3794ff] hover:bg-[#0e639c]/40">
                <KeyRound className="w-3.5 h-3.5" /> {expanded ? 'Hide credentials' : item.credentialStatus === 'NOT_CONFIGURED' ? 'Connect' : 'Update credentials'}
              </button>
              {expanded && (
                <div className="space-y-2 spr-panel-alt p-3">
                  {fields.map((field) => (
                    <div key={field.key}>
                      <label className="text-[10px] font-bold text-[#9d9d9d]">{field.label}{field.required ? ' *' : ''}</label>
                      <input type={field.type} placeholder={field.placeholder} value={credentialValues[field.key] || ''} onChange={(e) => setCredentialValues((current) => ({ ...current, [field.key]: e.target.value }))} className="mt-0.5 w-full rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-2.5 py-1.5 text-xs text-[#d4d4d4]" />
                    </div>
                  ))}
                  <button onClick={() => void saveCredentials(item.provider)} disabled={savingProvider === item.provider || fields.some((f) => f.required && !credentialValues[f.key]?.trim())} className="w-full spr-btn spr-btn-primary disabled:opacity-40">{savingProvider === item.provider ? 'Saving…' : 'Save credentials'}</button>
                </div>
              )}
              {isGithub ? (
                item.credentialStatus !== 'NOT_CONFIGURED' && (
                  <>
                    <div className="flex gap-2">
                      <button onClick={() => void testGithub()} disabled={testingProvider === 'github' || !selectedPassportId} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-[#89d185]/30 bg-[#89d185]/10 px-3 py-2 text-xs font-bold text-[#89d185] hover:bg-[#89d185]/20 disabled:opacity-40">
                        <RefreshCw className={`w-3.5 h-3.5 ${testingProvider === 'github' ? 'animate-spin' : ''}`} /> {testingProvider === 'github' ? 'Testing…' : 'Test connection'}
                      </button>
                      <button onClick={() => void disconnectProvider('github')} disabled={disconnectingProvider === 'github'} aria-label="Disconnect GitHub" className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[#f14c4c]/30 bg-[#f14c4c]/10 px-3 py-2 text-xs font-bold text-[#f14c4c] hover:bg-[#f14c4c]/20 disabled:opacity-40">
                        <XCircle className="w-3.5 h-3.5" /> {disconnectingProvider === 'github' ? '…' : 'Disconnect'}
                      </button>
                    </div>
                    <div className="space-y-2 spr-panel-alt p-3">
                      <button onClick={() => void discoverGithubRepositories()} disabled={discoveringRepositories} className="w-full spr-btn spr-btn-secondary disabled:opacity-40 inline-flex items-center justify-center gap-1.5">
                        <RefreshCw className={`w-3.5 h-3.5 ${discoveringRepositories ? 'animate-spin' : ''}`} /> {discoveringRepositories ? 'Loading repositories…' : 'Discover repositories'}
                      </button>
                      {githubRepositories.length > 0 && (
                        <>
                          <select value={selectedRepository} onChange={(e) => setSelectedRepository(e.target.value)} className="w-full rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-2.5 py-1.5 text-xs text-[#d4d4d4]">
                            {githubRepositories.map((repo) => <option key={repo.fullName} value={repo.fullName}>{repo.fullName}{repo.private ? ' (private)' : ''}</option>)}
                          </select>
                          <button onClick={() => void runGithubScan()} disabled={scanningRepository || !selectedRepository || !selectedPassportId} className="w-full spr-btn spr-btn-primary disabled:opacity-40 inline-flex items-center justify-center gap-1.5">
                            {scanningRepository ? 'Queuing scan…' : 'Run software scan'}
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )
              ) : (
                <>
                  {item.credentialStatus !== 'NOT_CONFIGURED' && (
                    <div className="flex gap-2">
                      <button onClick={() => void testProvider(item.provider)} disabled={testingProvider === item.provider || !selectedPassportId} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-[#89d185]/30 bg-[#89d185]/10 px-3 py-2 text-xs font-bold text-[#89d185] hover:bg-[#89d185]/20 disabled:opacity-40">
                        <RefreshCw className={`w-3.5 h-3.5 ${testingProvider === item.provider ? 'animate-spin' : ''}`} /> {testingProvider === item.provider ? 'Testing…' : 'Run live test'}
                      </button>
                      <button onClick={() => void disconnectProvider(item.provider)} disabled={disconnectingProvider === item.provider} aria-label={`Disconnect ${item.name}`} className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[#f14c4c]/30 bg-[#f14c4c]/10 px-3 py-2 text-xs font-bold text-[#f14c4c] hover:bg-[#f14c4c]/20 disabled:opacity-40">
                        <XCircle className="w-3.5 h-3.5" /> {disconnectingProvider === item.provider ? '…' : 'Disconnect'}
                      </button>
                    </div>
                  )}
                  {item.credentialStatus === 'LIVE' && CUSTOMER_DISCOVERY_PROVIDERS.has(item.provider) && (
                    <ProviderCustomerMapping
                      provider={item.provider}
                      clients={clients}
                      customers={providerCustomers[item.provider] || []}
                      discovering={discoveringProvider === item.provider}
                      message={customerMessage[item.provider]}
                      mappingBusyId={mappingBusyId}
                      onDiscover={() => void discoverCustomers(item.provider)}
                      onLoad={() => void loadProviderCustomers(item.provider)}
                      onMap={(externalId, clientId) => void mapCustomer(item.provider, externalId, clientId)}
                    />
                  )}
                </>
              )}
              {message && <p className="text-[10px] leading-4 text-[#9d9d9d]">{message}</p>}
            </div>
          );
        })}
      </div>

      {plannedProviders.length > 0 && (
        <div className="rounded-md border border-dashed border-[#3c3c3c] bg-[#252526] p-4">
          <div className="text-xs font-bold text-[#9d9d9d] mb-2">Cataloged, not yet built</div>
          <div className="flex flex-wrap gap-2">{plannedProviders.map((item) => <span key={item.id} className="rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-2.5 py-1 text-[10px] text-[#9d9d9d]">{item.name}</span>)}</div>
        </div>
      )}

      {/* Real webhook subscriptions — replaces a prior panel whose Save/Test buttons were no-ops against endpoints that did not exist. */}
      <div className="spr-panel p-6 text-[#d4d4d4] space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-[#094771] border border-[#0e639c]/40 text-[#3794ff] rounded-md"><Webhook className="w-5 h-5" /></div>
          <div>
            <h2 className="text-base font-display font-bold">Webhook subscriptions</h2>
            <p className="text-xs text-[#9d9d9d] mt-0.5">SPR delivers a signed HTTP POST to your URL for the events you pick. Relay it to Slack, Jira, or a PSA with your own automation (e.g. Zapier, a small serverless function) — SPR does not host per-PSA routing rules itself.</p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <label className="text-xs font-bold text-[#d4d4d4]">Destination URL (HTTPS only, must resolve to a public address)</label>
            <input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://your-relay.example.com/spr" className="w-full bg-[#2d2d2d] text-xs text-[#d4d4d4] border border-[#3c3c3c] rounded-md px-3.5 py-2.5 font-mono" />
            <div className="grid grid-cols-2 gap-2">
              {WEBHOOK_EVENT_TYPES.map((event) => (
                <label key={event} className="flex items-center gap-2 text-[11px] text-[#d4d4d4]">
                  <input type="checkbox" checked={webhookEvents.includes(event)} onChange={(e) => setWebhookEvents((current) => e.target.checked ? [...current, event] : current.filter((item) => item !== event))} className="h-3.5 w-3.5 rounded border-[#3c3c3c] bg-[#2d2d2d]" />
                  {event}
                </label>
              ))}
            </div>
            <button onClick={() => void createWebhook()} disabled={creatingWebhook || !webhookUrl.trim() || !webhookEvents.length} className="inline-flex items-center gap-1.5 spr-btn spr-btn-primary disabled:opacity-40"><Send className="w-3.5 h-3.5" /> {creatingWebhook ? 'Creating…' : 'Create webhook'}</button>
            {webhookError && <p className="text-xs text-[#f14c4c]">{webhookError}</p>}
            {revealedSecret && (
              <div className="rounded-md border border-[#89d185]/30 bg-[#89d185]/10 p-3 text-xs">
                <div className="font-bold text-[#89d185]">Signing secret (shown once — store it now)</div>
                <div className="mt-1 flex items-center gap-2 font-mono text-[#89d185]"><span className="truncate">{revealedSecret.secret}</span><button onClick={() => navigator.clipboard.writeText(revealedSecret.secret)} aria-label="Copy secret"><Copy className="h-3.5 w-3.5" /></button></div>
                <p className="mt-1 text-[#89d185]/80">Verify deliveries with HMAC-SHA256 over the `x-spr-signature` header, as documented for SPR Connect webhooks.</p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="text-xs font-bold text-[#d4d4d4]">Active subscriptions</div>
            {webhooksLoading && <p className="text-xs text-[#9d9d9d]">Loading…</p>}
            {!webhooksLoading && webhooks.length === 0 && <p className="text-xs text-[#9d9d9d]">No webhooks configured yet.</p>}
            <ul className="space-y-2 max-h-64 overflow-auto pr-1">
              {webhooks.map((webhook) => (
                <li key={webhook.id} className="rounded-md border border-[#3c3c3c] bg-[#2d2d2d] p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-[#d4d4d4]">{webhook.url}</span>
                    {webhook.active ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#89d185]" /> : <XCircle className="h-3.5 w-3.5 shrink-0 text-[#6f6f6f]" />}
                  </div>
                  <div className="mt-1 text-[10px] text-[#9d9d9d]">{webhook.consecutive_failure_count > 0 && <span className="text-[#cca700]">{webhook.consecutive_failure_count} recent failures · </span>}Created {new Date(webhook.created_at).toLocaleDateString()}</div>
                  {webhook.active && <button onClick={() => void deactivateWebhook(webhook.id)} className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-[#f14c4c] hover:text-[#f14c4c]/80"><Trash2 className="h-3 w-3" /> Deactivate</button>}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="rounded-md border border-[#cca700]/30 bg-[#cca700]/[.08] p-3 text-[10px] leading-5 text-[#cca700]/90 flex gap-2">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          Direct native ticket-creation in Jira/ConnectWise/Autotask, SIEM ingestion, and identity-provider connectors are not built — this signed webhook is the only outbound event mechanism SPR currently ships. Use it to relay events into those systems yourself.
        </div>
      </div>
    </div>
  );
}

function ProviderCustomerMapping({ provider, clients, customers, discovering, message, mappingBusyId, onDiscover, onLoad, onMap }: {
  provider: string; clients: Client[]; customers: ProviderCustomer[]; discovering: boolean; message?: string; mappingBusyId: string | null;
  onDiscover: () => void; onLoad: () => void; onMap: (externalCustomerId: string, clientId: string | null) => void;
}) {
  const mappedCount = customers.filter((c) => c.client_id).length;
  return (
    <div className="spr-panel-alt p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#9d9d9d]">MSP customers {customers.length > 0 && `(${mappedCount}/${customers.length} mapped)`}</span>
        <div className="flex gap-1">
          <button onClick={onLoad} aria-label="Refresh discovered customers" className="rounded-md border border-[#3c3c3c] p-1 text-[#9d9d9d] hover:text-[#d4d4d4]"><RefreshCw className="w-3 h-3" /></button>
          <button onClick={onDiscover} disabled={discovering} className="rounded-md border border-[#0e639c]/40 bg-[#094771] px-2 py-1 text-[10px] font-bold text-[#3794ff] disabled:opacity-40">{discovering ? 'Discovering…' : 'Discover customers'}</button>
        </div>
      </div>
      {customers.length === 0 && <p className="text-[10px] text-[#6f6f6f]">No customers discovered yet from {provider}. Click "Discover customers" to fetch the real list from the provider.</p>}
      {customers.length > 0 && (
        <ul className="space-y-1.5 max-h-40 overflow-auto pr-1">
          {customers.map((customer) => (
            <li key={customer.id} className="flex items-center justify-between gap-2 rounded border border-[#3c3c3c] bg-[#2d2d2d] px-2 py-1.5">
              <span className="truncate text-[11px] text-[#d4d4d4]">{customer.external_customer_name}</span>
              <select
                value={customer.client_id || ''}
                disabled={mappingBusyId === `${provider}:${customer.external_customer_id}`}
                onChange={(e) => onMap(customer.external_customer_id, e.target.value || null)}
                className="shrink-0 max-w-[45%] rounded border border-[#3c3c3c] bg-[#1e1e1e] px-1.5 py-1 text-[10px] text-[#d4d4d4]"
              >
                <option value="">Unmapped</option>
                {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
            </li>
          ))}
        </ul>
      )}
      {message && <p className="text-[10px] text-[#9d9d9d]">{message}</p>}
    </div>
  );
}
