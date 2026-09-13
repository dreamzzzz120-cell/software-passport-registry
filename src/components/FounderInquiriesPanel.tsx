/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { Inbox } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

// Founder-only list of messages sent through the public /contact/ form.
// Each row says whether the email forward actually went out; a stored but
// unforwarded message is shown as such rather than assumed delivered.
type Inquiry = { id: string; name: string; email: string; company: string | null; topic: string; message: string; forwardedAt: string | null; forwardError: string | null; createdAt: string };

export default function FounderInquiriesPanel() {
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/founder/contact-inquiries').then(async (res) => {
      const data = await res.json().catch(() => null);
      if (cancelled) return;
      if (!res.ok || !Array.isArray(data?.inquiries)) { setState('error'); return; }
      setInquiries(data.inquiries); setState('ready');
    }).catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-6 space-y-3" id="founder-inquiries">
      <div className="flex items-center gap-2">
        <Inbox className="w-4 h-4 text-[var(--spr-highlight)]" />
        <h2 className="text-sm font-bold text-[var(--spr-text)]">Contact-form inquiries</h2>
        {state === 'ready' && <span className="text-xs text-[var(--spr-text-muted)]">{inquiries.length} recorded</span>}
      </div>
      {state === 'loading' && <p className="text-xs text-[var(--spr-text-muted)]">Loading…</p>}
      {state === 'error' && <p role="alert" className="text-xs text-[var(--spr-red)]">Inquiries could not be loaded.</p>}
      {state === 'ready' && inquiries.length === 0 && <p className="text-xs text-[var(--spr-text-muted)]">Nothing has been sent through /contact/ yet.</p>}
      {state === 'ready' && inquiries.length > 0 && (
        <ul className="divide-y divide-[var(--spr-border)]">
          {inquiries.map((i) => (
            <li key={i.id} className="py-3 text-xs">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-[var(--spr-text-muted)]">{new Date(i.createdAt).toLocaleString()}</span>
                <span className="rounded bg-[var(--spr-surface-sunken)] px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-[var(--spr-text-muted)]">{i.topic}</span>
                <span className="font-semibold text-[var(--spr-text)]">{i.name}</span>
                <a href={`mailto:${i.email}`} className="font-mono text-[var(--spr-highlight)] hover:underline">{i.email}</a>
                {i.company && <span className="text-[var(--spr-text-muted)]">{i.company}</span>}
                {i.forwardedAt ? <span className="text-[var(--spr-green)]">forwarded</span> : <span className="text-[var(--spr-amber)]" title={i.forwardError ?? ''}>not forwarded{i.forwardError ? ` (${i.forwardError})` : ''}</span>}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[var(--spr-text)]">{i.message}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
