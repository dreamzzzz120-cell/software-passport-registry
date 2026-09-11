/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Copy, Key, Trash2, XCircle } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

// SPR Connect API keys. The routes (POST/GET/DELETE /api/connect/v1/api-keys)
// existed with no screen calling them, so the "SPR API" add-on could only be
// used with curl. Everything here is a real request; the full key is shown
// exactly once, as the backend returns it exactly once.
type ApiKeyRow = { id: string; name: string; key_prefix: string; scopes: string | string[]; last_used_at: string | null; expires_at: string | null; revoked_at: string | null; created_at: string };
type Scope = 'read' | 'write' | 'webhooks';
const SCOPES: Array<{ id: Scope; label: string; help: string }> = [
  { id: 'read', label: 'read', help: 'Read passports, trust, evidence, risk and history.' },
  { id: 'write', label: 'write', help: 'Register software programmatically.' },
  { id: 'webhooks', label: 'webhooks', help: 'Manage API-key webhooks.' },
];

function scopesOf(row: ApiKeyRow): string[] {
  if (Array.isArray(row.scopes)) return row.scopes;
  try { const parsed = JSON.parse(row.scopes || '[]'); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
}

async function responseError(res: Response, fallback: string) {
  const data = await res.json().catch(() => null);
  if (typeof data?.message === 'string') return data.message;
  if (typeof data?.error === 'string') return data.error;
  return fallback;
}

export default function ApiKeysPanel() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Scope[]>(['read']);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ id: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/connect/v1/api-keys');
      if (!res.ok) { setLoadError(await responseError(res, 'API keys are unavailable.')); return; }
      const data = await res.json().catch(() => []);
      setKeys(Array.isArray(data) ? data : []);
      setLoadError(null);
    } catch {
      setLoadError('API keys are unavailable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    setCreating(true); setCreateError(null); setCopied(false);
    try {
      const res = await apiFetch('/api/connect/v1/api-keys', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), scopes }),
      });
      if (!res.ok) throw new Error(await responseError(res, 'Unable to create the API key.'));
      const data = await res.json();
      if (typeof data?.key !== 'string' || typeof data?.id !== 'string') throw new Error('The server did not return a key.');
      setRevealed({ id: data.id, key: data.key });
      setName('');
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Unable to create the API key.');
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    setRevokingId(id);
    try {
      const res = await apiFetch(`/api/connect/v1/api-keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(await responseError(res, 'Unable to revoke the API key.'));
      if (revealed?.id === id) setRevealed(null);
      await load();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Unable to revoke the API key.');
    } finally {
      setRevokingId(null);
    }
  };

  const toggleScope = (scope: Scope, on: boolean) => setScopes((current) => on ? Array.from(new Set([...current, scope])) : current.filter((item) => item !== scope));

  return (
    <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-5 space-y-4" id="spr-api-keys">
      <div className="flex items-center gap-2">
        <Key className="h-4 w-4 text-[var(--spr-highlight)]" />
        <h3 className="text-sm font-bold text-[var(--spr-text)]">SPR Connect API keys</h3>
      </div>
      <p className="text-xs text-[var(--spr-text-muted)]">Keys authenticate the machine API at <span className="font-mono">/api/connect/v1</span>. The full key is shown once, at creation; SPR stores only a hash. Revoking is immediate.</p>

      <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
        <div className="space-y-2">
          <label htmlFor="spr-api-key-name" className="text-xs font-bold text-[var(--spr-text)]">Key name</label>
          <input id="spr-api-key-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CI pipeline" maxLength={120} className="w-full bg-[var(--spr-surface-sunken)] text-xs text-[var(--spr-text)] border border-[var(--spr-border)] rounded-md px-3 py-2 focus:outline-none" />
          <div className="flex flex-wrap gap-3">
            {SCOPES.map((scope) => (
              <label key={scope.id} className="flex items-center gap-1.5 text-[11px] text-[var(--spr-text)]" title={scope.help}>
                <input type="checkbox" id={`spr-api-scope-${scope.id}`} checked={scopes.includes(scope.id)} onChange={(e) => toggleScope(scope.id, e.target.checked)} />
                <span className="font-mono">{scope.label}</span>
              </label>
            ))}
          </div>
        </div>
        <button onClick={() => void create()} disabled={creating || !name.trim() || scopes.length === 0} className="spr-btn spr-btn-primary disabled:opacity-50">{creating ? 'Creating…' : 'Create key'}</button>
      </div>
      {createError && <p role="alert" className="text-xs text-[var(--spr-red)]">{createError}</p>}

      {revealed && (
        <div className="rounded-md border border-[var(--spr-green)]/30 bg-[var(--spr-green)]/10 p-3 text-xs">
          <div className="font-bold text-[var(--spr-green)]">API key (shown once — store it now)</div>
          <div className="mt-1 flex items-center gap-2 font-mono text-[var(--spr-green)]">
            <span className="truncate">{revealed.key}</span>
            <button onClick={() => { void navigator.clipboard.writeText(revealed.key).then(() => setCopied(true)).catch(() => setCopied(false)); }} className="shrink-0 inline-flex items-center gap-1" aria-label="Copy API key"><Copy className="h-3.5 w-3.5" />{copied ? 'Copied' : 'Copy'}</button>
          </div>
          <p className="mt-1 text-[var(--spr-green)]/80">Send it as <span className="font-mono">Authorization: Bearer &lt;key&gt;</span>.</p>
        </div>
      )}

      <div className="space-y-2">
        <div className="text-xs font-bold text-[var(--spr-text)]">Keys</div>
        {loading && <p className="text-xs text-[var(--spr-text-muted)]">Loading…</p>}
        {loadError && <p role="alert" className="text-xs text-[var(--spr-red)]">{loadError}</p>}
        {!loading && !loadError && keys.length === 0 && <p className="text-xs text-[var(--spr-text-muted)]">No API keys yet.</p>}
        <ul className="space-y-2 max-h-64 overflow-auto pr-1">
          {keys.map((row) => {
            const active = !row.revoked_at && (!row.expires_at || new Date(row.expires_at).getTime() > Date.now());
            return (
              <li key={row.id} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[var(--spr-text)]"><b>{row.name}</b> <span className="font-mono text-[var(--spr-text-muted)]">{row.key_prefix}…</span></span>
                  {active ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--spr-green)]" /> : <XCircle className="h-3.5 w-3.5 shrink-0 text-[var(--spr-text-faint)]" />}
                </div>
                <div className="mt-1 text-[12px] text-[var(--spr-text-muted)] font-mono">
                  {scopesOf(row).join(', ') || 'no scopes'} · created {new Date(row.created_at).toLocaleDateString()}
                  {row.last_used_at ? ` · last used ${new Date(row.last_used_at).toLocaleString()}` : ' · never used'}
                  {row.expires_at ? ` · expires ${new Date(row.expires_at).toLocaleDateString()}` : ''}
                  {row.revoked_at ? ` · revoked ${new Date(row.revoked_at).toLocaleDateString()}` : ''}
                </div>
                {active && <button onClick={() => void revoke(row.id)} disabled={revokingId === row.id} className="mt-2 inline-flex items-center gap-1 text-[12px] font-bold text-[var(--spr-red)] disabled:opacity-50"><Trash2 className="h-3 w-3" />{revokingId === row.id ? 'Revoking…' : 'Revoke'}</button>}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
