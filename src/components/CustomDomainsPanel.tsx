/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * White-label custom domains. Shows exactly what the server knows: the
 * hostname, the DNS records the hosting provider asked for, the provider's
 * last verification answer and when it was given, and whether sign-in on
 * the hostname is enabled at the identity provider.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Globe, RefreshCw, Trash2 } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

interface DnsRecord { type: string; name: string; value: string; purpose: string }
interface Domain {
  id: string; hostname: string; status: 'pending_dns' | 'active' | 'error'; dnsRecords: DnsRecord[];
  signInEnabled: boolean; signInError: string | null; lastCheckedAt: string | null; lastError: string | null; activatedAt: string | null; createdAt: string;
}

export default function CustomDomainsPanel({ role }: { role: string }) {
  const isOwner = role === 'Owner';
  const canView = isOwner || role === 'Admin';
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [hostname, setHostname] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!canView) return;
    try {
      const response = await apiFetch('/api/organization/domains');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setConfigured(data.configured === true);
      setDomains(Array.isArray(data.domains) ? data.domains : []);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load domains.'); }
  }, [canView]);

  useEffect(() => { void load(); }, [load]);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    setBusy('add'); setError(''); setNotice('');
    try {
      const response = await apiFetch('/api/organization/domains', { method: 'POST', body: JSON.stringify({ hostname }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data?.message || data?.error || `HTTP ${response.status}`); return; }
      setHostname('');
      setNotice(`${data.domain.hostname} registered with the hosting provider. Create the DNS records below, then click Verify.`);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Network error.'); }
    finally { setBusy(null); }
  };

  const verify = async (domain: Domain) => {
    setBusy(domain.id); setError(''); setNotice('');
    try {
      const response = await apiFetch(`/api/organization/domains/${encodeURIComponent(domain.id)}/verify`, { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data?.message || data?.error || `HTTP ${response.status}`); return; }
      const d: Domain = data.domain;
      setNotice(d.status === 'active'
        ? `${d.hostname} is active${d.signInEnabled ? ' and sign-in is enabled on it.' : ', but sign-in could not be enabled at the identity provider (see below).'}`
        : d.status === 'error' ? `The hosting provider returned an error for ${d.hostname}; see below.` : `${d.hostname} is not verified yet (provider reports verified=${String(data.provider?.verified)}, misconfigured=${String(data.provider?.misconfigured)}). DNS changes can take up to an hour to propagate.`);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Network error.'); }
    finally { setBusy(null); }
  };

  const remove = async (domain: Domain) => {
    if (!window.confirm(`Remove ${domain.hostname}? Visitors to that hostname will stop reaching this workspace.`)) return;
    setBusy(domain.id); setError(''); setNotice('');
    try {
      const response = await apiFetch(`/api/organization/domains/${encodeURIComponent(domain.id)}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data?.message || data?.error || `HTTP ${response.status}`); return; }
      setNotice(`${data.hostname} removed.${Array.isArray(data.warnings) && data.warnings.length ? ` Warnings: ${data.warnings.join(' ')}` : ''}`);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Network error.'); }
    finally { setBusy(null); }
  };

  if (!canView) return null;

  return (
    <div className="rounded-[var(--spr-radius)] border border-[var(--spr-border)] p-3 text-[12px] text-[var(--spr-text-muted)]">
      <p className="font-semibold text-[var(--spr-text)] flex items-center gap-1.5"><Globe className="h-3.5 w-3.5 text-[var(--spr-highlight)]" /> Custom domain</p>
      <p className="mt-1">Serve this workspace — sign-in page, dashboard and public passport links — from a hostname you own, such as <code>trust.yourmsp.com</code>. The hostname is registered with the hosting provider, you create the DNS records it asks for, and the provider’s own verification answer decides when it is live.</p>

      {configured === false && <p className="mt-2 rounded border border-dashed border-[var(--spr-amber)]/50 p-2 text-[var(--spr-amber)]">This deployment has no hosting-provider credentials configured, so custom domains cannot be registered from here yet. Nothing is faked: adding a hostname will be refused until they are set.</p>}

      {domains.map((d) => (
        <div key={d.id} className="mt-3 rounded border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[var(--spr-text)]">{d.hostname}</span>
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${d.status === 'active' ? 'bg-[var(--spr-green)]/15 text-[var(--spr-green)]' : d.status === 'error' ? 'bg-[var(--spr-red)]/15 text-[var(--spr-red)]' : 'bg-[var(--spr-amber)]/15 text-[var(--spr-amber)]'}`}>{d.status === 'active' ? 'Active' : d.status === 'error' ? 'Provider error' : 'Waiting for DNS'}</span>
              {d.status === 'active' && <span className={`text-[11px] ${d.signInEnabled ? 'text-[var(--spr-green)]' : 'text-[var(--spr-amber)]'}`}>{d.signInEnabled ? 'sign-in enabled' : 'sign-in not yet enabled'}</span>}
            </div>
            <div className="flex gap-2">
              <button disabled={busy !== null} onClick={() => verify(d)} className="inline-flex items-center gap-1 rounded border border-[var(--spr-border)] px-2 py-1 text-[11px] font-semibold text-[var(--spr-text)] hover:bg-[var(--spr-surface-hover)] disabled:opacity-50"><RefreshCw className="h-3 w-3" /> {busy === d.id ? 'Checking…' : 'Verify'}</button>
              {isOwner && <button disabled={busy !== null} onClick={() => remove(d)} className="inline-flex items-center gap-1 rounded border border-[var(--spr-red)]/40 px-2 py-1 text-[11px] font-semibold text-[var(--spr-red)] hover:bg-[var(--spr-red)]/10 disabled:opacity-50"><Trash2 className="h-3 w-3" /> Remove</button>}
            </div>
          </div>
          <p className="mt-1 text-[11px] text-[var(--spr-text-faint)]">
            {d.lastCheckedAt ? `Provider last checked ${new Date(d.lastCheckedAt).toLocaleString()}.` : 'Not checked yet.'}
            {d.activatedAt ? ` Active since ${new Date(d.activatedAt).toLocaleString()}.` : ''}
          </p>
          {d.lastError && <p className="mt-1 text-[11px] text-[var(--spr-red)]">{d.lastError}</p>}
          {d.signInError && <p className="mt-1 text-[11px] text-[var(--spr-amber)]">Identity provider: {d.signInError}. Pages are served, but sign-in on this hostname will be refused until this is resolved; click Verify to retry.</p>}
          {d.status !== 'active' && d.dnsRecords.length > 0 && (
            <table className="mt-2 w-full text-[11px]">
              <thead><tr className="text-left text-[var(--spr-text-faint)]"><th className="py-1 pr-2">Type</th><th className="py-1 pr-2">Name</th><th className="py-1 pr-2">Value</th><th className="py-1">Why</th></tr></thead>
              <tbody>{d.dnsRecords.map((r, i) => <tr key={i} className="border-t border-[var(--spr-border)] align-top"><td className="py-1 pr-2 font-mono text-[var(--spr-text)]">{r.type}</td><td className="py-1 pr-2 font-mono text-[var(--spr-text)]">{r.name}</td><td className="py-1 pr-2 font-mono break-all text-[var(--spr-text)]">{r.value}</td><td className="py-1">{r.purpose}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      ))}

      {isOwner && (
        <form onSubmit={add} className="mt-3 flex flex-wrap items-center gap-2">
          <input value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="trust.yourmsp.com" disabled={configured === false || busy !== null} className="min-w-[220px] flex-1 rounded border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2.5 py-1.5 font-mono text-[12px] text-[var(--spr-text)] disabled:opacity-50" />
          <button type="submit" disabled={configured === false || busy !== null || hostname.trim().length < 4} className="rounded bg-[var(--spr-accent)] px-3 py-1.5 text-[12px] font-bold text-white hover:bg-[var(--spr-accent-hover)] disabled:opacity-50">{busy === 'add' ? 'Registering…' : 'Add hostname'}</button>
        </form>
      )}
      {error && <p className="mt-2 text-[12px] text-[var(--spr-red)]">{error}</p>}
      {notice && <p className="mt-2 text-[12px] text-[var(--spr-green)]">{notice}</p>}
    </div>
  );
}
