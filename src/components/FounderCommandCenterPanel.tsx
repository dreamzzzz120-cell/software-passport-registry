/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Founder-only platform control panel. All privileged data is server-authorized
// and unavailable values are rendered as "Not verified", never as invented zeroes.

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import FounderConnectionDetail, { type Connection, type ConnectionGuide } from './FounderConnectionDetail';

type CommandCenterData = {
  connections: Connection[];
  connectionGuides: Record<string, ConnectionGuide>;
  businessMetrics: { organizationCount: number | null; userCount: number | null; mrrCents: number | null; stripeCustomerCount: number | null; ciStatus: string };
  generatedAt: string;
};
type Task = { id: number; title: string; category: 'seo' | 'backlinks' | 'outreach' | 'infra' | 'general'; status: 'open' | 'in_progress' | 'done'; notes: string | null; due_date: string | null };
type PassportRow = {
  id: string;
  tenantId: string;
  name: string;
  version: string;
  publisher: string;
  category: string;
  overallScore: number | null;
  verificationStatus: 'unverified' | 'partial' | 'verified';
  releaseDate: string | null;
  holderEmail: string | null;
  holderCompany: string | null;
};

const DOT_CLASS: Record<Connection['status'], string> = {
  ok: 'spr-status-dot spr-status-dot--green',
  error: 'spr-status-dot spr-status-dot--red',
  not_configured: 'spr-status-dot spr-status-dot--gray',
};

function money(cents: number | null) {
  return cents === null ? 'Not verified' : `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function observedCount(value: number | null) {
  return value === null ? 'Not verified' : String(value);
}

export default function FounderCommandCenterPanel() {
  const [data, setData] = useState<CommandCenterData | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [passports, setPassports] = useState<PassportRow[]>([]);
  const [visible, setVisible] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState<Task['category']>('general');
  const [openConnection, setOpenConnection] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const ccRes = await apiFetch('/api/founder/command-center');
      if (!ccRes.ok) return;
      const cc = await ccRes.json();
      const tasksRes = await apiFetch('/api/founder/tasks');
      const taskList = tasksRes.ok ? await tasksRes.json() : [];
      const passportsRes = await apiFetch('/api/founder/passports');
      const passportList = passportsRes.ok ? await passportsRes.json() : [];
      setData(cc);
      setTasks(taskList);
      setPassports(passportList);
      setVisible(true);
    } catch {
      // Founder-only bonus panel; core product remains available if this fails.
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function addTask() {
    if (!newTitle.trim()) return;
    const res = await apiFetch('/api/founder/tasks', { method: 'POST', body: JSON.stringify({ title: newTitle.trim(), category: newCategory }) });
    if (res.ok) {
      const created = await res.json();
      setTasks((prev) => [created, ...prev]);
      setNewTitle('');
    }
  }

  async function cycleStatus(task: Task) {
    const next: Record<Task['status'], Task['status']> = { open: 'in_progress', in_progress: 'done', done: 'open' };
    const res = await apiFetch(`/api/founder/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ status: next[task.status] }) });
    if (res.ok) {
      const updated = await res.json();
      setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
    }
  }

  async function deleteTask(id: number) {
    const res = await apiFetch(`/api/founder/tasks/${id}`, { method: 'DELETE' });
    if (res.ok || res.status === 204) setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  if (!visible || !data) return null;

  const grouped = {
    open: tasks.filter((t) => t.status === 'open'),
    in_progress: tasks.filter((t) => t.status === 'in_progress'),
    done: tasks.filter((t) => t.status === 'done'),
  };

  return (
    <div className="mt-8 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--spr-text)]">Connections, registry and tasks</h2>
        <button onClick={() => void load()} className="spr-btn spr-btn-secondary inline-flex items-center gap-2 text-xs">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      <div id="founder-connections" className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-5">
        <p className="text-[11px] uppercase tracking-[0.24em] font-semibold text-[var(--spr-text-muted)] mb-1">Connections</p>
        <p className="mb-3 text-xs text-[var(--spr-text-muted)]">Live checks against each platform. Click a card for what it is, what the status means, which settings are present, and how to configure it.</p>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {data.connections.map((c) => {
            const open = openConnection === c.key;
            const guide = data.connectionGuides?.[c.key];
            const missing = guide ? guide.settings.filter((s) => !s.set).length : 0;
            return (
              <button
                key={c.key}
                type="button"
                aria-expanded={open}
                onClick={() => setOpenConnection(open ? null : c.key)}
                className={`flex items-start gap-2 rounded-md border p-3 text-left transition-colors hover:border-[var(--spr-highlight)] ${open ? 'border-[var(--spr-highlight)] bg-[var(--spr-surface)]' : 'border-[var(--spr-border)] bg-[var(--spr-surface-alt)]'}`}
              >
                <span className={DOT_CLASS[c.status]} style={{ marginTop: 4 }} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[var(--spr-text)]">{c.name}</p>
                  <p className="text-xs text-[var(--spr-text-muted)]">{c.detail}</p>
                  {guide && missing > 0 && <p className="mt-1 text-[11px] text-[var(--spr-amber)]">{missing} setting{missing === 1 ? '' : 's'} missing</p>}
                </div>
                {open ? <ChevronDown className="w-4 h-4 shrink-0 text-[var(--spr-text-muted)]" /> : <ChevronRight className="w-4 h-4 shrink-0 text-[var(--spr-text-muted)]" />}
              </button>
            );
          })}
        </div>
        {openConnection && (() => {
          const c = data.connections.find((x) => x.key === openConnection);
          const guide = data.connectionGuides?.[openConnection];
          if (!c || !guide) return null;
          return <FounderConnectionDetail connection={c} guide={guide} onRecheck={() => void load()} />;
        })()}
      </div>


      <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-[0.24em] font-semibold text-[var(--spr-text-muted)]">Customer Passport Registry ({passports.length})</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[12px] uppercase tracking-[0.18em] text-[var(--spr-text-muted)]">
                <th className="pb-2 pr-3">Passport</th>
                <th className="pb-2 pr-3">Holder</th>
                <th className="pb-2 pr-3">Score</th>
                <th className="pb-2 pr-3">Verification</th>
                <th className="pb-2 pr-3">Released</th>
              </tr>
            </thead>
            <tbody>
              {passports.map((p) => (
                <tr key={p.id} className="border-t border-[var(--spr-border)]">
                  <td className="py-2 pr-3">
                    <div className="font-medium text-[var(--spr-text)]">{p.name} <span className="text-[var(--spr-text-muted)]">v{p.version}</span></div>
                    <div className="text-xs text-[var(--spr-text-muted)]">{p.publisher} · {p.category}</div>
                  </td>
                  <td className="py-2 pr-3">
                    {p.holderEmail ? (
                      <div>
                        <div className="text-[var(--spr-text)]">{p.holderCompany || p.holderEmail}</div>
                        {p.holderCompany && <div className="text-xs text-[var(--spr-text-muted)]">{p.holderEmail}</div>}
                      </div>
                    ) : (
                      <span className="text-[var(--spr-text-muted)]">No Owner on tenant {p.tenantId}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-[var(--spr-text)]">{p.overallScore ?? 'Not verified'}</td>
                  <td className="py-2 pr-3">
                    <span className={`rounded-full px-2 py-0.5 text-[12px] font-semibold uppercase ${p.verificationStatus === 'verified' ? 'bg-[var(--spr-green)]/15 text-[var(--spr-green)]' : p.verificationStatus === 'partial' ? 'bg-[var(--spr-amber)]/15 text-[var(--spr-amber)]' : 'bg-[var(--spr-text-muted)]/15 text-[var(--spr-text-muted)]'}`}>{p.verificationStatus}</span>
                  </td>
                  <td className="py-2 pr-3 text-[var(--spr-text-muted)]">{p.releaseDate || 'Not verified'}</td>
                </tr>
              ))}
              {passports.length === 0 && (
                <tr><td colSpan={5} className="py-4 text-center text-[var(--spr-text-muted)]">No customer passports issued yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-5">
        <p className="text-[11px] uppercase tracking-[0.24em] font-semibold text-[var(--spr-text-muted)] mb-3">Growth Tasks</p>
        <div className="flex gap-2 mb-4">
          <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Add a task…" className="flex-1 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] px-3 py-1.5 text-sm text-[var(--spr-text)]" />
          <select value={newCategory} onChange={(e) => setNewCategory(e.target.value as Task['category'])} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] px-2 py-1.5 text-sm text-[var(--spr-text)]">
            <option value="general">General</option><option value="seo">SEO</option><option value="backlinks">Backlinks</option><option value="outreach">Outreach</option><option value="infra">Infra</option>
          </select>
          <button onClick={() => void addTask()} className="spr-btn spr-btn-primary text-sm">Add</button>
        </div>

        {(['open', 'in_progress', 'done'] as const).map((status) => (
          <div key={status} className="mb-4">
            <p className="text-[12px] uppercase tracking-[0.2em] font-semibold text-[var(--spr-text-muted)] mb-1">{status.replace('_', ' ')} ({grouped[status].length})</p>
            <div className="space-y-1">
              {grouped[status].map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] px-3 py-2 text-sm">
                  <div><span className="mr-2 rounded border border-[var(--spr-border)] px-1.5 py-0.5 text-[12px] uppercase text-[var(--spr-text-muted)]">{t.category}</span><span className="text-[var(--spr-text)]">{t.title}</span>{t.notes && <p className="text-xs text-[var(--spr-text-muted)] mt-0.5">{t.notes}</p>}</div>
                  <div className="flex gap-3 shrink-0"><button onClick={() => void cycleStatus(t)} className="text-xs text-[var(--spr-highlight)]">Advance</button><button onClick={() => void deleteTask(t.id)} className="text-xs text-[var(--spr-red)]">Delete</button></div>
                </div>
              ))}
              {grouped[status].length === 0 && <p className="text-xs text-[var(--spr-text-muted)]">Nothing here.</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
