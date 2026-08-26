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
import type { SoftwarePassport } from '../types';
import { apiFetch } from '../utils/apiClient';
import { CREDENTIAL_FIELDS, WEBHOOK_EVENT_TYPES } from '../integrations/credentialFields';

interface IntegrationsViewProps {
  passports?: SoftwarePassport[];
  onNavigateTab?: (tab: string) => void;
}

type LiveCatalogItem = {
  id: string; name: string; category: string; icon: string; description: string; provider: string;
  capability: 'live' | 'planned'; adapter: string; credentialStatus: 'NOT_CONFIGURED' | 'CONFIGURED' | 'LIVE'; lastTestedAt: string | null;
};

type DashboardWebhook = { id: string; url: string; events: string; active: boolean; consecutive_failure_count: number; disabled_at: string | null; created_at: string };

const getIntegrationIcon = (iconName: string) => {
  switch (iconName?.toLowerCase()) {
    case 'slack': return <Slack className="w-5 h-5 text-pink-500" />;
    case 'github': case 'git': return <Github className="w-5 h-5 text-slate-800" />;
    case 'monitor': return <Monitor className="w-5 h-5 text-cyan-500" />;
    case 'briefcase': return <Briefcase className="w-5 h-5 text-violet-500" />;
    case 'file-text': return <FileText className="w-5 h-5 text-teal-500" />;
    case 'key': return <Key className="w-5 h-5 text-rose-500" />;
    case 'shield-check': return <ShieldCheck className="w-5 h-5 text-red-500" />;
    case 'ticket': return <Ticket className="w-5 h-5 text-violet-500" />;
    case 'book-open': return <BookOpen className="w-5 h-5 text-teal-500" />;
    case 'cloud-lightning': return <CloudLightning className="w-5 h-5 text-amber-500" />;
    default: return <Plug className="w-5 h-5 text-indigo-500" />;
  }
};

const getCategoryStyles = (category: string) => {
  switch (category?.toUpperCase()) {
    case 'RMM': return 'bg-cyan-50 text-cyan-700 border-cyan-200';
    case 'PSA': return 'bg-violet-50 text-violet-700 border-violet-200';
    case 'DOCUMENTATION': return 'bg-teal-50 text-teal-700 border-teal-200';
    case 'SIEM': return 'bg-red-50 text-red-700 border-red-200';
    case 'DEVOPS': return 'bg-slate-50 text-slate-700 border-slate-200';
    case 'CHAT': return 'bg-pink-50 text-pink-700 border-pink-200';
    case 'ISSUE TRACKER': return 'bg-orange-50 text-orange-700 border-orange-200';
    case 'WORKSPACE': return 'bg-indigo-50 text-indigo-700 border-indigo-200';
    case 'CLOUD': return 'bg-blue-50 text-blue-700 border-blue-200';
    default: return 'bg-slate-50 text-slate-600 border-slate-200';
  }
};

const STATUS_STYLES: Record<LiveCatalogItem['credentialStatus'], string> = {
  NOT_CONFIGURED: 'bg-slate-50 border-slate-200 text-slate-600',
  CONFIGURED: 'bg-amber-50 border-amber-200 text-amber-700',
  LIVE: 'bg-emerald-50 border-emerald-200 text-emerald-700',
};
const STATUS_LABEL: Record<LiveCatalogItem['credentialStatus'], string> = {
  NOT_CONFIGURED: 'Not connected', CONFIGURED: 'Saved, untested', LIVE: 'Live',
};

function responseError(data: any, fallback: string) {
  if (typeof data?.error === 'string') return data.error;
  return fallback;
}

export default function IntegrationsView({ passports = [], onNavigateTab }: IntegrationsViewProps) {
  const [catalog, setCatalog] = useState<LiveCatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [credentialValues, setCredentialValues] = useState<Record<string, string>>({});
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState<Record<string, string>>({});
  const [selectedPassportId, setSelectedPassportId] = useState(passports[0]?.id || '');

  const [webhooks, setWebhooks] = useState<DashboardWebhook[]>([]);
  const [webhooksLoading, setWebhooksLoading] = useState(true);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookEvents, setWebhookEvents] = useState<string[]>([...WEBHOOK_EVENT_TYPES]);
  const [creatingWebhook, setCreatingWebhook] = useState(false);
  const [webhookError, setWebhookError] = useState('');
  const [revealedSecret, setRevealedSecret] = useState<{ url: string; secret: string } | null>(null);

  const loadCatalog = () => {
    setCatalogLoading(true);
    apiFetch('/api/integrations-live/').then(async (r) => { const data = await r.json().catch(() => []); if (Array.isArray(data)) setCatalog(data); }).finally(() => setCatalogLoading(false));
  };
  const loadWebhooks = () => {
    setWebhooksLoading(true);
    apiFetch('/api/v1/dashboard/webhooks').then(async (r) => { const data = await r.json().catch(() => []); if (Array.isArray(data)) setWebhooks(data); }).finally(() => setWebhooksLoading(false));
  };
  useEffect(() => { loadCatalog(); loadWebhooks(); }, []);
  useEffect(() => { if (!passports.some((p) => p.id === selectedPassportId)) setSelectedPassportId(passports[0]?.id || ''); }, [passports, selectedPassportId]);

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
          <h1 className="text-xl font-display font-bold text-slate-900">Integrations</h1>
          <p className="text-xs text-slate-500 font-sans mt-1">Every connector below makes a real authenticated request and writes hashed evidence to the trust graph — nothing here is a UI-only toggle.</p>
        </div>
        {catalogLoading && <RefreshCw className="h-4 w-4 animate-spin text-slate-400" />}
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <label className="text-xs font-bold text-slate-600">Test evidence against passport</label>
        <select value={selectedPassportId} onChange={(e) => setSelectedPassportId(e.target.value)} className="mt-2 w-full max-w-sm rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800">
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
            <div key={item.id} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-all flex flex-col gap-4">
              <div className="flex justify-between items-center">
                <div className="bg-slate-50 border border-slate-100 p-2.5 rounded-lg shrink-0 flex items-center justify-center shadow-inner">{getIntegrationIcon(item.icon)}</div>
                <span className={`px-3 py-1 text-xs font-semibold rounded-md border ${STATUS_STYLES[item.credentialStatus]}`}>{STATUS_LABEL[item.credentialStatus]}</span>
              </div>
              <div>
                <span className={`px-2 py-0.5 rounded text-[8px] font-mono font-bold uppercase tracking-wider border ${getCategoryStyles(item.category)}`}>{item.category}</span>
                <h3 className="text-sm font-bold text-slate-800 font-display mt-2">{item.name}</h3>
                <p className="text-xs text-slate-500 leading-relaxed mt-2">{item.description}</p>
              </div>
              {item.lastTestedAt && <p className="text-[10px] text-slate-400">Last live evidence: {new Date(item.lastTestedAt).toLocaleString()}</p>}

              {isGithub ? (
                <button onClick={() => onNavigateTab?.('/scans')} className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">
                  <RefreshCw className="w-3.5 h-3.5" /> Run from Scans (repository-scoped scan)
                </button>
              ) : (
                <>
                  <button onClick={() => toggleExpanded(item.provider)} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100">
                    <KeyRound className="w-3.5 h-3.5" /> {expanded ? 'Hide credentials' : item.credentialStatus === 'NOT_CONFIGURED' ? 'Connect' : 'Update credentials'}
                  </button>
                  {expanded && (
                    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      {fields.map((field) => (
                        <div key={field.key}>
                          <label className="text-[10px] font-bold text-slate-500">{field.label}{field.required ? ' *' : ''}</label>
                          <input type={field.type} placeholder={field.placeholder} value={credentialValues[field.key] || ''} onChange={(e) => setCredentialValues((current) => ({ ...current, [field.key]: e.target.value }))} className="mt-0.5 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800" />
                        </div>
                      ))}
                      <button onClick={() => void saveCredentials(item.provider)} disabled={savingProvider === item.provider || fields.some((f) => f.required && !credentialValues[f.key]?.trim())} className="w-full rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">{savingProvider === item.provider ? 'Saving…' : 'Save credentials'}</button>
                    </div>
                  )}
                  {item.credentialStatus !== 'NOT_CONFIGURED' && (
                    <button onClick={() => void testProvider(item.provider)} disabled={testingProvider === item.provider || !selectedPassportId} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40">
                      <RefreshCw className={`w-3.5 h-3.5 ${testingProvider === item.provider ? 'animate-spin' : ''}`} /> {testingProvider === item.provider ? 'Testing…' : 'Run live test'}
                    </button>
                  )}
                </>
              )}
              {message && <p className="text-[10px] leading-4 text-slate-500">{message}</p>}
            </div>
          );
        })}
      </div>

      {plannedProviders.length > 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
          <div className="text-xs font-bold text-slate-500 mb-2">Cataloged, not yet built</div>
          <div className="flex flex-wrap gap-2">{plannedProviders.map((item) => <span key={item.id} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] text-slate-500">{item.name}</span>)}</div>
        </div>
      )}

      {/* Real webhook subscriptions — replaces a prior panel whose Save/Test buttons were no-ops against endpoints that did not exist. */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-white shadow-xl space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-xl"><Webhook className="w-5 h-5" /></div>
          <div>
            <h2 className="text-base font-display font-bold">Webhook subscriptions</h2>
            <p className="text-xs text-slate-400 mt-0.5">SPR delivers a signed HTTP POST to your URL for the events you pick. Relay it to Slack, Jira, or a PSA with your own automation (e.g. Zapier, a small serverless function) — SPR does not host per-PSA routing rules itself.</p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <label className="text-xs font-bold text-slate-300">Destination URL (HTTPS only, must resolve to a public address)</label>
            <input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://your-relay.example.com/spr" className="w-full bg-slate-850 text-xs text-white border border-slate-750 rounded-xl px-3.5 py-2.5 font-mono" />
            <div className="grid grid-cols-2 gap-2">
              {WEBHOOK_EVENT_TYPES.map((event) => (
                <label key={event} className="flex items-center gap-2 text-[11px] text-slate-300">
                  <input type="checkbox" checked={webhookEvents.includes(event)} onChange={(e) => setWebhookEvents((current) => e.target.checked ? [...current, event] : current.filter((item) => item !== event))} className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-850" />
                  {event}
                </label>
              ))}
            </div>
            <button onClick={() => void createWebhook()} disabled={creatingWebhook || !webhookUrl.trim() || !webhookEvents.length} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40"><Send className="w-3.5 h-3.5" /> {creatingWebhook ? 'Creating…' : 'Create webhook'}</button>
            {webhookError && <p className="text-xs text-rose-300">{webhookError}</p>}
            {revealedSecret && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs">
                <div className="font-bold text-emerald-200">Signing secret (shown once — store it now)</div>
                <div className="mt-1 flex items-center gap-2 font-mono text-emerald-100"><span className="truncate">{revealedSecret.secret}</span><button onClick={() => navigator.clipboard.writeText(revealedSecret.secret)} aria-label="Copy secret"><Copy className="h-3.5 w-3.5" /></button></div>
                <p className="mt-1 text-emerald-300/80">Verify deliveries with HMAC-SHA256 over the `x-spr-signature` header, as documented for SPR Connect webhooks.</p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="text-xs font-bold text-slate-300">Active subscriptions</div>
            {webhooksLoading && <p className="text-xs text-slate-500">Loading…</p>}
            {!webhooksLoading && webhooks.length === 0 && <p className="text-xs text-slate-500">No webhooks configured yet.</p>}
            <ul className="space-y-2 max-h-64 overflow-auto pr-1">
              {webhooks.map((webhook) => (
                <li key={webhook.id} className="rounded-lg border border-slate-800 bg-slate-850/60 p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-slate-200">{webhook.url}</span>
                    {webhook.active ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" /> : <XCircle className="h-3.5 w-3.5 shrink-0 text-slate-600" />}
                  </div>
                  <div className="mt-1 text-[10px] text-slate-500">{webhook.consecutive_failure_count > 0 && <span className="text-amber-400">{webhook.consecutive_failure_count} recent failures · </span>}Created {new Date(webhook.created_at).toLocaleDateString()}</div>
                  {webhook.active && <button onClick={() => void deactivateWebhook(webhook.id)} className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-rose-400 hover:text-rose-300"><Trash2 className="h-3 w-3" /> Deactivate</button>}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[.06] p-3 text-[10px] leading-5 text-amber-200/80 flex gap-2">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          Direct native ticket-creation in Jira/ConnectWise/Autotask, SIEM ingestion, and identity-provider connectors are not built — this signed webhook is the only outbound event mechanism SPR currently ships. Use it to relay events into those systems yourself.
        </div>
      </div>
    </div>
  );
}
