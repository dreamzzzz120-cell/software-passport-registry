import { useEffect, useMemo, useState } from 'react';
import { Database, ExternalLink, RefreshCw } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

type RegistryItem = {
  id: string;
  repository_owner: string;
  repository_name: string;
  canonical_url: string;
  status: string;
  stars: number;
  language: string | null;
  license_spdx: string | null;
  quality_status: string;
  last_observed_at: string;
};

type RegistryResponse = {
  ok: boolean;
  count: number;
  items: RegistryItem[];
  semantics?: {
    status?: string;
    quality_status?: string;
  };
};

export default function PublicRegistryView() {
  const [data, setData] = useState<RegistryResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = async () => {
    setState('loading');
    try {
      const response = await apiFetch('/api/registry-public?limit=100');
      const json = await response.json();
      if (!response.ok || !json?.ok) throw new Error('REGISTRY_READ_FAILED');
      setData(json);
      setState('ready');
    } catch {
      setState('error');
    }
  };

  useEffect(() => { void load(); }, []);

  const languages = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of data?.items ?? []) {
      const key = item.language || 'Unknown';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a,b) => b[1] - a[1]).slice(0, 5);
  }, [data]);

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-[var(--spr-highlight)]" />
              <h1 className="text-xl font-bold text-[var(--spr-text)]">Public Software Registry</h1>
            </div>
            <p className="mt-2 max-w-3xl text-sm text-[var(--spr-text-muted)]">
              Public repositories SPR has observed from GitHub. Discovery is not verification. Missing evidence remains UNKNOWN until SPR runs evidence collection and verification.
            </p>
          </div>
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-md border border-[var(--spr-border)] px-3 py-2 text-sm text-[var(--spr-text)] hover:bg-[var(--spr-surface-raised)]">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>

        {data && (
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-[var(--spr-text-muted)]">
            <span className="rounded-full border border-[var(--spr-border)] px-2.5 py-1">{data.count} observed repositories</span>
            {languages.map(([name,count]) => <span key={name} className="rounded-full border border-[var(--spr-border)] px-2.5 py-1">{name}: {count}</span>)}
          </div>
        )}
      </section>

      {state === 'loading' && <div className="rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface)] p-6 text-sm text-[var(--spr-text-muted)]">Loading public registry…</div>}
      {state === 'error' && <div role="alert" className="rounded-lg border border-[var(--spr-red)]/40 bg-[var(--spr-surface)] p-6 text-sm text-[var(--spr-red)]">Public registry could not be loaded.</div>}

      {state === 'ready' && data && (
        <div className="overflow-x-auto rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface)]">
          <table className="w-full min-w-[780px] text-sm">
            <thead>
              <tr className="border-b border-[var(--spr-border)] text-left text-xs uppercase tracking-wide text-[var(--spr-text-muted)]">
                <th className="px-4 py-3">Repository</th>
                <th className="px-4 py-3">Language</th>
                <th className="px-4 py-3">Stars</th>
                <th className="px-4 py-3">License</th>
                <th className="px-4 py-3">Evidence state</th>
                <th className="px-4 py-3">Last observed</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.id} className="border-b border-[var(--spr-border)] last:border-b-0">
                  <td className="px-4 py-3">
                    <a href={item.canonical_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-[var(--spr-text)] hover:text-[var(--spr-highlight)]">
                      {item.repository_owner}/{item.repository_name}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </td>
                  <td className="px-4 py-3 text-[var(--spr-text-muted)]">{item.language ?? 'Unknown'}</td>
                  <td className="px-4 py-3 text-[var(--spr-text-muted)]">{item.stars.toLocaleString()}</td>
                  <td className="px-4 py-3 text-[var(--spr-text-muted)]">{item.license_spdx ?? 'Unknown'}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full border border-[var(--spr-border)] px-2 py-1 text-xs text-[var(--spr-text-muted)]">
                      {item.status} / {item.quality_status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--spr-text-muted)]">{new Date(item.last_observed_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
