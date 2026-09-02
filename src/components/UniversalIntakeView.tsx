import React, { useMemo, useRef, useState } from 'react';
import { Archive, ArrowRight, CheckCircle2, FileText, FolderOpen, Github, HardDriveUpload, ShieldCheck, Sparkles, X } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

const MAX_STAGED_FILES = 100;
const MAX_STAGED_FILE_SIZE = 100 * 1024 * 1024;
const STAGED_KEY = 'spr-universal-intake-v1';

type IntakeItem = { name: string; size: number; type: string; lastModified: number; kind: 'software' | 'document' | 'sbom' | 'archive' | 'unknown' };

function classify(name: string, type: string): IntakeItem['kind'] {
  const n = name.toLowerCase();
  if (/\.(zip|tar|tgz|gz|7z|rar)$/.test(n)) return 'archive';
  if (/(sbom|cyclonedx|spdx)/.test(n) || /\.(cdx|spdx)(\.json)?$/.test(n)) return 'sbom';
  if (/\.(pdf|doc|docx|xls|xlsx|csv|txt|rtf|md|png|jpg|jpeg|webp|tif|tiff)$/.test(n) || /pdf|word|spreadsheet|text|image/.test(type)) return 'document';
  if (/\.(js|jsx|ts|tsx|py|go|rs|java|kt|swift|php|rb|cs|cpp|c|h|json|yaml|yml|xml|toml|ini|env|lock|sql|sh|ps1|dockerfile)$/.test(n)) return 'software';
  return 'unknown';
}

export default function UniversalIntakeView({ onContinue }: { onContinue?: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<IntakeItem[]>([]);
  const [repo, setRepo] = useState('');
  const [dragging, setDragging] = useState(false);
  const [repoLoading, setRepoLoading] = useState(false);
  const [repoMessage, setRepoMessage] = useState('');
  const [saved, setSaved] = useState(false);

  const summary = useMemo(() => {
    const counts = { software: 0, document: 0, sbom: 0, archive: 0, unknown: 0 };
    items.forEach(item => { counts[item.kind] += 1; });
    return counts;
  }, [items]);

  const addFiles = (files: FileList | File[]) => {
    const next = Array.from(files).slice(0, MAX_STAGED_FILES);
    const accepted: IntakeItem[] = [];
    const rejected: string[] = [];
    for (const file of next) {
      if (file.size > MAX_STAGED_FILE_SIZE) { rejected.push(`${file.name}: larger than 100 MB`); continue; }
      accepted.push({ name: file.name, size: file.size, type: file.type || 'application/octet-stream', lastModified: file.lastModified, kind: classify(file.name, file.type) });
    }
    setItems(prev => [...prev, ...accepted].slice(0, MAX_STAGED_FILES));
    setSaved(false);
    if (rejected.length) setRepoMessage(`Skipped ${rejected.length} file(s): ${rejected.join(', ')}`);
  };

  const saveStagedIntake = () => {
    const payload = { version: 1, createdAt: new Date().toISOString(), repo: repo.trim(), items };
    sessionStorage.setItem(STAGED_KEY, JSON.stringify(payload));
    setSaved(true);
    onContinue?.();
  };

  const runRepositoryReview = async () => {
    const value = repo.trim();
    const match = value.match(/github\.com\/([^/]+)\/([^/#?]+)(?:[/?#]|$)/i);
    if (!match) { setRepoMessage('Enter a GitHub repository URL, for example github.com/company/product.'); return; }
    const owner = match[1];
    const repository = match[2].replace(/\.git$/, '');
    setRepoLoading(true); setRepoMessage('Connecting to the repository and creating the real review job…');
    try {
      const response = await apiFetch('/api/free-review/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner, repository }) });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'The repository review could not be started.');
      setRepoMessage(`Review started for ${owner}/${repository}. SPR will inspect the repository rather than requiring you to create an SBOM first.`);
    } catch (error) {
      setRepoMessage(error instanceof Error ? error.message : 'Repository review failed to start.');
    } finally { setRepoLoading(false); }
  };

  return <div className="min-h-screen bg-[var(--spr-surface)] px-5 py-10 text-[var(--spr-text)]">
    <div className="mx-auto max-w-6xl">
      <div className="mb-10 max-w-3xl"><div className="inline-flex items-center gap-2 rounded-full border border-[var(--spr-highlight)]/30 bg-[var(--spr-accent-soft)]/20 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.18em] text-[var(--spr-highlight)]"><Sparkles className="h-3.5 w-3.5" /> Universal MSP Intake</div><h1 className="mt-5 text-4xl font-semibold tracking-tight md:text-6xl">VERIFY EVERYTHING.</h1><p className="mt-5 text-base leading-7 text-[var(--spr-text-muted)] md:text-lg">Give SPR what you already have. Connect a repository, upload a complete project, or bring in policies, contracts, security documents, compliance evidence and SBOMs.</p><p className="mt-3 text-sm font-semibold text-[var(--spr-text)]">You do not need to make an SBOM first.</p></div>
      <div className="grid gap-5 lg:grid-cols-3">
        <button onClick={() => fileInput.current?.click()} className="group rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6 text-left transition hover:-translate-y-0.5 hover:border-[var(--spr-highlight)]/50"><HardDriveUpload className="h-7 w-7 text-[var(--spr-highlight)]" /><h2 className="mt-5 text-lg font-semibold">Upload software</h2><p className="mt-2 text-sm leading-6 text-[var(--spr-text-muted)]">Files, source code, manifests, lockfiles, containers, packages, ZIPs and complete project exports.</p><span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold">Choose files <ArrowRight className="h-4 w-4" /></span></button>
        <button onClick={() => folderInput.current?.click()} className="group rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6 text-left transition hover:-translate-y-0.5 hover:border-[var(--spr-highlight)]/50"><FolderOpen className="h-7 w-7 text-[var(--spr-highlight)]" /><h2 className="mt-5 text-lg font-semibold">Scan a folder</h2><p className="mt-2 text-sm leading-6 text-[var(--spr-text-muted)]">Select a project folder in supported browsers. SPR records the files you choose for the intake.</p><span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold">Choose folder <ArrowRight className="h-4 w-4" /></span></button>
        <div className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6"><Github className="h-7 w-7 text-[var(--spr-highlight)]" /><h2 className="mt-5 text-lg font-semibold">Connect GitHub</h2><p className="mt-2 text-sm leading-6 text-[var(--spr-text-muted)]">Let the repository review inspect the software directly. No SBOM preparation required.</p><input value={repo} onChange={e => setRepo(e.target.value)} placeholder="https://github.com/company/repo" className="mt-5 w-full rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-4 py-3 text-sm outline-none focus:border-[var(--spr-highlight)]" /><button disabled={repoLoading} onClick={runRepositoryReview} className="mt-3 w-full rounded-xl bg-[var(--spr-accent)] px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{repoLoading ? 'Starting…' : 'Start repository review'}</button></div>
      </div>
      <div onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }} className={`mt-6 rounded-2xl border-2 border-dashed p-10 text-center transition ${dragging ? 'border-[var(--spr-highlight)] bg-[var(--spr-accent-soft)]/20' : 'border-[var(--spr-border)] bg-[var(--spr-surface-deep)]'}`}><Archive className="mx-auto h-9 w-9 text-[var(--spr-highlight)]" /><h2 className="mt-4 text-xl font-semibold">DROP EVERYTHING HERE</h2><p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-[var(--spr-text-muted)]">Software, ZIPs, SBOMs, policies, legal paperwork, questionnaires, certificates, security documents and other evidence can be staged together.</p><div className="mt-4 text-xs text-[var(--spr-text-faint)]">Up to 100 files • 100 MB per file • Nothing is executed by this intake screen</div></div>
      <input ref={fileInput} type="file" multiple className="hidden" onChange={e => e.target.files && addFiles(e.target.files)} /><input ref={folderInput} type="file" multiple className="hidden" {...({ webkitdirectory: '', directory: '' } as any)} onChange={e => e.target.files && addFiles(e.target.files)} />
      {(items.length > 0 || repo.trim()) && <section className="mt-8 rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-[10px] font-bold uppercase tracking-[.18em] text-[var(--spr-text-faint)]">Intake ready</div><h2 className="mt-1 text-xl font-semibold">{items.length} file(s){repo.trim() ? ' + 1 repository' : ''}</h2></div><button onClick={() => { setItems([]); setRepo(''); setSaved(false); sessionStorage.removeItem(STAGED_KEY); }} className="text-xs text-[var(--spr-text-muted)] hover:text-[var(--spr-text)]">Clear all</button></div><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">{Object.entries(summary).map(([key, value]) => <div key={key} className="rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] p-3"><div className="text-lg font-semibold">{value}</div><div className="text-[10px] uppercase tracking-wider text-[var(--spr-text-faint)]">{key}</div></div>)}</div><div className="mt-5 max-h-64 space-y-2 overflow-auto">{items.map((item, index) => <div key={`${item.name}-${index}`} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--spr-border)] px-3 py-2.5"><div className="flex min-w-0 items-center gap-3"><FileText className="h-4 w-4 shrink-0 text-[var(--spr-text-faint)]" /><span className="truncate text-sm">{item.name}</span></div><div className="flex shrink-0 items-center gap-2 text-[10px] uppercase text-[var(--spr-text-faint)]"><span>{item.kind}</span><button onClick={() => setItems(prev => prev.filter((_, i) => i !== index))} aria-label={`Remove ${item.name}`}><X className="h-4 w-4" /></button></div></div>)}</div><div className="mt-6 rounded-xl border border-[var(--spr-highlight)]/20 bg-[var(--spr-accent-soft)]/10 p-4"><div className="flex gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[var(--spr-highlight)]" /><div><div className="text-sm font-semibold">Evidence-first intake</div><p className="mt-1 text-xs leading-5 text-[var(--spr-text-muted)]">SPR should report what it can actually inspect. Unknown, unsupported or failed extraction stays visible as unknown or failed — never silently treated as verified.</p></div></div></div><button onClick={saveStagedIntake} className="mt-5 w-full rounded-xl bg-[var(--spr-accent)] px-5 py-3.5 text-sm font-bold text-white">{saved ? <><CheckCircle2 className="mr-2 inline h-4 w-4" />Intake staged — continue to SPR</> : <>Stage intake and continue <ArrowRight className="ml-1 inline h-4 w-4" /></>}</button></section>}
      {repoMessage && <div role="status" className="mt-5 rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4 text-sm text-[var(--spr-text-muted)]">{repoMessage}</div>}
      <div className="mt-10 flex flex-wrap gap-3 text-xs text-[var(--spr-text-faint)]"><span>Software</span><span>•</span><span>SBOM</span><span>•</span><span>Policies</span><span>•</span><span>Legal</span><span>•</span><span>Security</span><span>•</span><span>Compliance</span><span>•</span><span>Vendor evidence</span></div>
    </div>
  </div>;
}
