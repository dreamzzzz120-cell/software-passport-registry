import { useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, FileArchive, Github, Loader2, ShieldCheck, Upload } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

const MAX_FILES = 100;
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_SIZE_BYTES = 500 * 1024 * 1024;

function classifyFile(file: File): 'software' | 'document' | 'sbom' | 'archive' | 'unknown' {
  const name = file.name.toLowerCase();
  if (/\.(zip|tar|gz|tgz)$/.test(name)) return 'archive';
  if (/\.(json|xml|spdx)$/.test(name) && /(sbom|cyclonedx|spdx|bom)/i.test(name)) return 'sbom';
  if (/\.(pdf|doc|docx|txt|md)$/.test(name)) return 'document';
  if (/\.(js|ts|tsx|jsx|py|go|rs|java|cs|cpp|c|rb|php|yml|yaml|toml|lock)$/.test(name)) return 'software';
  return 'unknown';
}

async function digest(file: File) {
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default function NewReviewIntake() {
  const [mode, setMode] = useState<'repository' | 'files'>('repository');
  const [repository, setRepository] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (list: FileList | File[]) => {
    const incoming = Array.from(list);
    const invalid = incoming.find((file) => file.size > MAX_FILE_SIZE_BYTES);
    if (invalid) {
      setError(`${invalid.name} exceeds the 50 MB per-file limit.`);
      setMessage('');
      return;
    }

    setFiles((current) => {
      const deduped = incoming.filter((file) => !current.some((existing) =>
        existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified,
      ));
      const next = [...current, ...deduped];
      if (next.length > MAX_FILES) {
        setError(`You can upload at most ${MAX_FILES} files per review.`);
        return current;
      }
      if (next.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_SIZE_BYTES) {
        setError('The combined upload size cannot exceed 500 MB per review.');
        return current;
      }
      return next;
    });
    setError('');
    setMessage('');
  };

  const startRepository = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const raw = repository.trim();
      const url = new URL(raw.includes('://') ? raw : `https://github.com/${raw}`);
      if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.username || url.password || url.port) {
        throw new Error('Enter a GitHub repository URL or owner/repository.');
      }
      const parts = url.pathname.split('/').filter(Boolean).map((part) => part.replace(/\.git$/, ''));
      if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_.-]{1,100}$/.test(part))) {
        throw new Error('Use owner/repository, for example acme/my-app.');
      }
      const response = await apiFetch('/api/free-review/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner: parts[0], repository: parts[1] }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || 'Could not start the repository review.');
      setMessage(`Repository review started for ${parts[0]}/${parts[1]}.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not start the repository review.'); }
    finally { setBusy(false); }
  };

  const upload = async () => {
    if (busy || files.length === 0) return;
    const totalSize = files.reduce((total, file) => total + file.size, 0);
    if (files.length > MAX_FILES || files.some((file) => file.size > MAX_FILE_SIZE_BYTES) || totalSize > MAX_TOTAL_SIZE_BYTES) {
      setError('Upload limits were exceeded. Maximums are 100 files, 50 MB per file, and 500 MB total.');
      return;
    }
    setBusy(true); setError(''); setMessage('');
    try {
      const sessionResponse = await apiFetch('/api/intake/session', { method: 'POST' });
      const session = await sessionResponse.json().catch(() => ({}));
      if (!sessionResponse.ok || typeof session?.sessionId !== 'string') throw new Error(session?.error || 'Could not create secure intake session.');
      for (const file of files) {
        const metadata = { name: file.name, size: file.size, contentType: file.type || 'application/octet-stream', kind: classifyFile(file) };
        const urlResponse = await apiFetch('/api/intake/upload-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: session.sessionId, file: metadata }) });
        const uploadData = await urlResponse.json().catch(() => ({}));
        if (!urlResponse.ok || typeof uploadData?.signedUrl !== 'string') throw new Error(uploadData?.error || `Could not prepare ${file.name}.`);
        const put = await fetch(uploadData.signedUrl, { method: 'PUT', headers: { 'Content-Type': metadata.contentType }, body: file });
        if (!put.ok) throw new Error(`Upload failed for ${file.name}.`);
        const complete = await apiFetch('/api/intake/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: session.sessionId, itemId: uploadData.itemId, sha256: await digest(file) }) });
        if (!complete.ok) { const body = await complete.json().catch(() => ({})); throw new Error(body?.error || `Could not finalize ${file.name}.`); }
      }
      const claim = await apiFetch('/api/intake/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: session.sessionId }) });
      if (!claim.ok) { const body = await claim.json().catch(() => ({})); throw new Error(body?.error || 'Files uploaded but could not attach them to this workspace.'); }
      setFiles([]); setMessage('Upload complete. SHA-256 was recorded and the files are queued for SPR analysis.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Upload failed.'); }
    finally { setBusy(false); }
  };

  return <section className="spr-panel p-5 md:p-6" aria-label="Start a new software review">
    <div className="flex flex-col gap-1"><div className="text-[10px] font-bold uppercase tracking-[.2em] text-[var(--spr-highlight)]">New review</div><h2 className="text-xl font-bold text-[var(--spr-text)]">Submit software for analysis</h2><p className="max-w-3xl text-sm text-[var(--spr-text-muted)]">Choose a GitHub repository or upload software and evidence files. Uploads are finalized with SHA-256 before they enter the analysis queue.</p></div>
    <div className="mt-5 grid gap-3 md:grid-cols-2">
      <button type="button" onClick={() => { setMode('repository'); setError(''); setMessage(''); }} className={`rounded-xl border p-4 text-left ${mode === 'repository' ? 'border-[var(--spr-highlight)] bg-[var(--spr-accent-soft)]' : 'border-[var(--spr-border)]'}`}><Github className="h-5 w-5 text-[var(--spr-highlight)]" /><div className="mt-2 text-sm font-bold">Connect repository</div><div className="mt-1 text-xs text-[var(--spr-text-muted)]">Public GitHub repository review.</div></button>
      <button type="button" onClick={() => { setMode('files'); setError(''); setMessage(''); }} className={`rounded-xl border p-4 text-left ${mode === 'files' ? 'border-[var(--spr-highlight)] bg-[var(--spr-accent-soft)]' : 'border-[var(--spr-border)]'}`}><FileArchive className="h-5 w-5 text-[var(--spr-highlight)]" /><div className="mt-2 text-sm font-bold">Upload files</div><div className="mt-1 text-xs text-[var(--spr-text-muted)]">SBOMs, ZIPs, source, manifests and evidence.</div></button>
    </div>
    {mode === 'repository' ? <form onSubmit={startRepository} className="mt-5 flex flex-col gap-3 md:flex-row"><input value={repository} onChange={(e) => setRepository(e.target.value)} placeholder="owner/repository or GitHub URL" className="min-w-0 flex-1 rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-4 py-3 text-sm outline-none focus:border-[var(--spr-highlight)]" /><button disabled={busy || !repository.trim()} className="spr-btn spr-btn-primary justify-center disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><span>Start review</span><ArrowRight className="h-4 w-4" /></>}</button></form> : <div className="mt-5"><div onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }} onClick={() => inputRef.current?.click()} className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center ${dragging ? 'border-[var(--spr-highlight)] bg-[var(--spr-accent-soft)]' : 'border-[var(--spr-border)] hover:border-[var(--spr-highlight)]/50'}`}><input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.currentTarget.value = ''; }} /><Upload className="mx-auto h-8 w-8 text-[var(--spr-highlight)]" /><div className="mt-3 text-sm font-bold">Drop files here or click to browse</div><div className="mt-1 text-xs text-[var(--spr-text-muted)]">100 files max • 50 MB per file • 500 MB total</div></div>{files.length > 0 && <div className="mt-3 space-y-2">{files.map((file) => <div key={`${file.name}-${file.size}-${file.lastModified}`} className="flex items-center justify-between rounded-lg border border-[var(--spr-border)] px-3 py-2"><div className="min-w-0"><div className="truncate text-xs font-semibold">{file.name}</div><div className="text-[10px] text-[var(--spr-text-faint)]">{(file.size / 1024 / 1024).toFixed(2)} MB • {classifyFile(file)}</div></div><CheckCircle2 className="h-4 w-4 text-[var(--spr-highlight)]" /></div>)}</div>}<button type="button" onClick={() => void upload()} disabled={busy || files.length === 0} className="spr-btn spr-btn-primary mt-3 w-full justify-center disabled:opacity-50">{busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Uploading and verifying…</> : <><ShieldCheck className="h-4 w-4" /> Upload &amp; queue analysis</>}</button></div>}
    {message && <div className="mt-4 rounded-lg border border-[var(--spr-highlight)]/30 bg-[var(--spr-accent-soft)] p-3 text-xs text-[var(--spr-text)]">{message}</div>}
    {error && <div role="alert" className="mt-4 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-xs text-red-200">{error}</div>}
  </section>;
}
