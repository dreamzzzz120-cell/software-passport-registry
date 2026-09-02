/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Import Client System — the guided wrapper around the existing Universal Intake
 * backend. It creates no new API surface: every step calls a route that already
 * exists and is already authenticated, tenant-scoped and validated.
 *
 *   GET  /api/user/clients      requireAuth                     list clients
 *   POST /api/user/clients      requireAuth + Owner/Admin       create a client
 *   POST /api/intake/session    anonymous, 24h quarantine       open a session
 *   POST /api/intake/upload-url anonymous, signed URL           per-file location
 *   PUT  <signed URL>           Supabase, expiring              the bytes
 *   POST /api/intake/complete   anonymous                       record + checksum
 *   POST /api/intake/claim      requireAuth                     attach to workspace
 *
 * Honesty note, deliberately load-bearing: claiming an intake sets the tenant on
 * the session and moves uploaded items to QUEUED. It does not, today, identify
 * software, mint passports, run analysis or build trust observations. The
 * progress checklist below therefore lists only the five things that actually
 * happen, and the result screen says plainly what has not happened yet. Showing
 * a "Creating passports" tick that nothing performs would be exactly the
 * fabricated-evidence failure this product exists to prevent.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, FileText, Loader2, Package, Plus, ShieldAlert, Trash2, Upload, X } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

type Kind = 'software' | 'document' | 'sbom' | 'archive' | 'unknown';
type Client = { id: string; name: string; domain?: string | null; industry?: string | null };
type Staged = {
  file: File;
  kind: Kind;
  status: 'pending' | 'uploading' | 'uploaded' | 'failed';
  itemId?: string;
  error?: string;
};

// Mirrors the `kind` enum in migrations/0055 and the zod schema in
// src/routes/universal-intake.ts. Nothing is offered here that the backend
// would reject, and no format is implied that SPR cannot accept.
const KINDS: { kind: Kind; title: string; blurb: string; icon: React.ReactNode }[] = [
  { kind: 'sbom', title: 'SBOM', blurb: 'CycloneDX or SPDX, in JSON or XML.', icon: <FileText className="h-5 w-5" /> },
  { kind: 'software', title: 'Software files', blurb: 'Builds, packages or application files.', icon: <Package className="h-5 w-5" /> },
  { kind: 'document', title: 'Security & compliance evidence', blurb: 'Policies, reports, questionnaires, attestations.', icon: <FileText className="h-5 w-5" /> },
  { kind: 'archive', title: 'Archive', blurb: 'A zip or tarball containing several of the above.', icon: <Package className="h-5 w-5" /> },
  { kind: 'unknown', title: 'Something else', blurb: 'Not sure what it is? Upload it and label it later.', icon: <FileText className="h-5 w-5" /> },
];

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_FILES = 100;

function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function sha256Hex(file: File): Promise<string | null> {
  // Best effort: the API accepts a null checksum. crypto.subtle is unavailable on
  // insecure origins, and very large files are skipped rather than freezing the tab.
  try {
    if (!globalThis.crypto?.subtle || file.size > 64 * 1024 * 1024) return null;
    const digest = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

type Step = 1 | 2 | 3 | 4 | 5;

export default function ImportClientSystemView({ onNavigate, onSelectClient, preselectedClientId }: {
  onNavigate: (tab: string) => void;
  onSelectClient?: (id: string) => void;
  preselectedClientId?: string | null;
}) {
  const [step, setStep] = useState<Step>(1);
  const [clients, setClients] = useState<Client[] | null>(null);
  const [clientsError, setClientsError] = useState('');
  const [clientId, setClientId] = useState<string | null>(preselectedClientId ?? null);
  const [creating, setCreating] = useState(false);
  const [newClient, setNewClient] = useState({ name: '', domain: '', industry: '' });
  const [createError, setCreateError] = useState('');
  const [chosen, setChosen] = useState<Kind[]>([]);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [busy, setBusy] = useState(false);
  const [fatal, setFatal] = useState('');
  const [done, setDone] = useState<{ sessionId: string; uploaded: number; failed: number } | null>(null);
  const [progress, setProgress] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await apiFetch('/api/user/clients');
        if (!res.ok) throw new Error(`Clients could not be loaded (HTTP ${res.status}).`);
        const body = await res.json();
        if (live) setClients(Array.isArray(body) ? body : body?.clients ?? []);
      } catch (err) {
        if (live) { setClients([]); setClientsError(err instanceof Error ? err.message : 'Clients could not be loaded.'); }
      }
    })();
    return () => { live = false; };
  }, []);

  // Move focus to the new step heading so the flow is followable without a mouse.
  useEffect(() => { headingRef.current?.focus(); }, [step]);

  const client = useMemo(() => clients?.find((c) => c.id === clientId) ?? null, [clients, clientId]);

  const addFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    const defaultKind: Kind = chosen[0] ?? 'unknown';
    const next: Staged[] = [];
    for (const file of Array.from(files)) {
      if (staged.length + next.length >= MAX_FILES) break;
      next.push({
        file,
        kind: defaultKind,
        status: file.size > MAX_FILE_BYTES ? 'failed' : 'pending',
        error: file.size > MAX_FILE_BYTES ? `Too large. The limit is ${humanSize(MAX_FILE_BYTES)}.` : undefined,
      });
    }
    setStaged((prev) => [...prev, ...next]);
  }, [chosen, staged.length]);

  async function createClient() {
    setCreateError('');
    if (!newClient.name.trim() || !newClient.domain.trim() || !newClient.industry.trim()) {
      setCreateError('Name, domain and industry are all required.');
      return;
    }
    setCreating(true);
    try {
      const res = await apiFetch('/api/user/clients', { method: 'POST', body: JSON.stringify({ name: newClient.name.trim(), domain: newClient.domain.trim().toLowerCase(), industry: newClient.industry.trim() }) });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || `The client could not be created (HTTP ${res.status}).`);
      const created: Client = body?.client ?? body;
      setClients((prev) => [...(prev ?? []), created]);
      setClientId(created.id);
      setNewClient({ name: '', domain: '', industry: '' });
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'The client could not be created.');
    } finally {
      setCreating(false);
    }
  }

  async function runImport() {
    if (!clientId) return;
    setBusy(true); setFatal(''); setProgress([]); setStep(4);
    const note = (line: string) => setProgress((prev) => [...prev, line]);
    try {
      note('Opening a secure intake session');
      const sessionRes = await apiFetch('/api/intake/session', { method: 'POST' });
      const sessionBody = await sessionRes.json().catch(() => null);
      if (!sessionRes.ok || !sessionBody?.sessionId) throw new Error(sessionBody?.error || 'The intake session could not be created.');
      const sessionId: string = sessionBody.sessionId;

      let uploaded = 0; let failed = 0;
      const uploadable = staged.filter((s) => s.status !== 'failed');
      note(`Uploading ${uploadable.length} file${uploadable.length === 1 ? '' : 's'} to quarantine storage`);

      for (const item of uploadable) {
        setStaged((prev) => prev.map((s) => (s === item ? { ...s, status: 'uploading' } : s)));
        try {
          const urlRes = await apiFetch('/api/intake/upload-url', { method: 'POST', body: JSON.stringify({ sessionId, file: { name: item.file.name, size: item.file.size, contentType: item.file.type || 'application/octet-stream', kind: item.kind } }) });
          const urlBody = await urlRes.json().catch(() => null);
          if (!urlRes.ok || !urlBody?.signedUrl) throw new Error(urlBody?.error || `Upload was refused (HTTP ${urlRes.status}).`);

          const put = await fetch(urlBody.signedUrl, { method: 'PUT', headers: { 'Content-Type': item.file.type || 'application/octet-stream' }, body: item.file });
          if (!put.ok) throw new Error(`The file could not be stored (HTTP ${put.status}).`);

          const completeRes = await apiFetch('/api/intake/complete', { method: 'POST', body: JSON.stringify({ sessionId, itemId: urlBody.itemId, sha256: await sha256Hex(item.file) }) });
          if (!completeRes.ok) {
            const completeBody = await completeRes.json().catch(() => null);
            throw new Error(completeBody?.error || `The upload could not be recorded (HTTP ${completeRes.status}).`);
          }
          uploaded += 1;
          setStaged((prev) => prev.map((s) => (s === item ? { ...s, status: 'uploaded', itemId: urlBody.itemId } : s)));
        } catch (err) {
          failed += 1;
          const message = err instanceof Error ? err.message : 'Upload failed.';
          setStaged((prev) => prev.map((s) => (s === item ? { ...s, status: 'failed', error: message } : s)));
        }
      }

      note('Recording each file with its checksum');
      note('Attaching the intake to your workspace');
      const claimRes = await apiFetch('/api/intake/claim', { method: 'POST', body: JSON.stringify({ sessionId }) });
      if (!claimRes.ok) {
        const claimBody = await claimRes.json().catch(() => null);
        throw new Error(claimBody?.error || `The intake could not be attached to your workspace (HTTP ${claimRes.status}).`);
      }
      note('Queued for processing');
      setDone({ sessionId, uploaded, failed });
      setStep(5);
    } catch (err) {
      setFatal(err instanceof Error ? err.message : 'The import could not be completed.');
      setStep(3);
    } finally {
      setBusy(false);
    }
  }

  const crumb = ['Trust Network', client ? client.name : 'Client', 'Import system'];
  const canContinueFrom1 = Boolean(clientId);
  const uploadableCount = staged.filter((s) => s.status !== 'failed').length;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <nav aria-label="Breadcrumb" className="mb-4">
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--spr-text-faint)]">
          {crumb.map((c, i) => (
            <li key={c + i} className="flex items-center gap-2">
              {i > 0 && <span aria-hidden="true">/</span>}
              <span className={i === crumb.length - 1 ? 'font-semibold text-[var(--spr-text-muted)]' : ''}>{c}</span>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold tracking-tight text-[var(--spr-text)] outline-none md:text-3xl">Import client system</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--spr-text-muted)]">
            Bring the software evidence you already have. SPR stores it against one client and organizes it into a single trust view.
          </p>
        </div>
        <button onClick={() => onNavigate('/msp')} className="shrink-0 rounded-lg border border-[var(--spr-border)] px-3 py-2 text-xs font-semibold text-[var(--spr-text-muted)] hover:bg-[var(--spr-surface-hover)]" aria-label="Cancel import and return to Trust Network">Cancel</button>
      </div>

      <ol className="mb-8 flex flex-wrap gap-2" aria-label="Progress">
        {[[1, 'Client'], [2, 'What you have'], [3, 'Upload'], [4, 'Processing'], [5, 'Done']].map(([n, label]) => (
          <li key={String(n)} className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${step === n ? 'border-[var(--spr-highlight)] bg-[var(--spr-accent-soft)]/30 text-[var(--spr-highlight)]' : step > (n as number) ? 'border-[var(--spr-border)] text-[var(--spr-text-muted)]' : 'border-[var(--spr-border)] text-[var(--spr-text-faint)]'}`} aria-current={step === n ? 'step' : undefined}>
            {step > (n as number) ? <Check className="mr-1 inline h-3 w-3" aria-hidden="true" /> : null}{String(n)}. {label}
          </li>
        ))}
      </ol>

      {fatal && (
        <div role="alert" className="mb-6 flex items-start gap-3 rounded-lg border border-[var(--spr-red)]/50 bg-[var(--spr-red)]/10 p-4 text-sm text-[var(--spr-text)]">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--spr-red)]" aria-hidden="true" />
          <span>{fatal}</span>
        </div>
      )}

      {step === 1 && (
        <section className="spr-panel p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-[var(--spr-text)]">Who is this system for?</h2>
          <p className="mt-1 text-sm text-[var(--spr-text-muted)]">Everything you upload is stored against this client and only this client.</p>
          {clientsError && <p role="alert" className="mt-3 text-sm text-[var(--spr-red)]">{clientsError}</p>}
          {clients === null ? (
            <p className="mt-5 flex items-center gap-2 text-sm text-[var(--spr-text-muted)]"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading your clients…</p>
          ) : (
            <>
              {clients.length > 0 && (
                <ul className="mt-5 grid gap-2" role="radiogroup" aria-label="Select a client">
                  {clients.map((c) => (
                    <li key={c.id}>
                      <button role="radio" aria-checked={clientId === c.id} onClick={() => setClientId(c.id)} className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition ${clientId === c.id ? 'border-[var(--spr-highlight)] bg-[var(--spr-accent-soft)]/20' : 'border-[var(--spr-border)] hover:bg-[var(--spr-surface-hover)]'}`}>
                        <span>
                          <span className="block text-sm font-semibold text-[var(--spr-text)]">{c.name}</span>
                          {c.domain && <span className="block text-xs text-[var(--spr-text-faint)]">{c.domain}</span>}
                        </span>
                        {clientId === c.id && <Check className="h-4 w-4 text-[var(--spr-highlight)]" aria-hidden="true" />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-6 rounded-lg border border-dashed border-[var(--spr-border)] p-4">
                <h3 className="text-sm font-semibold text-[var(--spr-text)]">{clients.length === 0 ? 'Create your first client' : 'Or create a new client'}</h3>
                <p className="mt-1 text-xs text-[var(--spr-text-faint)]">A client is the organization the software belongs to.</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <label className="block"><span className="mb-1 block text-[11px] font-semibold text-[var(--spr-text-muted)]">Name</span><input value={newClient.name} onChange={(e) => setNewClient({ ...newClient, name: e.target.value })} placeholder="Acme Corp" className="w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-sm text-[var(--spr-text)]" /></label>
                  <label className="block"><span className="mb-1 block text-[11px] font-semibold text-[var(--spr-text-muted)]">Domain</span><input value={newClient.domain} onChange={(e) => setNewClient({ ...newClient, domain: e.target.value })} placeholder="acme.com" className="w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-sm text-[var(--spr-text)]" /></label>
                  <label className="block"><span className="mb-1 block text-[11px] font-semibold text-[var(--spr-text-muted)]">Industry</span><input value={newClient.industry} onChange={(e) => setNewClient({ ...newClient, industry: e.target.value })} placeholder="Healthcare" className="w-full rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-3 py-2 text-sm text-[var(--spr-text)]" /></label>
                </div>
                {createError && <p role="alert" className="mt-2 text-xs text-[var(--spr-red)]">{createError}</p>}
                <button onClick={() => void createClient()} disabled={creating} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[var(--spr-border)] px-4 py-2 text-sm font-semibold text-[var(--spr-text)] hover:bg-[var(--spr-surface-hover)] disabled:opacity-50">
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
                  {creating ? 'Creating…' : 'Create client'}
                </button>
              </div>
            </>
          )}
          <div className="mt-6 flex justify-end">
            <button onClick={() => setStep(2)} disabled={!canContinueFrom1} className="inline-flex items-center gap-2 rounded-xl bg-[var(--spr-accent)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--spr-accent-hover)] disabled:opacity-40">Continue <ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="spr-panel p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-[var(--spr-text)]">What do you have?</h2>
          <p className="mt-1 text-sm text-[var(--spr-text-muted)]">Pick anything that applies. You can upload several kinds of evidence for one system.</p>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {KINDS.map((k) => {
              const on = chosen.includes(k.kind);
              return (
                <li key={k.kind}>
                  <button aria-pressed={on} onClick={() => setChosen((prev) => (on ? prev.filter((x) => x !== k.kind) : [...prev, k.kind]))} className={`flex h-full w-full items-start gap-3 rounded-xl border p-4 text-left transition ${on ? 'border-[var(--spr-highlight)] bg-[var(--spr-accent-soft)]/20' : 'border-[var(--spr-border)] hover:bg-[var(--spr-surface-hover)]'}`}>
                    <span className="mt-0.5 text-[var(--spr-highlight)]" aria-hidden="true">{k.icon}</span>
                    <span>
                      <span className="block text-sm font-semibold text-[var(--spr-text)]">{k.title}</span>
                      <span className="mt-1 block text-xs leading-5 text-[var(--spr-text-faint)]">{k.blurb}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-5 rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-3 text-xs leading-5 text-[var(--spr-text-faint)]">
            SPR only receives what you upload here. It does not reach into source code, private repositories, cloud accounts or production servers unless you connect those separately.
          </p>
          <div className="mt-6 flex justify-between">
            <button onClick={() => setStep(1)} className="inline-flex items-center gap-2 rounded-lg border border-[var(--spr-border)] px-4 py-2.5 text-sm font-semibold text-[var(--spr-text)] hover:bg-[var(--spr-surface-hover)]"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back</button>
            <button onClick={() => setStep(3)} className="inline-flex items-center gap-2 rounded-xl bg-[var(--spr-accent)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--spr-accent-hover)]">Continue <ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="spr-panel p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-[var(--spr-text)]">Upload your evidence</h2>
          <p className="mt-1 text-sm text-[var(--spr-text-muted)]">Up to {MAX_FILES} files, {humanSize(MAX_FILE_BYTES)} each. Files go straight to private quarantine storage.</p>

          <div className="mt-5 rounded-xl border border-dashed border-[var(--spr-border)] p-6 text-center">
            <Upload className="mx-auto h-6 w-6 text-[var(--spr-text-faint)]" aria-hidden="true" />
            <button onClick={() => fileInput.current?.click()} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[var(--spr-accent)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--spr-accent-hover)]">Choose files</button>
            <input ref={fileInput} type="file" multiple className="sr-only" aria-label="Choose files to upload" onChange={(e) => { addFiles(e.target.files); e.currentTarget.value = ''; }} />
            <p className="mt-2 text-xs text-[var(--spr-text-faint)]">You can add more than one file.</p>
          </div>

          {staged.length > 0 && (
            <ul className="mt-5 grid gap-2">
              {staged.map((s, i) => (
                <li key={`${s.file.name}-${i}`} className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--spr-border)] px-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-[var(--spr-text)]">{s.file.name}</span>
                    <span className="block text-[11px] text-[var(--spr-text-faint)]">{humanSize(s.file.size)} · {s.kind}</span>
                    {s.error && <span role="alert" className="mt-0.5 block text-[11px] text-[var(--spr-red)]">{s.error}</span>}
                  </span>
                  <select aria-label={`Evidence type for ${s.file.name}`} value={s.kind} onChange={(e) => setStaged((prev) => prev.map((x, xi) => (xi === i ? { ...x, kind: e.target.value as Kind } : x)))} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] px-2 py-1.5 text-xs text-[var(--spr-text)]">
                    {KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.title}</option>)}
                  </select>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--spr-text-faint)]" aria-live="polite">
                    {s.status === 'uploading' ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Uploading" /> : s.status === 'uploaded' ? <Check className="h-4 w-4 text-[var(--spr-green,#3fb950)]" aria-label="Uploaded" /> : s.status === 'failed' ? 'Failed' : 'Ready'}
                  </span>
                  <button onClick={() => setStaged((prev) => prev.filter((_, xi) => xi !== i))} aria-label={`Remove ${s.file.name}`} className="rounded-md border border-[var(--spr-border)] p-1.5 text-[var(--spr-text-faint)] hover:bg-[var(--spr-surface-hover)]"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-6 flex flex-wrap justify-between gap-3">
            <button onClick={() => setStep(2)} className="inline-flex items-center gap-2 rounded-lg border border-[var(--spr-border)] px-4 py-2.5 text-sm font-semibold text-[var(--spr-text)] hover:bg-[var(--spr-surface-hover)]"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back</button>
            <button onClick={() => void runImport()} disabled={busy || uploadableCount === 0} className="inline-flex items-center gap-2 rounded-xl bg-[var(--spr-accent)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--spr-accent-hover)] disabled:opacity-40">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Import {uploadableCount > 0 ? `${uploadableCount} file${uploadableCount === 1 ? '' : 's'}` : ''}
            </button>
          </div>
        </section>
      )}

      {step === 4 && (
        <section className="spr-panel p-5 sm:p-6" aria-busy="true">
          <h2 className="text-lg font-semibold text-[var(--spr-text)]">SPR is receiving your system</h2>
          <p className="mt-1 text-sm text-[var(--spr-text-muted)]">Keep this tab open until it finishes.</p>
          <ul className="mt-5 grid gap-2" aria-live="polite">
            {progress.map((line, i) => (
              <li key={line + i} className="flex items-center gap-3 text-sm text-[var(--spr-text)]">
                {i === progress.length - 1 && busy ? <Loader2 className="h-4 w-4 animate-spin text-[var(--spr-highlight)]" aria-hidden="true" /> : <Check className="h-4 w-4 text-[var(--spr-green,#3fb950)]" aria-hidden="true" />}
                {line}
              </li>
            ))}
          </ul>
        </section>
      )}

      {step === 5 && done && (
        <section className="spr-panel p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-[var(--spr-text)]">System received</h2>
          <p className="mt-1 text-sm text-[var(--spr-text-muted)]">
            {done.uploaded} file{done.uploaded === 1 ? '' : 's'} stored against <strong>{client?.name ?? 'this client'}</strong>
            {done.failed > 0 ? `, ${done.failed} failed` : ''}.
          </p>

          <dl className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-[var(--spr-border)] p-3"><dt className="text-[11px] uppercase tracking-wide text-[var(--spr-text-faint)]">Client</dt><dd className="mt-1 text-sm font-semibold text-[var(--spr-text)]">{client?.name ?? '—'}</dd></div>
            <div className="rounded-lg border border-[var(--spr-border)] p-3"><dt className="text-[11px] uppercase tracking-wide text-[var(--spr-text-faint)]">Files stored</dt><dd className="mt-1 text-sm font-semibold text-[var(--spr-text)]">{done.uploaded}</dd></div>
            <div className="rounded-lg border border-[var(--spr-border)] p-3"><dt className="text-[11px] uppercase tracking-wide text-[var(--spr-text-faint)]">Failed</dt><dd className="mt-1 text-sm font-semibold text-[var(--spr-text)]">{done.failed}</dd></div>
          </dl>

          {/* Deliberately not claiming passports, findings or a trust state here.
              Claiming an intake queues the evidence; it does not yet mint software
              records or run analysis. Saying otherwise would be a fabricated result. */}
          <p className="mt-5 rounded-lg border border-[var(--spr-border)] bg-[var(--spr-surface-sunken)] p-3 text-xs leading-5 text-[var(--spr-text-faint)]">
            Your evidence is stored and queued against this client. Software assets, passports and trust results are not created by the upload itself — they appear as SPR processes the queue and as you register software. Nothing here is scored yet.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <button onClick={() => { if (clientId) onSelectClient?.(clientId); onNavigate('/clients'); }} className="inline-flex items-center gap-2 rounded-xl bg-[var(--spr-accent)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[var(--spr-accent-hover)]">View client <ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
            <button onClick={() => onNavigate('/assets')} className="rounded-lg border border-[var(--spr-border)] px-4 py-2.5 text-sm font-semibold text-[var(--spr-text)] hover:bg-[var(--spr-surface-hover)]">View software</button>
            <button onClick={() => onNavigate('/passports')} className="rounded-lg border border-[var(--spr-border)] px-4 py-2.5 text-sm font-semibold text-[var(--spr-text)] hover:bg-[var(--spr-surface-hover)]">View passports</button>
            <button onClick={() => onNavigate('/evidence-explorer')} className="rounded-lg border border-[var(--spr-border)] px-4 py-2.5 text-sm font-semibold text-[var(--spr-text)] hover:bg-[var(--spr-surface-hover)]">View evidence</button>
          </div>
        </section>
      )}
    </div>
  );
}
