import React, { useEffect, useState } from 'react';
import { AlertTriangle, Brain, CheckCircle2, RefreshCw } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

interface PassportSummary {
  id: string;
  name: string;
  version: string;
}

interface VectorEntry {
  dimension: string;
  state: 'known' | 'partially_known' | 'unknown' | 'stale' | 'expired' | 'unavailable';
  score: number | null;
  confidence: number | null;
  completeness: number;
  explanation: string;
  evidenceCount: number;
  openFindingCount: number;
  nextRefreshAt: string | null;
  freshnessStatus: string;
  limitations: string[];
  observations: Array<{
    evidenceId: string;
    statement: string;
    source: string;
    timestamp: string;
    evidenceType: string;
    verificationMethod: string;
    status: string;
    confidence: number;
  }>;
  missingEvidence: string[];
}

interface TrustObservation {
  schemaVersion: string;
  rule: string;
  observedAt: string;
  vector: Record<string, VectorEntry>;
  unknownLayer: {
    knownDimensions: string[];
    unknownDimensions: string[];
    completeness: number;
  };
}

export default function TrustBrainView(_props: { userRole?: string }) {
  const [passports, setPassports] = useState<PassportSummary[]>([]);
  const [passportId, setPassportId] = useState('');
  const [observation, setObservation] = useState<TrustObservation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<any[]>([]);
  const [comparison, setComparison] = useState<any | null>(null);
  const [verification, setVerification] = useState<Record<string, boolean>>({});

  useEffect(() => {
    apiFetch('/api/passports')
      .then(async response => {
        if (!response.ok) throw new Error('Could not load passports.');
        return response.json();
      })
      .then(data => {
        const list = Array.isArray(data) ? data : [];
        setPassports(list);
        if (list[0]) setPassportId(list[0].id);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const loadObservation = async (selectedId: string) => {
    if (!selectedId) return;
    setLoading(true);
    setError('');
    setObservation(null);
    try {
      const response = await apiFetch(`/api/passports/${encodeURIComponent(selectedId)}/trust-observation`);
      if (!response.ok) throw new Error('Trust observation could not be built.');
      setObservation(await response.json());
      const historyResponse = await apiFetch(`/api/passports/${encodeURIComponent(selectedId)}/trust-observations?limit=20`);
      if (!historyResponse.ok) throw new Error('Trust observation history could not be loaded.');
      const historyBody = await historyResponse.json();
      setHistory(Array.isArray(historyBody.items) ? historyBody.items : []);
    } catch (err: any) {
      setError(err?.message || 'Trust observation unavailable.');
    } finally {
      setLoading(false);
    }
  };

  const generateSnapshot = async () => {
    if (!passportId) return;
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch(`/api/passports/${encodeURIComponent(passportId)}/trust-observations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `manual:${passportId}:${crypto.randomUUID()}`
        },
        body: JSON.stringify({ generationReason: 'manual' })
      });
      if (!response.ok) throw new Error('Historical observation could not be generated.');
      await loadObservation(passportId);
    } catch (err: any) {
      setError(err?.message || 'Historical observation generation failed.');
      setLoading(false);
    }
  };

  const compareWithPrevious = async () => {
    const response = await apiFetch(`/api/passports/${encodeURIComponent(passportId)}/trust-observation-comparison`);
    if (!response.ok) return setError('Observation comparison could not be loaded.');
    setComparison(await response.json());
  };

  const verifySnapshot = async (id: string) => {
    const response = await apiFetch(`/api/trust-observations/${encodeURIComponent(id)}/verify`, { method: 'POST' });
    const body = await response.json();
    setVerification(current => ({ ...current, [id]: response.ok && body.matchesStoredHash === true }));
  };

  useEffect(() => {
    if (passportId) loadObservation(passportId);
  }, [passportId]);

  const vectors = observation ? Object.values(observation.vector) : [];

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <div className="flex items-center gap-2">
              <Brain className="h-6 w-6 text-indigo-500" />
              <h1 className="text-xl font-bold">AI Brain — Evidence View</h1>
            </div>
            <p className="mt-2 text-sm text-slate-500 dark:text-zinc-400">
              This view does not generate trust. It displays the server-side observation record and its unknown areas.
            </p>
          </div>
          <div className="flex gap-2">
            <select
              aria-label="Software Passport"
              value={passportId}
              onChange={event => setPassportId(event.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            >
              {passports.map(passport => (
                <option key={passport.id} value={passport.id}>{passport.name} {passport.version}</option>
              ))}
            </select>
            <button
              onClick={() => loadObservation(passportId)}
              disabled={!passportId || loading}
              className="rounded-xl border border-slate-300 p-2 disabled:opacity-40 dark:border-zinc-700"
              aria-label="Refresh observation"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {error && <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}
      {!loading && passports.length === 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-800">
          Add a Software Passport before requesting a trust observation.
        </div>
      )}
      {observation && (
        <>
          <p className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-200">
            Completeness measures how much of SPR’s defined observable evidence set is currently available. It does not measure whether the software is safe or compliant.
          </p>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-xs uppercase text-slate-500">Evidence coverage</p>
              <p className="mt-1 text-2xl font-bold">{Math.round(observation.unknownLayer.completeness * 100)}%</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-xs uppercase text-slate-500">Observed dimensions</p>
              <p className="mt-1 text-2xl font-bold">{observation.unknownLayer.knownDimensions.length}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-xs uppercase text-slate-500">Unknown dimensions</p>
              <p className="mt-1 text-2xl font-bold">{observation.unknownLayer.unknownDimensions.length}</p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {vectors.map(entry => (
              <section key={entry.dimension} className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-semibold capitalize">{entry.dimension.replace(/([A-Z])/g, ' $1')}</h2>
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${
                    entry.state === 'unknown' ? 'bg-slate-100 text-slate-600'
                      : entry.state === 'unavailable' || entry.state === 'expired' ? 'bg-rose-100 text-rose-700'
                      : entry.state === 'stale' ? 'bg-amber-100 text-amber-800'
                      : 'bg-indigo-100 text-indigo-700'
                  }`}>
                    {entry.state.replaceAll('_', ' ')} · score {entry.score ?? '—'}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-500">{entry.explanation}</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500">
                  <span>Confidence: {entry.confidence === null ? 'Unknown' : `${Math.round(entry.confidence * 100)}%`}</span>
                  <span>Completeness: {Math.round(entry.completeness * 100)}%</span>
                  <span>Evidence: {entry.evidenceCount}</span>
                  <span>Open findings: {entry.openFindingCount}</span>
                  <span>Freshness: {entry.freshnessStatus}</span>
                  <span>Next refresh: {entry.nextRefreshAt ? new Date(entry.nextRefreshAt).toLocaleString() : 'Unknown'}</span>
                </div>
                {entry.observations.map(item => (
                  <div key={item.evidenceId} className="mt-3 rounded-xl border border-slate-200 p-3 text-xs dark:border-zinc-700">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      <strong>{item.statement}</strong>
                    </div>
                    <p className="mt-2">Source: {item.source}</p>
                    <p>Method: {item.verificationMethod}</p>
                    <p>Recorded: {item.timestamp}</p>
                    <p>Confidence: {Math.round(item.confidence * 100)}%</p>
                  </div>
                ))}
                {entry.limitations.map(limitation => (
                  <p key={limitation} className="mt-2 text-xs text-slate-500">Limitation: {limitation}</p>
                ))}
                {entry.missingEvidence.map(missing => (
                  <div key={missing} className="mt-3 flex gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>Missing: {missing}</span>
                  </div>
                ))}
              </section>
            ))}
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">Immutable observation history</h2>
                <p className="mt-1 text-xs text-slate-500">Historical rows show what SPR reported at their generation time. They are not recalculated from current evidence.</p>
              </div>
              <div className="flex gap-2">
                <button onClick={compareWithPrevious} disabled={history.length < 2} className="rounded-lg border border-slate-300 px-3 py-2 text-xs disabled:opacity-40 dark:border-zinc-700">Compare latest</button>
                <button onClick={generateSnapshot} disabled={loading || !passportId} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Generate snapshot</button>
              </div>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead className="text-slate-500"><tr><th className="p-2">Version</th><th className="p-2">Generated</th><th className="p-2">Reason</th><th className="p-2">Known / Unknown</th><th className="p-2">Completeness</th><th className="p-2">Open findings</th><th className="p-2">Hash</th></tr></thead>
                <tbody>{history.map(item => (
                  <tr key={item.id} className="border-t border-slate-100 dark:border-zinc-800">
                    <td className="p-2 font-semibold">v{item.observationVersion}</td>
                    <td className="p-2">{new Date(item.generatedAt).toLocaleString()}</td>
                    <td className="p-2">{item.generationReason}</td>
                    <td className="p-2">{item.knownDimensionCount} / {item.unknownDimensionCount}</td>
                    <td className="p-2">{Math.round(item.completeness * 100)}%</td>
                    <td className="p-2">{item.openFindingCount}</td>
                    <td className="p-2"><button onClick={() => verifySnapshot(item.id)} className="text-indigo-600 underline">{verification[item.id] ? 'Hash matches' : 'Verify stored hash'}</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {comparison && (
              <div className="mt-4 rounded-xl bg-slate-50 p-4 text-xs dark:bg-zinc-950">
                <strong>Server comparison: v{comparison.previous?.observationVersion ?? '—'} → v{comparison.current.observationVersion}</strong>
                {comparison.changes.length === 0
                  ? <p className="mt-2 text-slate-500">No observable change was detected.</p>
                  : comparison.changes.map((change: any, index: number) => <p key={`${change.type}-${index}`} className="mt-2">{change.subject}: {change.type.replaceAll('_', ' ')}</p>)}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
