import React, { useRef, useState } from 'react';
import { Upload, Github, FileArchive, ShieldCheck, Loader2, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';
import type { Scan, Client } from '../types';
import { apiFetch } from '../utils/apiClient';

interface ScansViewProps {
  scans: Scan[];
  onTriggerNewScan: (scan: Scan) => void;
  clients?: Client[];
  assets?: any[];
  onBatchTagScans?: (scanIds: string[], customCategory: string) => void;
  passports?: any[];
  role?: string;
}

type Mode = 'repository' | 'files';
type Notice = { kind: 'success' | 'error'; text: string } | null;

function classifyFile(file: File): 'software' | 'document' | 'sbom' | 'archive' | 'unknown' {
  const name = file.name.toLowerCase();
  if (/\.(zip|tar|gz|tgz|tar\.gz)$/.test(name)) return 'archive';
  if (/\.(json|xml|spdx)$/.test(name) && /(sbom|cyclonedx|spdx|bom)/i.test(name)) return 'sbom';
  if (/\.(pdf|doc|docx|txt|md)$/.test(name)) return 'document';
  if (/\.(js|ts|tsx|jsx|py|go|rs|java|cs|cpp|c|rb|php|yml|yaml|toml|lock)$/.test(name)) return 'software';
  return 'unknown';
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default function ScansView({ scans, onTriggerNewScan }: ScansViewProps) {
  const [mode, setMode] = useState<Mode>('repository');
  const [repository, setRepository] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const startRepositoryReview = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !repository.trim()) return;
    setBusy(true); setNotice(null);
    try {
      const input = repository.trim();
      const parsed = new URL(input.includes('://') ? input : `https://github.com/${input}`);
      if (parsed.hostname.toLowerCase() !== 'github.com') throw new Error('Enter a GitHub repository URL or owner/repository.');
      const parts = parsed.pathname.split('/').filter(Boolean).map((part) => part.replace(/\.git$/, ''));
      if (parts.length !== 2) throw new Error('Use a repository such as owner/repository.');
      const response = await apiFetch('/api/free-review/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: parts[0], repository: parts[1] }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Could not start repository review.');
      setNotice({ kind: 'success', text: `Repository review started for ${parts[0]}/${parts[1]}. Open the review status from the link below.` });
      if (typeof data?.statusUrl === 'string') setNotice({ kind: 'success', text: `Repository review started for ${parts[0]}/${parts[1]}. ${data.statusUrl}` });
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not start repository review.' });
    } finally { setBusy(false); }
  };

  const addFiles = (incoming: FileList | File[]) => {
    const next = Array.from(incoming);
    setFiles((current) => [...current, ...next.filter((file) => !current.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified))].slice(0, 100));
    setNotice(null);
  };

  const uploadFiles = async () => {
    if (busy || files.length === 0) return;
    setBusy(true); setNotice(null);
    try {
      const sessionResponse = await apiFetch('/api/intake/session', { method: 'POST' });
      const session = await sessionResponse.json().catch(() => ({}));
      if (!sessionResponse.ok || typeof session?.sessionId !== 'string') throw new Error(session?.error || 'Could not create secure intake session.');
      for (const file of files) {
        const meta = { name: file.name, size: file.size, contentType: file.type || 'application/octet-stream', kind: classifyFile(file) };
        const urlResponse = await apiFetch('/api/intake/upload-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: session.sessionId, file: meta }) });
        const upload = await urlResponse.json().catch(() => ({}));
        if (!urlResponse.ok || typeof upload?.signedUrl !== 'string') throw new Error(upload?.error || `Could not prepare ${file.name}.`);
        const put = await fetch(upload.signedUrl, { method: 'PUT', headers: { 'Content-Type': meta.contentType }, body: file });
        if (!put.ok) throw new Error(`Upload failed for ${file.name}.`);
        const digest = await sha256(file);
        const complete = await apiFetch('/api/intake/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: session.sessionId, itemId: upload.itemId, sha256: digest }) });
        if (!complete.ok) { const body = await complete.json().catch(() => ({})); throw new Error(body?.error || `Could not finalize ${file.name}.`); }
      }
      const claim = await apiFetch('/api/intake/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: session.sessionId }) });
      if (!claim.ok) { const body = await claim.json().catch(() => ({})); throw new Error(body?.error || 'Files uploaded, but could not attach the intake to this workspace.'); }
      setFiles([]);
      setNotice({ kind: 'success', text: 'Upload complete. Files were verified with SHA-256 and queued for SPR analysis.' });
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Upload failed.' });
    } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6" id="spr-new-review">
      <header>
        <div className="text-[10px] font-bold uppercase tracking-[.22em] text-[var(--spr-highlight)]">Software intake</div>
        <h1 className="mt-2 text-3xl font-bold text-[var(--spr-text)]">Start a new software review</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--spr-text-muted)]">Submit a GitHub repository or upload software evidence. SPR keeps the original evidence, records its SHA-256 digest, and sends it through the analysis pipeline.</p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <button onClick={() => setMode('repository')} className={`spr-panel p-5 text-left transition ${mode === 'repository' ? 'ring-1 ring-[var(--spr-highlight)]' : ''}`}>
          <Github className="h-6 w-6 text-[var(--spr-highlight)]" />
          <div className="mt-3 text-lg font-semibold">Repository</div>
          <div className="mt-1 text-sm text-[var(--spr-text-muted)]">Analyze a GitHub repository and its dependency/security evidence.</div>
        </button>
        <button onClick={() => setMode('files')} className={`spr-panel p-5 text-left transition ${mode === 'files' ? 'ring-1 ring-[var(--spr-highlight)]' : ''}`}>
          <FileArchive className="h-6 w-6 text-[var(--spr-highlight)]" />
          <div className="mt-3 text-lg font-semibold">Upload files</div>
          <div className="mt-1 text-sm text-[var(--spr-text-muted)]">Upload SBOMs, ZIPs, manifests, source files, and supporting evidence.</div>
        </button>
      </div>

      {mode === 'repository' ? (
        <section className="spr-panel p-6">
          <form onSubmit={startRepositoryReview} className="space-y-4">
            <label className="block text-sm font-semibold">GitHub repository
              <input value={repository} onChange={(e) => setRepository(e.target.value)} placeholder="owner/repository or https://github.com/owner/repository" className="mt-2 w-full rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-4 py-3 text-sm outline-none focus:border-[var(--spr-highlight)]" />
            </label>
            <button disabled={busy || !repository.trim()} className="spr-btn spr-btn-primary w-full justify-center disabled:opacity-50"><Github className="h-4 w-4" /> {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Start repository review <ArrowRight className="h-4 w-4" /></>}</button>
          </form>
        </section>
      ) : (
        <section className="spr-panel p-6">
          <div onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }} onClick={() => inputRef.current?.click()} className={`cursor-pointer rounded-2xl border-2 border-dashed p-12 text-center transition ${dragging ? 'border-[var(--spr-highlight)] bg-[var(--spr-accent-soft)]' : 'border-[var(--spr-border)] hover:border-[var(--spr-highlight)]/50'}`}>
            <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.currentTarget.value = ''; }} />
            <Upload className="mx-auto h-10 w-10 text-[var(--spr-highlight)]" />
            <div className="mt-4 text-lg font-semibold">Drop software or evidence files here</div>
            <div className="mt-2 text-sm text-[var(--spr-text-muted)]">Up to 100 files per intake • 50 MB per file • ZIP/SBOM/source/evidence supported</div>
            <div className="mt-4 inline-flex rounded-lg border border-[var(--spr-border)] px-4 py-2 text-sm font-semibold">Browse files</div>
          </div>
          {files.length > 0 && <div className="mt-5 space-y-2">{files.map((file) => <div key={`${file.name}-${file.size}-${file.lastModified}`} className="flex items-center justify-between rounded-xl border border-[var(--spr-border)] p-3"><div className="min-w-0"><div className="truncate text-sm font-semibold">{file.name}</div><div className="text-xs text-[var(--spr-text-faint)]">{(file.size / 1024 / 1024).toFixed(2)} MB • {classifyFile(file)}</div></div><CheckCircle2 className="h-5 w-5 text-[var(--spr-highlight)]" /></div>)}</div>}
          <button onClick={() => void uploadFiles()} disabled={busy || files.length === 0} className="spr-btn spr-btn-primary mt-5 w-full justify-center disabled:opacity-50">{busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Uploading and verifying…</> : <><ShieldCheck className="h-4 w-4" /> Upload &amp; queue for analysis</>}</button>
        </section>
      )}

      {notice && <div role="alert" className={`rounded-xl border p-4 text-sm ${notice.kind === 'error' ? 'border-red-400/30 bg-red-400/10 text-red-200' : 'border-[var(--spr-highlight)]/30 bg-[var(--spr-accent-soft)] text-[var(--spr-text)]'}`}><AlertCircle className="mr-2 inline h-4 w-4" />{notice.text}</div>}

      <section className="spr-panel p-5">
        <div className="flex items-center justify-between"><div><div className="text-[10px] font-bold uppercase tracking-[.18em] text-[var(--spr-text-faint)]">Recent reviews</div><h2 className="mt-1 text-lg font-semibold">Scan history</h2></div><span className="text-xs text-[var(--spr-text-muted)]">{scans.length} records</span></div>
        <div className="mt-4 space-y-2">{scans.slice(0, 8).map((scan: any) => <div key={scan.id} className="flex items-center justify-between rounded-lg border border-[var(--spr-border)] p-3"><div><div className="text-sm font-semibold">{scan.name || scan.scanType || 'Software scan'}</div><div className="text-xs text-[var(--spr-text-faint)]">{scan.status || 'Unknown'}{scan.createdAt ? ` • ${new Date(scan.createdAt).toLocaleString()}` : ''}</div></div><span className="text-xs font-mono text-[var(--spr-text-muted)]">{scan.id}</span></div>)}{scans.length === 0 && <div className="py-8 text-center text-sm text-[var(--spr-text-muted)]">No reviews yet. Start your first one above.</div>}</div>
      </section>
    </div>
  );
}
