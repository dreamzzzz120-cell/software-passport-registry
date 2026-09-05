/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Renders inside FounderDashboardView, below the existing per-tenant metrics.
// Fetches /api/founder/command-center + /api/founder/tasks, both gated
// server-side by requireRole('Owner') + requireFounder (FOUNDER_EMAILS
// allowlist). Any Owner who isn't on that allowlist gets a 403 — this
// component renders nothing in that case rather than showing an error, since
// most Owners (every paying customer) are expected to hit that 403.

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

type Connection = { name: string; status: 'ok' | 'error' | 'not_configured'; detail: string; lastChecked: string };
type CommandCenterData = {
  connections: Connection[];
  businessMetrics: { organizationCount: number; userCount: number; mrrCents: number; stripeCustomerCount: number; ciStatus: string };
  generatedAt: string;
};
type Task = { id: number; title: string; category: 'seo' | 'backlinks' | 'outreach' | 'infra' | 'general'; status: 'open' | 'in_progress' | 'done'; notes: string | null; due_date: string | null };

const DOT_CLASS: Record<Connection['status'], string> = {
  ok: 'spr-status-dot spr-status-dot--green',
  error: 'spr-status-dot spr-status-dot--red',
  not_configured: 'spr-status-dot spr-status-dot--gray',
};

function money(cents: number) {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function FounderCommandCenterPanel() {
  const [data, setData] = useState<CommandCenterData | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [visible, setVisible] = useState(false); // stays false (renders nothing) unless the founder-only fetch succeeds
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState<Task['category']>('general');

  const load = useCallback(async () => {
    try {
      const ccRes = await apiFetch('/api/founder/command-center');
      if (!ccRes.ok) return; // 403 for any non-founder Owner — render nothing, not an error
      const cc = await ccRes.json();
      const tasksRes = await apiFetch('/api/founder/tasks');
      const taskList = tasksRes.ok ? await tasksRes.json() : [];
      setData(cc);
      setTasks(taskList);
      setVisible(true);
    } catch {
      // Silent — this panel is a bonus for the founder, not core UI.
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
        <h2 className="text-lg font-semibold text-[var(--spr-text)]">Founder Command Center — Platform</h2>
        <button onClick={() => void load()} className="spr-btn spr-btn-secondary inline-flex items-center gap-2 text-xs">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* Connections */}
      <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-5">
        <p className="text-[11px] uppercase tracking-[0.24em] font-semibold text-[var(--spr-text-muted)] mb-3">Connections</p>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {data.connections.map((c) => (
            <div key={c.name} className="flex items-start gap-2 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-3">
              <span className={DOT_CLASS[c.status]} style={{ marginTop: 4 }} />
              <div>
                <p className="text-sm font-medium text-[var(--spr-text)]">{c.name}</p>
                <p className="text-xs text-[var(--spr-text-muted)]">{c.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Business metrics */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'MRR', value: money(data.businessMetrics.mrrCents) },
          { label: 'Organizations', value: String(data.businessMetrics.organizationCount) },
          { label: 'Users', value: String(data.businessMetrics.userCount) },
          { label: 'CI Status', value: data.businessMetrics.ciStatus },
        ].map((m) => (
          <div key={m.label} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4">
            <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--spr-text-muted)]">{m.label}</p>
            <p className="mt-2 text-xl font-bold text-[var(--spr-text)]">{m.value}</p>
          </div>
        ))}
      </div>

      {/* Growth tasks */}
      <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-5">
        <p className="text-[11px] uppercase tracking-[0.24em] font-semibold text-[var(--spr-text-muted)] mb-3">Growth Tasks</p>
        <div className="flex gap-2 mb-4">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Add a task…"
            className="flex-1 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] px-3 py-1.5 text-sm text-[var(--spr-text)]"
          />
          <select
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value as Task['category'])}
            className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] px-2 py-1.5 text-sm text-[var(--spr-text)]"
          >
            <option value="general">General</option>
            <option value="seo">SEO</option>
            <option value="backlinks">Backlinks</option>
            <option value="outreach">Outreach</option>
            <option value="infra">Infra</option>
          </select>
          <button onClick={() => void addTask()} className="spr-btn spr-btn-primary text-sm">Add</button>
        </div>

        {(['open', 'in_progress', 'done'] as const).map((status) => (
          <div key={status} className="mb-4">
            <p className="text-[10px] uppercase tracking-[0.2em] font-semibold text-[var(--spr-text-muted)] mb-1">
              {status.replace('_', ' ')} ({grouped[status].length})
            </p>
            <div className="space-y-1">
              {grouped[status].map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] px-3 py-2 text-sm">
                  <div>
                    <span className="mr-2 rounded border border-[var(--spr-border)] px-1.5 py-0.5 text-[10px] uppercase text-[var(--spr-text-muted)]">{t.category}</span>
                    <span className="text-[var(--spr-text)]">{t.title}</span>
                    {t.notes && <p className="text-xs text-[var(--spr-text-muted)] mt-0.5">{t.notes}</p>}
                  </div>
                  <div className="flex gap-3 shrink-0">
                    <button onClick={() => void cycleStatus(t)} className="text-xs text-[var(--spr-highlight)]">Advance</button>
                    <button onClick={() => void deleteTask(t.id)} className="text-xs text-[var(--spr-red)]">Delete</button>
                  </div>
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
