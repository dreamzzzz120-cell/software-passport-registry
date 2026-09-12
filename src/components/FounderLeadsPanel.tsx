/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

// Founder-only list of Free Review leads (people who gave a work email to
// download their result PDF). Shows exactly the rows the server returns.
type Lead = { id: string; name: string; email: string; company: string | null; repository: string; passportId: string; consentedAt: string; createdAt: string };

export default function FounderLeadsPanel() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/founder/leads').then(async (res) => {
      const data = await res.json().catch(() => []);
      if (cancelled) return;
      if (!res.ok || !Array.isArray(data)) { setState('error'); return; }
      setLeads(data); setState('ready');
    }).catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-6 space-y-3" id="founder-leads">
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4 text-[var(--spr-highlight)]" />
        <h2 className="text-sm font-bold text-[var(--spr-text)]">Free Review leads</h2>
        {state === 'ready' && <span className="text-xs text-[var(--spr-text-muted)]">{leads.length} recorded</span>}
      </div>
      {state === 'loading' && <p className="text-xs text-[var(--spr-text-muted)]">Loading…</p>}
      {state === 'error' && <p role="alert" className="text-xs text-[var(--spr-red)]">Leads could not be loaded.</p>}
      {state === 'ready' && leads.length === 0 && <p className="text-xs text-[var(--spr-text-muted)]">No leads yet. A lead is recorded when a Free Review visitor downloads their result PDF with a work email.</p>}
      {state === 'ready' && leads.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-[var(--spr-text-muted)]"><th className="py-1 pr-3">When</th><th className="py-1 pr-3">Name</th><th className="py-1 pr-3">Email</th><th className="py-1 pr-3">Company</th><th className="py-1 pr-3">Repository</th></tr></thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="border-t border-[var(--spr-border)]">
                  <td className="py-1.5 pr-3 whitespace-nowrap text-[var(--spr-text-muted)]">{new Date(l.createdAt).toLocaleString()}</td>
                  <td className="py-1.5 pr-3 text-[var(--spr-text)]">{l.name}</td>
                  <td className="py-1.5 pr-3 font-mono text-[var(--spr-text)]">{l.email}</td>
                  <td className="py-1.5 pr-3 text-[var(--spr-text-muted)]">{l.company || '—'}</td>
                  <td className="py-1.5 pr-3 font-mono text-[var(--spr-text-muted)]">{l.repository}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
