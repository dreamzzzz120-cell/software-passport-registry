import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Radar, RefreshCw, ShieldCheck, Copy, Check } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

type ScoutOpportunity = {
  id: string;
  source: string;
  title: string;
  url: string;
  author?: string | null;
  publishedAt?: string | null;
  score: number;
  reason: string;
  draftReply?: string | null;
  status?: string | null;
};

type ScoutResponse = {
  opportunities?: ScoutOpportunity[];
  sources?: Array<{ name: string; status: 'available' | 'config_required' | 'unknown'; detail?: string }>;
  generatedAt?: string;
};

export default function SocialScoutView() {
  const [data, setData] = useState<ScoutResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch('/api/founder/social-scout');
      if (!response.ok) {
        if (response.status === 404) {
          setError('Social Scout backend is not connected yet. The SPR workspace surface is installed, but source adapters and reply generation still need to be wired.');
        } else {
          setError(`Social Scout could not load (HTTP ${response.status}).`);
        }
        setData(null);
        return;
      }
      const body = await response.json().catch(() => null);
      setData(body && typeof body === 'object' ? body : {});
    } catch {
      setError('Social Scout could not reach the SPR API.');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const opportunities = useMemo(
    () => Array.isArray(data?.opportunities) ? [...data!.opportunities!].sort((a, b) => b.score - a.score) : [],
    [data],
  );

  const copyReply = async (item: ScoutOpportunity) => {
    if (!item.draftReply) return;
    await navigator.clipboard.writeText(item.draftReply);
    setCopied(item.id);
    window.setTimeout(() => setCopied((current) => current === item.id ? null : current), 1600);
  };

  return (
    <section className="space-y-5">
      <div className="spr-panel p-6 md:p-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[.15em] text-[var(--spr-text-faint)]">
              <Radar className="h-4 w-4" /> Founder growth agent
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--spr-text)]">SPR Social Scout</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--spr-text-muted)]">
              Finds public conversations where SPR genuinely belongs, scores the opportunity, explains the fit, and prepares a useful reply. Nothing is counted as found, drafted, or posted unless SPR can retrieve evidence for it.
            </p>
          </div>
          <button onClick={() => void load()} disabled={loading} className="spr-btn spr-btn-secondary inline-flex items-center gap-2">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {(data?.sources || []).map((source) => (
          <div key={source.name} className="spr-panel p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold">{source.name}</span>
              <span className="rounded-sm border border-[var(--spr-border)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--spr-text-muted)]">
                {source.status.replace('_', ' ')}
              </span>
            </div>
            {source.detail && <p className="mt-2 text-xs leading-5 text-[var(--spr-text-faint)]">{source.detail}</p>}
          </div>
        ))}
      </div>

      {error && (
        <div className="spr-panel border-amber-500/30 p-5">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 text-amber-400" />
            <div>
              <div className="text-sm font-semibold">Current state is explicit</div>
              <p className="mt-1 text-sm leading-6 text-[var(--spr-text-muted)]">{error}</p>
            </div>
          </div>
        </div>
      )}

      {!loading && !error && opportunities.length === 0 && (
        <div className="spr-panel p-8 text-center">
          <Radar className="mx-auto h-8 w-8 text-[var(--spr-text-faint)]" />
          <h2 className="mt-3 text-base font-semibold">No verified opportunities yet</h2>
          <p className="mt-2 text-sm text-[var(--spr-text-muted)]">SPR will show real source URLs, relevance scores, and reply drafts here once the scout returns evidence.</p>
        </div>
      )}

      <div className="space-y-3">
        {opportunities.map((item) => (
          <article key={item.id} className="spr-panel p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--spr-text-faint)]">
                  <span>{item.source}</span>
                  {item.author && <span>• {item.author}</span>}
                  {item.publishedAt && <span>• {new Date(item.publishedAt).toLocaleString()}</span>}
                </div>
                <h2 className="mt-1 text-base font-semibold text-[var(--spr-text)]">{item.title}</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--spr-text-muted)]">{item.reason}</p>
              </div>
              <div className="shrink-0 rounded-md border border-[var(--spr-border)] px-3 py-2 text-center">
                <div className="text-xl font-semibold">{Math.max(0, Math.min(100, Math.round(item.score)))}</div>
                <div className="text-[10px] uppercase tracking-wide text-[var(--spr-text-faint)]">relevance</div>
              </div>
            </div>

            {item.draftReply && (
              <div className="mt-4 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--spr-text-faint)]">Suggested reply</div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--spr-text)]">{item.draftReply}</p>
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <a href={item.url} target="_blank" rel="noopener noreferrer" className="spr-btn spr-btn-primary inline-flex items-center gap-2">
                Open conversation <ExternalLink className="h-4 w-4" />
              </a>
              {item.draftReply && (
                <button onClick={() => void copyReply(item)} className="spr-btn spr-btn-secondary inline-flex items-center gap-2">
                  {copied === item.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied === item.id ? 'Copied' : 'Copy reply'}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
