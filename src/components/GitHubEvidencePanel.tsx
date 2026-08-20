import { useState, type FormEvent } from 'react';
import { apiFetch } from '../utils/apiClient';

export default function GitHubEvidencePanel() {
  const [passportId, setPassportId] = useState('');
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [ref, setRef] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const response = await apiFetch('/api/integrations/github/repository-scan', {
        method: 'POST',
        body: JSON.stringify({ passportId, repositoryUrl, ...(ref.trim() ? { ref: ref.trim() } : {}) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || 'Unable to queue the GitHub evidence scan.');
      setMessage(`Queued real repository scan ${body.jobId}. The worker will resolve the commit, acquire the source, run Syft and query OSV. No trust score is created by the queue request.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'GitHub scan request failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mb-6 rounded-xl border border-cyan-400/20 bg-slate-900 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.2em] text-cyan-300">LIVE EVIDENCE CONNECTOR</p>
          <h2 className="mt-1 text-lg font-bold text-white">GitHub repository → real evidence pipeline</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">Public GitHub repositories are pulled by the server-side worker. SPR resolves an immutable commit, downloads the archive, runs Syft 1.49.0, persists hashed evidence, and queries OSV. Missing verification is never converted into a green score.</p>
        </div>
        <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-bold text-emerald-300">LIVE ADAPTER</span>
      </div>
      <form onSubmit={submit} className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-[1fr_1.5fr_1fr_auto]">
        <input value={passportId} onChange={e => setPassportId(e.target.value)} required placeholder="Passport ID" className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-cyan-300" />
        <input value={repositoryUrl} onChange={e => setRepositoryUrl(e.target.value)} required placeholder="https://github.com/owner/repository" className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-cyan-300" />
        <input value={ref} onChange={e => setRef(e.target.value)} placeholder="Branch/ref (optional)" className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-cyan-300" />
        <button disabled={busy} className="rounded-lg bg-cyan-300 px-4 py-2 text-xs font-bold text-slate-950 disabled:opacity-50">{busy ? 'Queueing…' : 'Scan repository'}</button>
      </form>
      {message && <p className="mt-3 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-xs text-slate-300">{message}</p>}
    </section>
  );
}
