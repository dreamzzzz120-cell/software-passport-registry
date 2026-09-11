/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { Activity } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

// Founder-only: fires one real test event at the configured error monitor
// through POST /api/founder/monitoring/test-event and shows exactly what the
// server returned -- the event id Sentry assigned, or the reason it could not
// send. Nothing here claims delivery the server did not report.
export default function FounderMonitoringPanel() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const send = async () => {
    setBusy(true); setResult(null);
    try {
      const res = await apiFetch('/api/founder/monitoring/test-event', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setResult({ ok: false, text: data?.message || data?.error || `Request failed (${res.status})` }); return; }
      setResult({ ok: true, text: `Test event accepted by the SDK. Event id ${data.eventId} · sent ${new Date(data.sentAt).toLocaleTimeString()}. Confirm it appears in Sentry to prove delivery.` });
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : 'Request failed.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-6 space-y-3" id="founder-monitoring">
      <div className="flex items-center gap-2">
        <Activity className="w-4 h-4 text-[var(--spr-highlight)]" />
        <h2 className="text-sm font-bold text-[var(--spr-text)]">Error monitoring</h2>
      </div>
      <p className="text-xs text-[var(--spr-text-muted)]">Sends one test event to the error monitor configured on this deployment (SENTRY_DSN). Use it to verify delivery without waiting for a real failure.</p>
      <button onClick={() => void send()} disabled={busy} className="spr-btn spr-btn-secondary disabled:opacity-50">{busy ? 'Sending…' : 'Send test event'}</button>
      {result && <p role={result.ok ? 'status' : 'alert'} className={`text-xs ${result.ok ? 'text-[var(--spr-green)]' : 'text-[var(--spr-red)]'}`}>{result.text}</p>}
    </div>
  );
}
