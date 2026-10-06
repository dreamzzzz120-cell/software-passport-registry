import { useEffect, useMemo, useState } from 'react';
import { Database, ExternalLink, RefreshCw, Search, ShieldCheck, Star } from 'lucide-react';
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
  semantics?: { status?: string; quality_status?: string };
};

const label = (value: string | null | undefined) => value?.trim() || 'UNKNOWN';

export default function PublicRegistryView() {
  const [data, setData] = useState<RegistryResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reviewed, setReviewed] = useState<Set<string> | null>(null);
  const [query, setQuery] = useState('');
  const [language, setLanguage] = useState('all');

  const load = async () => {
    setData(null);
    setState('loading');
    try {
      const response = await apiFetch('/api/registry-public?limit=100');
      const json = await response.json();
      if (!response.ok || !json?.ok || !Array.isArray(json.items) || !Number.isFinite(json.count)) throw new Error('REGISTRY_READ_FAILED');
      setData(json);
      setState('ready');
    } catch {
      setState('error');
    }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    let active = true;
    setReviewed(null);
    if (state !== 'ready') return;
    void fetch('/software/index.json', { signal: AbortSignal.timeout(15000) }).then(async (response) => {
      if (!response.ok) throw new Error('EVIDENCE_INDEX_UNAVAILABLE');
      const json = await response.json();
      if (!Array.isArray(json.entries)) throw new Error('INVALID_EVIDENCE_INDEX');
      const keys = new Set<string>(json.entries.filter((entry: any) => typeof entry.owner === 'string' && typeof entry.repository === 'string').map((entry: any) => `${entry.owner}/${entry.repository}`.toLowerCase()));
      if (active) setReviewed(keys);
    }).catch(() => { if (active) setReviewed(null); });
    return () => { active = false; };
  }, [state]);

  const languages = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of data?.items ?? []) {
      const key = item.language || 'Unknown';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);

  const visibleItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.items ?? []).filter((item) => {
      const matchesLanguage = language === 'all' || (item.language || 'Unknown') === language;
      const haystack = `${item.repository_owner}/${item.repository_name} ${item.language ?? ''} ${item.license_spdx ?? ''}`.toLowerCase();
      return matchesLanguage && (!needle || haystack.includes(needle));
    });
  }, [data, language, query]);

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface)]">
        <div className="p-5 sm:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--spr-border)] bg-[var(--spr-surface-raised)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--spr-highlight)]">
                <ShieldCheck className="h-3.5 w-3.5" /> Evidence-first registry
              </div>
              <div className="flex items-center gap-3">
                <Database className="h-7 w-7 text-[var(--spr-highlight)]" />
                <h1 className="text-2xl font-bold tracking-tight text-[var(--spr-text)] sm:text-3xl">Software Passport Registry</h1>
              </div>
              <p className="mt-3 text-sm leading-6 text-[var(--spr-text-muted)] sm:text-base">
                Discover public software SPR has actually observed. Observation is not verification: missing evidence stays UNKNOWN, and deeper findings only appear when evidence exists.
              </p>
            </div>
            <button type="button" onClick={() => void load()} disabled={state === 'loading'} className="inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface-raised)] px-4 py-2 text-sm font-medium text-[var(--spr-text)] hover:border-[var(--spr-highlight)] disabled:opacity-60">
              <RefreshCw className={`h-4 w-4 ${state === 'loading' ? 'animate-spin' : ''}`} /> Refresh registry
            </button>
          </div>

          {data && (
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-raised)] p-4">
                <div className="text-2xl font-bold text-[var(--spr-text)]">{data.count}</div>
                <div className="mt-1 text-xs uppercase tracking-wide text-[var(--spr-text-muted)]">Observed repositories</div>
              </div>
              <div className="rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-raised)] p-4">
                <div className="text-2xl font-bold text-[var(--spr-text)]">{languages.length}</div>
                <div className="mt-1 text-xs uppercase tracking-wide text-[var(--spr-text-muted)]">Languages in loaded records</div>
              </div>
              <div className="col-span-2 rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-raised)] p-4 sm:col-span-1">
                <div className="text-sm font-semibold text-[var(--spr-text)]">Reality rule</div>
                <div className="mt-1 text-xs leading-5 text-[var(--spr-text-muted)]">If SPR cannot see evidence, it does not invent it.</div>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface)] p-4 sm:p-5">
        <div className="grid gap-3 md:grid-cols-[1fr_220px]">
          <label className="relative block">
            <span className="sr-only">Search registry</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--spr-text-muted)]" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search owner, repository, language or license…" className="min-h-11 w-full rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface-raised)] py-2 pl-10 pr-3 text-sm text-[var(--spr-text)] outline-none placeholder:text-[var(--spr-text-muted)] focus:border-[var(--spr-highlight)]" />
          </label>
          <select aria-label="Filter by language" value={language} onChange={(event) => setLanguage(event.target.value)} className="min-h-11 rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface-raised)] px-3 text-sm text-[var(--spr-text)] outline-none focus:border-[var(--spr-highlight)]">
            <option value="all">All languages</option>
            {languages.map(([name, count]) => <option key={name} value={name}>{name} ({count})</option>)}
          </select>
        </div>
        {data && <div className="mt-3 text-xs text-[var(--spr-text-muted)]">Showing {visibleItems.length} of {data.items.length} loaded records ({data.count} total). Search and language filters apply only to these loaded records.</div>}
      </section>

      {state === 'loading' && <div className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface)] p-8 text-center text-sm text-[var(--spr-text-muted)]">Loading observed software…</div>}
      {state === 'error' && (
        <div role="alert" className="rounded-2xl border border-[var(--spr-red)]/40 bg-[var(--spr-surface)] p-7">
          <div className="font-semibold text-[var(--spr-red)]">The public registry could not be loaded.</div>
          <p className="mt-2 text-sm text-[var(--spr-text-muted)]">No registry data is being guessed or substituted.</p>
          <button type="button" onClick={() => void load()} className="mt-4 rounded-lg border border-[var(--spr-border)] px-4 py-2 text-sm font-medium text-[var(--spr-text)] hover:bg-[var(--spr-surface-raised)]">Try again</button>
        </div>
      )}

      {state === 'ready' && data && visibleItems.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[var(--spr-border)] bg-[var(--spr-surface)] p-10 text-center">
          <Search className="mx-auto h-6 w-6 text-[var(--spr-text-muted)]" />
          <div className="mt-3 font-semibold text-[var(--spr-text)]">{data.items.length === 0 ? 'No repositories observed yet' : 'No matches among loaded records'}</div>
          <p className="mt-1 text-sm text-[var(--spr-text-muted)]">{data.items.length === 0 ? 'Run a free review of a public repository to collect evidence.' : 'Clear the filters or review a repository directly. Repositories outside this loaded set have not been searched.'}</p>
          <button type="button" onClick={() => { setQuery(''); setLanguage('all'); }} className="mt-4 mr-4 underline">Clear filters</button><a href="/free-review" className="underline">Run a free review</a>
        </div>
      )}

      {state === 'ready' && data && visibleItems.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {visibleItems.map((item) => (
            <article key={item.id} className="group rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface)] p-5 transition hover:border-[var(--spr-highlight)]">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-xs font-medium uppercase tracking-wide text-[var(--spr-text-muted)] break-words">{item.repository_owner}</div>
                  <h2 className="mt-1 break-words text-lg font-bold text-[var(--spr-text)]">{item.repository_name}</h2>
                </div>
                <span className="shrink-0 rounded-full border border-[var(--spr-border)] bg-[var(--spr-surface-raised)] px-2.5 py-1 text-[11px] font-semibold text-[var(--spr-text-muted)]">Quality assessment: {label(item.quality_status).toUpperCase()}</span>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div><div className="text-xs text-[var(--spr-text-muted)]">Language</div><div className="mt-1 font-medium text-[var(--spr-text)]">{label(item.language)}</div></div>
                <div><div className="text-xs text-[var(--spr-text-muted)]">License</div><div className="mt-1 font-medium text-[var(--spr-text)]">{label(item.license_spdx)}</div></div>
                <div><div className="text-xs text-[var(--spr-text-muted)]">Discovery state</div><div className="mt-1 font-medium text-[var(--spr-text)]">{label(item.status)}</div></div>
                <div><div className="text-xs text-[var(--spr-text-muted)]">GitHub stars</div><div className="mt-1 inline-flex items-center gap-1 font-medium text-[var(--spr-text)]"><Star className="h-3.5 w-3.5" /> {item.stars.toLocaleString()}</div></div>
              </div>

              <p className="mt-4 text-xs leading-5 text-[var(--spr-text-muted)]">GitHub metadata observation is not a completed scan or verification. {reviewed === null ? 'Scan evidence availability is UNKNOWN until the completed-review index is retrieved.' : reviewed.has(`${item.repository_owner}/${item.repository_name}`.toLowerCase()) ? 'A completed SPR review is available; open it to inspect its evidence and limits.' : 'No completed review was found in the retrieved public index. Run a free review to collect evidence.'}</p>
              <div className="mt-5 border-t border-[var(--spr-border)] pt-4">
                <div className="text-xs text-[var(--spr-text-muted)]">Last observed</div>
                <div className="mt-1 text-sm text-[var(--spr-text)]">{new Date(item.last_observed_at).toLocaleString()}</div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                {reviewed?.has(`${item.repository_owner}/${item.repository_name}`.toLowerCase()) && <a href={`/software/${encodeURIComponent(item.repository_owner)}/${encodeURIComponent(item.repository_name)}`} className="inline-flex min-h-10 items-center rounded-lg border border-[var(--spr-border)] px-4 py-2 text-sm font-semibold">View SPR evidence</a>}
                <a href={`/free-review?owner=${encodeURIComponent(item.repository_owner)}&repo=${encodeURIComponent(item.repository_name)}&src=registry`} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[var(--spr-highlight)] px-4 py-2 text-sm font-semibold text-black hover:opacity-90">Run a free review</a>
                <a href={item.canonical_url} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[var(--spr-border)] px-4 py-2 text-sm font-medium text-[var(--spr-text)] hover:bg-[var(--spr-surface-raised)]">GitHub <ExternalLink className="h-3.5 w-3.5" /></a>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
