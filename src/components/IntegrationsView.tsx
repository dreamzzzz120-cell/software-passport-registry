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
    case 'slack': return <Slack className="w-4 h-4 text-pink-500" />;
    case 'github': case 'git': return <Github className="w-4 h-4 text-[#323130]" />;
    case 'monitor': return <Monitor className="w-4 h-4 text-[#0f6cbd]" />;
    case 'briefcase': return <Briefcase className="w-4 h-4 text-violet-600" />;
    case 'file-text': return <FileText className="w-4 h-4 text-teal-600" />;
    case 'key': return <Key className="w-4 h-4 text-rose-600" />;
    case 'shield-check': return <ShieldCheck className="w-4 h-4 text-red-600" />;
    case 'ticket': return <Ticket className="w-4 h-4 text-violet-600" />;
    case 'book-open': return <BookOpen className="w-4 h-4 text-teal-600" />;
    case 'cloud-lightning': return <CloudLightning className="w-4 h-4 text-amber-600" />;
    default: return <Plug className="w-4 h-4 text-[#0f6cbd]" />;
  }
};

const STATUS_DOT: Record<LiveCatalogItem['credentialStatus'], string> = {
  NOT_CONFIGURED: 'bg-[#8a8886]',
  CONFIGURED: 'bg-[#8a5700]',
  LIVE: 'bg-[#0e700e]',
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
    <div className="space-y-4" id="msp-integrations-view">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold text-[#201f1e]">Integrations</h1>
          <p className="mt-1 text-[13px] text-[#605e5c]">Connect live tools and outbound webhooks for evidence collection.</p>
        </div>
        {catalogLoading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-[#8a8886]" />}
      </div>

      <details className="mb-1 rounded-md border border-[#e1dfdd] bg-[#faf9f8] text-[13px]">
        <summary className="cursor-pointer select-none px-3 py-2 font-medium text-[#323130]">&#9432; What is this? &middot; How it works</summary>
        <div className="px-3 pb-3 text-[#605e5c]">
          <p>Every connector below makes a real authenticated request and writes hashed evidence to the trust graph &mdash; nothing here is a UI-only toggle.</p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
            <li>Save credentials for a provider, then run a live test against a selected passport.</li>
            <li>Successful tests write signed evidence you can review from that passport's trust graph.</li>
            <li>Use webhook subscriptions to relay SPR events into Slack, Jira, or a PSA via your own automation.</li>
          </ol>
        </div>
      </details>

      <div className="rounded-md border border-[#e1dfdd] bg-white p-3">
        <label className="text-[11px] font-semibold text-[#605e5c]">Test evidence against passport</label>
        <select value={selectedPassportId} onChange={(e) => setSelectedPassportId(e.target.value)} className="mt-1.5 h-9 w-full max-w-sm rounded border border-[#c8c6c4] bg-white px-3 text-[13px] text-[#323130] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]">
          {!passports.length && <option value="">No passports available — register one first</option>}
          {passports.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.version}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {liveProviders.map((item) => {
          const isGithub = item.provider === 'github';
          const expanded = expandedProvider === item.provider;
          const fields = CREDENTIAL_FIELDS[item.provider] || [];
          const message = testMessage[item.provider];
          return (
            <div key={item.id} className="flex flex-col gap-3 rounded-md border border-[#e1dfdd] bg-white p-4">
              <div className="flex items-center justify-between">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[#e1dfdd] bg-[#faf9f8]">{getIntegrationIcon(item.icon)}</div>
                <span className="inline-flex items-center gap-1.5 text-[12px]"><span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[item.credentialStatus]}`} />{STATUS_LABEL[item.credentialStatus]}</span>
              </div>
              <div>
                <span className="rounded border border-[#e1dfdd] bg-[#f3f2f1] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#605e5c]">{item.category}</span>
                <h3 className="mt-2 text-[13px] font-semibold text-[#201f1e]">{item.name}</h3>
                <p className="mt-1 text-[12px] leading-relaxed text-[#605e5c]">{item.description}</p>
              </div>
              {item.lastTestedAt && <p className="text-[11px] text-[#8a8886]">Last live evidence: {new Date(item.lastTestedAt).toLocaleString()}</p>}

              {isGithub ? (
                <button onClick={() => onNavigateTab?.('/scans')} className="mt-1 inline-flex h-8 items-center justify-center gap-1.5 rounded border border-[#c8c6c4] px-3 text-[13px] font-medium text-[#323130] hover:bg-black/[.03]">
                  <RefreshCw className="w-3.5 h-3.5" /> Run from Scans (repository-scoped scan)
                </button>
              ) : (
                <>
                  <button onClick={() => toggleExpanded(item.provider)} className="inline-flex h-8 items-center justify-center gap-1.5 rounded border border-[#c8c6c4] px-3 text-[13px] font-medium text-[#323130] hover:bg-black/[.03]">
                    <KeyRound className="w-3.5 h-3.5" /> {expanded ? 'Hide credentials' : item.credentialStatus === 'NOT_CONFIGURED' ? 'Connect' : 'Update credentials'}
                  </button>
                  {expanded && (
                    <div className="space-y-2 rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-3">
                      {fields.map((field) => (
                        <div key={field.key}>
                          <label className="text-[11px] font-semibold text-[#605e5c]">{field.label}{field.required ? ' *' : ''}</label>
                          <input type={field.type} placeholder={field.placeholder} value={credentialValues[field.key] || ''} onChange={(e) => setCredentialValues((current) => ({ ...current, [field.key]: e.target.value }))} className="mt-1 h-9 w-full rounded border border-[#c8c6c4] bg-white px-2.5 text-[13px] text-[#323130] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]" />
                        </div>
                      ))}
                      <button onClick={() => void saveCredentials(item.provider)} disabled={savingProvider === item.provider || fields.some((f) => f.required && !credentialValues[f.key]?.trim())} className="h-8 w-full rounded bg-[#0f6cbd] px-3 text-[13px] font-medium text-white hover:bg-[#004578] disabled:opacity-40">{savingProvider === item.provider ? 'Saving…' : 'Save credentials'}</button>
                    </div>
                  )}
                  {item.credentialStatus !== 'NOT_CONFIGURED' && (
                    <button onClick={() => void testProvider(item.provider)} disabled={testingProvider === item.provider || !selectedPassportId} className="inline-flex h-8 items-center justify-center gap-1.5 rounded border border-[#c8c6c4] px-3 text-[13px] font-medium text-[#323130] hover:bg-black/[.03] disabled:opacity-40">
                      <RefreshCw className={`w-3.5 h-3.5 ${testingProvider === item.provider ? 'animate-spin' : ''}`} /> {testingProvider === item.provider ? 'Testing…' : 'Run live test'}
                    </button>
                  )}
                </>
              )}
              {message && <p className="text-[11px] leading-4 text-[#605e5c]">{message}</p>}
            </div>
          );
        })}
      </div>

      {plannedProviders.length > 0 && (
        <div className="rounded-md border border-dashed border-[#c8c6c4] bg-[#faf9f8] p-3">
          <div className="mb-2 text-[11px] font-semibold text-[#605e5c]">Cataloged, not yet built</div>
          <div className="flex flex-wrap gap-2">{plannedProviders.map((item) => <span key={item.id} className="rounded border border-[#e1dfdd] bg-white px-2 py-1 text-[11px] text-[#605e5c]">{item.name}</span>)}</div>
        </div>
      )}

      {/* Real webhook subscriptions — replaces a prior panel whose Save/Test buttons were no-ops against endpoints that did not exist. */}
      <div className="space-y-4 rounded-md border border-[#e1dfdd] bg-white p-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded border border-[#e1dfdd] bg-[#eff6fc] text-[#0f6cbd]"><Webhook className="w-4 h-4" /></div>
          <div>
            <h2 className="text-[14px] font-semibold text-[#201f1e]">Webhook subscriptions</h2>
            <p className="mt-0.5 text-[12px] text-[#605e5c]">SPR delivers a signed HTTP POST to your URL for the events you pick. Relay it to Slack, Jira, or a PSA with your own automation (e.g. Zapier, a small serverless function) — SPR does not host per-PSA routing rules itself.</p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <label className="text-[11px] font-semibold text-[#605e5c]">Destination URL (HTTPS only, must resolve to a public address)</label>
            <input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://your-relay.example.com/spr" className="h-9 w-full rounded border border-[#c8c6c4] bg-white px-3 font-mono text-[12px] text-[#323130] focus:border-[#0f6cbd] focus:outline-none focus:ring-1 focus:ring-[#0f6cbd]" />
            <div className="grid grid-cols-2 gap-2">
              {WEBHOOK_EVENT_TYPES.map((event) => (
                <label key={event} className="flex items-center gap-2 text-[12px] text-[#323130]">
                  <input type="checkbox" checked={webhookEvents.includes(event)} onChange={(e) => setWebhookEvents((current) => e.target.checked ? [...current, event] : current.filter((item) => item !== event))} className="h-3.5 w-3.5 rounded border-[#c8c6c4]" />
                  {event}
                </label>
              ))}
            </div>
            <button onClick={() => void createWebhook()} disabled={creatingWebhook || !webhookUrl.trim() || !webhookEvents.length} className="inline-flex h-8 items-center gap-1.5 rounded bg-[#0f6cbd] px-3 text-[13px] font-medium text-white hover:bg-[#004578] disabled:opacity-40"><Send className="w-3.5 h-3.5" /> {creatingWebhook ? 'Creating…' : 'Create webhook'}</button>
            {webhookError && <p className="text-[12px] text-[#a4262c]">{webhookError}</p>}
            {revealedSecret && (
              <div className="rounded-md border border-[#e1dfdd] bg-[#dff6dd] p-3 text-[12px]">
                <div className="font-semibold text-[#0e700e]">Signing secret (shown once — store it now)</div>
                <div className="mt-1 flex items-center gap-2 font-mono text-[#0e700e]"><span className="truncate">{revealedSecret.secret}</span><button onClick={() => navigator.clipboard.writeText(revealedSecret.secret)} aria-label="Copy secret"><Copy className="h-3.5 w-3.5" /></button></div>
                <p className="mt-1 text-[#0e700e]/80">Verify deliveries with HMAC-SHA256 over the `x-spr-signature` header, as documented for SPR Connect webhooks.</p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="text-[11px] font-semibold text-[#605e5c]">Active subscriptions</div>
            {webhooksLoading && <p className="text-[12px] text-[#8a8886]">Loading…</p>}
            {!webhooksLoading && webhooks.length === 0 && <p className="text-[12px] text-[#8a8886]">No webhooks configured yet.</p>}
            <ul className="max-h-64 space-y-2 overflow-auto pr-1">
              {webhooks.map((webhook) => (
                <li key={webhook.id} className="rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-3 text-[12px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-[#323130]">{webhook.url}</span>
                    {webhook.active ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#0e700e]" /> : <XCircle className="h-3.5 w-3.5 shrink-0 text-[#8a8886]" />}
                  </div>
                  <div className="mt-1 text-[11px] text-[#8a8886]">{webhook.consecutive_failure_count > 0 && <span className="text-[#8a5700]">{webhook.consecutive_failure_count} recent failures · </span>}Created {new Date(webhook.created_at).toLocaleDateString()}</div>
                  {webhook.active && <button onClick={() => void deactivateWebhook(webhook.id)} className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-[#a4262c] hover:text-[#69000f]"><Trash2 className="h-3 w-3" /> Deactivate</button>}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex gap-2 rounded-md border border-[#e1dfdd] bg-[#fff4ce] p-3 text-[11px] leading-5 text-[#8a5700]">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          Direct native ticket-creation in Jira/ConnectWise/Autotask, SIEM ingestion, and identity-provider connectors are not built — this signed webhook is the only outbound event mechanism SPR currently ships. Use it to relay events into those systems yourself.
        </div>
      </div>
    </div>
  );
}
