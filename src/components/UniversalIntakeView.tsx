import React, { useMemo, useRef, useState } from 'react';
import { Archive, ArrowRight, CheckCircle2, FileText, FolderOpen, Github, HardDriveUpload, Loader, ShieldCheck, Sparkles, X } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

const MAX_FILES = 100;
const MAX_SIZE = 100 * 1024 * 1024;
const STAGED_KEY = 'spr-universal-intake-v1';
type Kind = 'software' | 'document' | 'sbom' | 'archive' | 'unknown';
type Item = { name: string; size: number; type: string; kind: Kind; file: File; uploaded?: boolean; itemId?: string };

function classify(name: string, type: string): Kind {
  const n = name.toLowerCase();
  if (/\.(zip|tar|tgz|gz|7z|rar)$/.test(n)) return 'archive';
  if (/(sbom|cyclonedx|spdx)/.test(n) || /\.(cdx|spdx)(\.json)?$/.test(n)) return 'sbom';
  if (/\.(pdf|doc|docx|xls|xlsx|csv|txt|rtf|md|png|jpg|jpeg|webp|tif|tiff)$/.test(n) || /pdf|word|spreadsheet|text|image/.test(type)) return 'document';
  if (/\.(js|jsx|ts|tsx|py|go|rs|java|kt|swift|php|rb|cs|cpp|c|h|json|yaml|yml|xml|toml|ini|env|lock|sql|sh|ps1|dockerfile)$/.test(n)) return 'software';
  return 'unknown';
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export default function UniversalIntakeView({ onContinue }: { onContinue?: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [repo, setRepo] = useState('');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [sessionId, setSessionId] = useState('');

  const summary = useMemo(() => {
    const counts: Record<Kind, number> = { software: 0, document: 0, sbom: 0, archive: 0, unknown: 0 };
    items.forEach(i => counts[i.kind]++); return counts;
  }, [items]);

  const addFiles = (files: FileList | File[]) => {
    const accepted: Item[] = []; const rejected: string[] = [];
    for (const file of Array.from(files).slice(0, MAX_FILES)) {
      if (file.size > MAX_SIZE) { rejected.push(`${file.name}: over 100 MB`); continue; }
      accepted.push({ name: file.name, size: file.size, type: file.type || 'application/octet-stream', kind: classify(file.name, file.type), file });
    }
    setItems(prev => [...prev, ...accepted].slice(0, MAX_FILES));
    if (rejected.length) setMessage(`Skipped ${rejected.length} file(s): ${rejected.join(', ')}`);
  };

  const ensureSession = async () => {
    if (sessionId) return sessionId;
    const existing = sessionStorage.getItem(STAGED_KEY);
    try { const parsed = existing ? JSON.parse(existing) : null; if (parsed?.sessionId) { setSessionId(parsed.sessionId); return parsed.sessionId; } } catch {}
    const response = await apiFetch('/api/intake/session', { method: 'POST' });
    const data = await response.json();
    if (!response.ok || typeof data.sessionId !== 'string') throw new Error(data?.error || 'Could not create a secure intake session.');
    setSessionId(data.sessionId); return data.sessionId;
  };

  const uploadAll = async () => {
    if (busy || !items.length) return;
    setBusy(true); setMessage('Securing your intake…');
    try {
      const sid = await ensureSession();
      const uploaded: Array<{ name: string; itemId: string; size: number; kind: Kind }> = [];
      for (let index = 0; index < items.length; index++) {
        const item = items[index]; if (item.uploaded) continue;
        setMessage(`Uploading ${index + 1} of ${items.length}: ${item.name}`);
        const urlResponse = await apiFetch('/api/intake/upload-url', { method: 'POST', body: JSON.stringify({ sessionId: sid, file: { name: item.name, size: item.size, contentType: item.type, kind: item.kind } }) });
        const urlData = await urlResponse.json();
        if (!urlResponse.ok) throw new Error(urlData?.error || `Could not prepare ${item.name}.`);
        const put = await fetch(urlData.signedUrl, { method: 'PUT', headers: { 'Content-Type': item.type }, body: item.file });
        if (!put.ok) throw new Error(`Upload failed for ${item.name}.`);
        const hash = await sha256(item.file);
        const complete = await apiFetch('/api/intake/complete', { method: 'POST', body: JSON.stringify({ sessionId: sid, itemId: urlData.itemId, sha256: hash }) });
        if (!complete.ok) throw new Error(`SPR could not finalize ${item.name}.`);
        uploaded.push({ name: item.name, itemId: urlData.itemId, size: item.size, kind: item.kind });
        setItems(prev => prev.map(x => x === item ? { ...x, uploaded: true, itemId: urlData.itemId } : x));
      }
      sessionStorage.setItem(STAGED_KEY, JSON.stringify({ version: 2, createdAt: new Date().toISOString(), sessionId: sid, repo: repo.trim(), items: [...uploaded, ...items.filter(i => i.uploaded).map(i => ({ name: i.name, itemId: i.itemId, size: i.size, kind: i.kind }))] }));
      setMessage(`Secure intake complete. ${uploaded.length || items.filter(i => i.uploaded).length} file(s) are stored in quarantine and ready to claim.`);
      onContinue?.();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Secure upload failed.'); }
    finally { setBusy(false); }
  };

  const runRepositoryReview = async () => {
    const match = repo.trim().match(/github\.com\/([^/]+)\/([^/#?]+)(?:[/?#]|$)/i);
    if (!match) { setMessage('Enter a GitHub repository URL, for example github.com/company/product.'); return; }
    setBusy(true); setMessage('Connecting to GitHub and starting the real repository review…');
    try {
      const response = await apiFetch('/api/free-review/scan', { method: 'POST', body: JSON.stringify({ owner: match[1], repository: match[2].replace(/\.git$/, '') }) });
      const data = await response.json(); if (!response.ok) throw new Error(data?.error || 'Repository review could not start.');
      setMessage(`Review started for ${match[1]}/${match[2]}. SPR will inspect the repository directly.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Repository review failed.'); }
    finally { setBusy(false); }
  };

  return <div className="min-h-screen bg-[var(--spr-surface)] px-5 py-10 text-[var(--spr-text)]"><div className="mx-auto max-w-6xl">
    <div className="mb-10 max-w-3xl"><div className="inline-flex items-center gap-2 rounded-full border border-[var(--spr-highlight)]/30 bg-[var(--spr-accent-soft)]/20 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.18em] text-[var(--spr-highlight)]"><Sparkles className="h-3.5 w-3.5" /> Universal MSP Intake</div><h1 className="mt-5 text-4xl font-semibold tracking-tight md:text-6xl">VERIFY EVERYTHING.</h1><p className="mt-5 text-base leading-7 text-[var(--spr-text-muted)] md:text-lg">Give SPR what you already have. Connect a repository, upload a complete project, or bring policies, contracts, security, privacy and compliance evidence.</p><p className="mt-3 text-sm font-semibold">You do not need to make an SBOM first.</p></div>
    <div className="grid gap-5 lg:grid-cols-3"><button onClick={() => fileInput.current?.click()} disabled={busy} className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6 text-left hover:border-[var(--spr-highlight)]/50 disabled:opacity-50"><HardDriveUpload className="h-7 w-7 text-[var(--spr-highlight)]"/><h2 className="mt-5 text-lg font-semibold">Upload software</h2><p className="mt-2 text-sm leading-6 text-[var(--spr-text-muted)]">Source, ZIPs, manifests, lockfiles, packages, containers and complete projects.</p><span className="mt-5 inline-flex gap-2 text-sm font-semibold">Choose files <ArrowRight className="h-4 w-4"/></span></button>
    <button onClick={() => folderInput.current?.click()} disabled={busy} className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6 text-left hover:border-[var(--spr-highlight)]/50 disabled:opacity-50"><FolderOpen className="h-7 w-7 text-[var(--spr-highlight)]"/><h2 className="mt-5 text-lg font-semibold">Scan a folder</h2><p className="mt-2 text-sm leading-6 text-[var(--spr-text-muted)]">Select an entire project folder in supported browsers.</p><span className="mt-5 inline-flex gap-2 text-sm font-semibold">Choose folder <ArrowRight className="h-4 w-4"/></span></button>
    <div className="rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6"><Github className="h-7 w-7 text-[var(--spr-highlight)]"/><h2 className="mt-5 text-lg font-semibold">Connect GitHub</h2><p className="mt-2 text-sm leading-6 text-[var(--spr-text-muted)]">Real repository acquisition and security analysis. No SBOM preparation required.</p><input value={repo} onChange={e=>setRepo(e.target.value)} placeholder="https://github.com/company/repo" className="mt-5 w-full rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-deep)] px-4 py-3 text-sm"/><button disabled={busy} onClick={runRepositoryReview} className="mt-3 w-full rounded-xl bg-[var(--spr-accent)] px-4 py-3 text-sm font-bold text-white disabled:opacity-50">Start repository review</button></div></div>
    <div onDragOver={e=>{e.preventDefault();setDragging(true)}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);addFiles(e.dataTransfer.files)}} className={`mt-6 rounded-2xl border-2 border-dashed p-10 text-center ${dragging?'border-[var(--spr-highlight)] bg-[var(--spr-accent-soft)]/20':'border-[var(--spr-border)] bg-[var(--spr-surface-deep)]'}`}><Archive className="mx-auto h-9 w-9 text-[var(--spr-highlight)]"/><h2 className="mt-4 text-xl font-semibold">DROP EVERYTHING HERE</h2><p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-[var(--spr-text-muted)]">Software, SBOMs, policies, legal paperwork, questionnaires, certificates, security documents and vendor evidence.</p><div className="mt-4 text-xs text-[var(--spr-text-faint)]">100 files • 100 MB each • uploaded into private quarantine storage</div></div>
    <input ref={fileInput} type="file" multiple className="hidden" onChange={e=>e.target.files&&addFiles(e.target.files)}/><input ref={folderInput} type="file" multiple className="hidden" {...({webkitdirectory:'',directory:''} as any)} onChange={e=>e.target.files&&addFiles(e.target.files)}/>
    {(items.length>0||repo.trim())&&<section className="mt-8 rounded-2xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-6"><div className="flex items-center justify-between"><div><div className="text-[10px] font-bold uppercase tracking-[.18em] text-[var(--spr-text-faint)]">Intake</div><h2 className="mt-1 text-xl font-semibold">{items.length} file(s){repo.trim()?' + 1 repository':''}</h2></div><button onClick={()=>{setItems([]);setRepo('');setMessage('');sessionStorage.removeItem(STAGED_KEY)}} className="text-xs text-[var(--spr-text-muted)]">Clear all</button></div><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">{Object.entries(summary).map(([k,v])=><div key={k} className="rounded-xl border border-[var(--spr-border)] p-3"><div className="text-lg font-semibold">{v}</div><div className="text-[10px] uppercase text-[var(--spr-text-faint)]">{k}</div></div>)}</div><div className="mt-5 max-h-64 space-y-2 overflow-auto">{items.map((item,index)=><div key={`${item.name}-${index}`} className="flex items-center justify-between rounded-xl border border-[var(--spr-border)] px-3 py-2.5"><div className="flex min-w-0 items-center gap-3"><FileText className="h-4 w-4 shrink-0"/><span className="truncate text-sm">{item.name}</span></div><div className="flex items-center gap-2 text-[10px] uppercase text-[var(--spr-text-faint)]"><span>{item.uploaded?'uploaded':item.kind}</span><button onClick={()=>setItems(prev=>prev.filter((_,i)=>i!==index))} aria-label={`Remove ${item.name}`}><X className="h-4 w-4"/></button></div></div>)}</div><div className="mt-5 rounded-xl border border-[var(--spr-highlight)]/20 bg-[var(--spr-accent-soft)]/10 p-4"><div className="flex gap-3"><ShieldCheck className="h-5 w-5 shrink-0 text-[var(--spr-highlight)]"/><div><div className="text-sm font-semibold">Evidence-first</div><p className="mt-1 text-xs leading-5 text-[var(--spr-text-muted)]">SPR records the original file, hash and source state. Unsupported or failed analysis stays visible as unknown or failed.</p></div></div></div><button disabled={busy} onClick={uploadAll} className="mt-5 w-full rounded-xl bg-[var(--spr-accent)] px-5 py-3.5 text-sm font-bold text-white disabled:opacity-50">{busy?<><Loader className="mr-2 inline h-4 w-4 animate-spin"/>Working…</>:<><CheckCircle2 className="mr-2 inline h-4 w-4"/>Secure files and continue</>}</button></section>}
    {message&&<div role="status" className="mt-5 rounded-xl border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4 text-sm text-[var(--spr-text-muted)]">{message}</div>}
  </div></div>;
}
