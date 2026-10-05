/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

type RealityPayload = {
  systemState: {
    observed: number;
    healthy: number;
    degrading: number;
    failed: number;
    unknown: number;
    activeIncidents: number;
    observabilityCompromised: boolean;
  };
  components: Array<{ contractId: string; component: string; description: string; state: string | null; explanation: string | null; observedAt: string | null }>;
  incidents: Array<{ id: string; component: string; severity: string; status: string; rootCauseState: string; rootCause?: string | null; lastSeenAt: string }>;
  receipts: Array<{ id: string; incidentId: string; result: string; repair: string; createdAt: string }>;
};

export default function FounderMonitoringPanel() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [reality, setReality] = useState<RealityPayload | null>(null);
  const [realityError, setRealityError] = useState<string | null>(null);

  const loadReality = async () => {
    setRealityError(null);
    try {
      const res = await apiFetch('/api/founder/reality');
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Reality state request failed (${res.status})`);
      setReality(data);
    } catch (error) {
      setRealityError(error instanceof Error ? error.message : 'Reality state request failed.');
    }
  };

  useEffect(() => { void loadReality(); }, []);

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

  const active = reality?.incidents.filter((item) => !['PROVEN_FIXED', 'FAILED'].includes(item.status)) ?? [];

  return (
    <div className="space-y-4 pt-4" id="founder-monitoring">
      <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-[var(--spr-highlight)]" />
            <div>
              <h2 className="text-sm font-bold text-[var(--spr-text)]">Autonomous reality reconciliation</h2>
              <p className="text-xs text-[var(--spr-text-muted)]">EXPECT → OBSERVE → COMPARE → EXPLAIN → CORRECT → PROVE → RECORD</p>
            </div>
          </div>
          <button onClick={() => void loadReality()} className="spr-btn spr-btn-secondary inline-flex items-center gap-2"><RefreshCw className="w-4 h-4" />Refresh</button>
        </div>

        {realityError && <p role="alert" className="text-xs text-[var(--spr-red)]">{realityError}</p>}
        {!reality && !realityError && <p className="text-xs text-[var(--spr-text-muted)]">Loading observed system state…</p>}

        {reality && <>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ['Observed', reality.systemState.observed],
              ['Healthy', reality.systemState.healthy],
              ['Degrading', reality.systemState.degrading],
              ['Failed', reality.systemState.failed],
              ['Unknown', reality.systemState.unknown],
              ['Incidents', reality.systemState.activeIncidents],
            ].map(([label, value]) => <div key={String(label)} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-3"><div className="text-[10px] uppercase tracking-[0.18em] text-[var(--spr-text-muted)]">{label}</div><div className="mt-1 text-xl font-semibold text-[var(--spr-text)]">{value}</div></div>)}
          </div>

          {reality.systemState.observabilityCompromised && <div className="rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 p-3 text-xs text-[var(--spr-red)]"><strong>OBSERVABILITY COMPROMISED.</strong> Missing telemetry is not being treated as healthy.</div>}

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--spr-text-muted)]">Component contracts</h3>
            {reality.components.map((component) => <div key={component.contractId} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-3">
              <div className="flex items-start justify-between gap-3"><div><div className="text-sm font-semibold text-[var(--spr-text)]">{component.component}</div><div className="text-xs text-[var(--spr-text-muted)]">{component.description}</div></div><span className="text-xs font-semibold text-[var(--spr-text)]">{component.state ?? 'UNKNOWN'}</span></div>
              <div className="mt-2 text-xs text-[var(--spr-text-muted)]">{component.explanation ?? 'No observation has been recorded yet.'}</div>
              {component.observedAt && <div className="mt-1 text-[10px] text-[var(--spr-text-muted)]">Observed {new Date(component.observedAt).toLocaleString()}</div>}
            </div>)}
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--spr-text-muted)]">Active problems</h3>
            {active.length === 0 ? <p className="text-xs text-[var(--spr-text-muted)]">No active incident is currently proven by the reconciler.</p> : active.slice(0, 10).map((incident) => <div key={incident.id} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-3">
              <div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold text-[var(--spr-text)]">{incident.component}</span><span className="text-xs text-[var(--spr-text)]">{incident.severity} · {incident.status}</span></div>
              <div className="mt-1 text-xs text-[var(--spr-text-muted)]">Root cause: {incident.rootCause ?? 'UNKNOWN'} ({incident.rootCauseState})</div>
              <div className="mt-1 text-[10px] text-[var(--spr-text-muted)]">{incident.id} · last seen {new Date(incident.lastSeenAt).toLocaleString()}</div>
            </div>)}
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--spr-text-muted)]">Latest repair receipts</h3>
            {reality.receipts.length === 0 ? <p className="text-xs text-[var(--spr-text-muted)]">No repair has been proven yet.</p> : reality.receipts.slice(0, 5).map((receipt) => <div key={receipt.id} className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-3"><div className="text-xs font-semibold text-[var(--spr-text)]">{receipt.result}</div><div className="mt-1 text-xs text-[var(--spr-text-muted)]">{receipt.repair}</div><div className="mt-1 text-[10px] text-[var(--spr-text-muted)]">{new Date(receipt.createdAt).toLocaleString()}</div></div>)}
          </div>
        </>}
      </div>

      <div className="rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface)] p-5 space-y-3">
        <h2 className="text-sm font-bold text-[var(--spr-text)]">Error-monitor delivery test</h2>
        <p className="text-xs text-[var(--spr-text-muted)]">Sends one test event to the configured error monitor. Acceptance by the SDK is not claimed as proof of downstream delivery.</p>
        <button onClick={() => void send()} disabled={busy} className="spr-btn spr-btn-secondary disabled:opacity-50">{busy ? 'Sending…' : 'Send test event'}</button>
        {result && <p role={result.ok ? 'status' : 'alert'} className={`text-xs ${result.ok ? 'text-[var(--spr-green)]' : 'text-[var(--spr-red)]'}`}>{result.text}</p>}
      </div>
    </div>
  );
}
