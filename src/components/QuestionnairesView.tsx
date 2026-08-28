import React, { useEffect, useState } from 'react';
import { CheckCircle2, ClipboardList, Loader2, Plus, RefreshCw, ShieldQuestion, X } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import type { Client, SoftwarePassport } from '../types';

type Questionnaire = { id: string; name: string; clientId: string | null; status: 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'EXPORTED'; createdAt: string; updatedAt: string };
type QuestionnaireItem = { id: string; sequenceNumber: number; questionText: string; category: string | null; draftAnswer: string | null; confidenceBasisPoints: number; status: 'UNKNOWN' | 'NEEDS_REVIEW' | 'ANSWERED' | 'APPROVED'; evidenceIds: string[] };

const STATUS_STYLE: Record<string, string> = {
  UNKNOWN: 'text-[#9d9d9d] border-[#3c3c3c]', NEEDS_REVIEW: 'text-[#cca700] border-[#cca700]/40',
  ANSWERED: 'text-[#3794ff] border-[#3794ff]/40', APPROVED: 'text-[#89d185] border-[#89d185]/40',
};

export default function QuestionnairesView({ role = 'Viewer', clients = [], passports = [] }: { role?: string; clients?: Client[]; passports?: SoftwarePassport[] }) {
  const canCreate = role === 'Owner' || role === 'Admin' || role === 'Technician';
  const [questionnaires, setQuestionnaires] = useState<Questionnaire[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ items: QuestionnaireItem[] } & Questionnaire | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newClientId, setNewClientId] = useState('');
  const [newPassportId, setNewPassportId] = useState('');
  const [newQuestionsText, setNewQuestionsText] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const response = await apiFetch('/api/questionnaires');
      if (!response.ok) throw new Error('Unable to load questionnaires.');
      setQuestionnaires(await response.json());
    } catch (e: any) {
      setError(e?.message || 'Unable to load questionnaires.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const loadDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const response = await apiFetch(`/api/questionnaires/${encodeURIComponent(id)}`);
      if (response.ok) setDetail(await response.json());
    } finally {
      setDetailLoading(false);
    }
  };
  useEffect(() => { if (selectedId) void loadDetail(selectedId); else setDetail(null); }, [selectedId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newPassportId || !newQuestionsText.trim() || creating) return;
    setCreating(true); setCreateError('');
    try {
      const response = await apiFetch('/api/questionnaires', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), clientId: newClientId || null, passportId: newPassportId, questionsText: newQuestionsText }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error === 'NO_QUESTIONS_FOUND' ? 'Paste at least one question, one per line.' : (data?.error || 'Unable to create this questionnaire.'));
      setShowCreate(false); setNewName(''); setNewClientId(''); setNewPassportId(''); setNewQuestionsText('');
      await load();
      setSelectedId(data.id);
    } catch (e: any) {
      setCreateError(e?.message || 'Unable to create this questionnaire.');
    } finally {
      setCreating(false);
    }
  };

  const generateDrafts = async () => {
    if (!selectedId || generating) return;
    setGenerating(true);
    try {
      const response = await apiFetch(`/api/questionnaires/${encodeURIComponent(selectedId)}/generate-drafts`, { method: 'POST' });
      if (response.ok) { await loadDetail(selectedId); await load(); }
    } finally {
      setGenerating(false);
    }
  };

  const updateItem = async (itemId: string, body: Partial<Pick<QuestionnaireItem, 'draftAnswer' | 'status'>>) => {
    if (!selectedId) return;
    const response = await apiFetch(`/api/questionnaires/${encodeURIComponent(selectedId)}/items/${encodeURIComponent(itemId)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (response.ok) {
      const updated = await response.json();
      setDetail((current) => current ? { ...current, items: current.items.map((item) => item.id === itemId ? updated : item) } : current);
    }
  };

  return <div className="mx-auto max-w-6xl space-y-6 pb-10">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.2em] text-[#3794ff]"><ShieldQuestion className="h-4 w-4" /> Trust response</div>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-[#d4d4d4]">Security questionnaires</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-[#9d9d9d]">Draft answers come only from real, matched evidence. A question with no supporting evidence stays marked unknown rather than guessed.</p>
      </div>
      {canCreate && <button onClick={() => setShowCreate(true)} className="spr-btn spr-btn-primary inline-flex items-center gap-2 shrink-0"><Plus className="h-4 w-4" /> New questionnaire</button>}
    </header>

    {error && <div role="alert" className="rounded-md border border-[#f14c4c]/40 bg-[#f14c4c]/10 px-4 py-3 text-sm text-[#f14c4c]">{error}</div>}

    <div className="grid gap-5 lg:grid-cols-5">
      <section className="lg:col-span-2 spr-panel divide-y divide-[#3c3c3c] overflow-hidden">
        {loading ? <div className="p-6 text-sm text-[#9d9d9d]">Loading…</div> : questionnaires.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#9d9d9d]"><ClipboardList className="mx-auto h-7 w-7 text-[#6f6f6f]" /><p className="mt-2 font-semibold text-[#d4d4d4]">No questionnaires yet</p><p className="mt-1 text-xs">{canCreate ? 'Create one to get started.' : 'Ask an Owner, Admin, or Technician to create one.'}</p></div>
        ) : questionnaires.map((q) => (
          <button key={q.id} onClick={() => setSelectedId(q.id)} className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm transition ${selectedId === q.id ? 'bg-[#094771]/45' : 'hover:bg-[#2d2d2d]'}`}>
            <span className="min-w-0"><span className="block truncate font-semibold text-[#d4d4d4]">{q.name}</span><span className="block text-xs text-[#6f6f6f]">Updated {new Date(q.updatedAt).toLocaleDateString()}</span></span>
            <span className={`shrink-0 rounded-sm border px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLE[q.status] || STATUS_STYLE.UNKNOWN}`}>{q.status.replace('_', ' ')}</span>
          </button>
        ))}
      </section>

      <section className="lg:col-span-3 spr-panel p-5">
        {!selectedId ? <p className="py-16 text-center text-sm text-[#9d9d9d]">Select a questionnaire to review its items.</p> : detailLoading ? <p className="text-sm text-[#9d9d9d]">Loading…</p> : detail && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-bold text-[#d4d4d4]">{detail.name}</h2>
              {canCreate && <button onClick={() => void generateDrafts()} disabled={generating} className="spr-btn spr-btn-secondary inline-flex items-center gap-1.5 !text-xs disabled:opacity-50">{generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} {generating ? 'Matching…' : 'Generate drafts'}</button>}
            </div>
            <div className="max-h-[560px] space-y-3 overflow-y-auto pr-1">
              {detail.items.map((item) => (
                <div key={item.id} className="rounded-md border border-[#3c3c3c] bg-[#252526] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-[#d4d4d4]">{item.sequenceNumber}. {item.questionText}</p>
                    <span className={`shrink-0 rounded-sm border px-1.5 py-0.5 text-[9px] font-bold uppercase ${STATUS_STYLE[item.status]}`}>{item.status.replace('_', ' ')}</span>
                  </div>
                  {item.status === 'UNKNOWN' ? (
                    <p className="mt-2 text-xs italic text-[#6f6f6f]">No matching evidence found for this question.</p>
                  ) : (
                    <>
                      <textarea value={item.draftAnswer ?? ''} onChange={(e) => setDetail((current) => current ? { ...current, items: current.items.map((row) => row.id === item.id ? { ...row, draftAnswer: e.target.value } : row) } : current)} onBlur={(e) => void updateItem(item.id, { draftAnswer: e.target.value })} rows={2} disabled={!canCreate || item.status === 'APPROVED'} className="mt-2 w-full rounded-md border border-[#3c3c3c] bg-[#181818] px-2.5 py-1.5 text-xs text-[#d4d4d4] disabled:opacity-70" />
                      <div className="mt-2 flex items-center justify-between text-[10px] text-[#6f6f6f]">
                        <span>Confidence {(item.confidenceBasisPoints / 100).toFixed(0)}% · {item.evidenceIds.length} evidence item{item.evidenceIds.length === 1 ? '' : 's'} cited</span>
                        {canCreate && item.status !== 'APPROVED' && <button onClick={() => void updateItem(item.id, { status: 'APPROVED' })} className="inline-flex items-center gap-1 text-[#89d185] hover:text-[#a3dea0]"><CheckCircle2 className="h-3.5 w-3.5" /> Approve</button>}
                        {item.status === 'APPROVED' && <span className="inline-flex items-center gap-1 text-[#89d185]"><CheckCircle2 className="h-3.5 w-3.5" /> Approved</span>}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>

    {showCreate && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
        <div className="w-full max-w-lg rounded-md border border-[#3c3c3c] bg-[#252526] p-6 shadow-2xl">
          <div className="flex items-start justify-between gap-4"><h2 className="text-lg font-bold text-[#d4d4d4]">New questionnaire</h2><button onClick={() => setShowCreate(false)} aria-label="Close" className="rounded-md p-1.5 text-[#9d9d9d] hover:bg-[#383838]"><X className="h-4 w-4" /></button></div>
          <form onSubmit={handleCreate} className="mt-5 space-y-3.5">
            {createError && <div role="alert" className="rounded-md border border-[#f14c4c]/40 bg-[#f14c4c]/10 px-3 py-2.5 text-xs text-[#f14c4c]">{createError}</div>}
            <div className="flex flex-col gap-1"><label className="text-[10px] font-bold text-[#9d9d9d]">Name *</label><input required value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Acme Corp Security Review 2026" className="rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2 text-xs text-[#d4d4d4]" /></div>
            <div className="flex flex-col gap-1"><label className="text-[10px] font-bold text-[#9d9d9d]">Client (optional)</label><select value={newClientId} onChange={(e) => setNewClientId(e.target.value)} className="rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2 text-xs text-[#d4d4d4]"><option value="">No specific client</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div className="flex flex-col gap-1"><label className="text-[10px] font-bold text-[#9d9d9d]">Software / Passport *</label><select required value={newPassportId} onChange={(e) => setNewPassportId(e.target.value)} className="rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2 text-xs text-[#d4d4d4]"><option value="">Select passport…</option>{passports.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div className="flex flex-col gap-1"><label className="text-[10px] font-bold text-[#9d9d9d]">Questions * (one per line)</label><textarea required value={newQuestionsText} onChange={(e) => setNewQuestionsText(e.target.value)} rows={6} placeholder={'Do you enforce MFA for all accounts?\nIs data encrypted at rest?\n...'} className="rounded-md border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2 text-xs text-[#d4d4d4]" /></div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowCreate(false)} className="rounded-md border border-[#3c3c3c] px-3.5 py-2 text-xs font-semibold text-[#9d9d9d] hover:bg-[#383838]">Cancel</button>
              <button type="submit" disabled={creating || !newName.trim() || !newPassportId || !newQuestionsText.trim()} className="inline-flex items-center gap-1.5 rounded-md bg-[#0e639c] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#1177bb] disabled:opacity-40">{creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}{creating ? 'Creating…' : 'Create'}</button>
            </div>
          </form>
        </div>
      </div>
    )}
  </div>;
}
