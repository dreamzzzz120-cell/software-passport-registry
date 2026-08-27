import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronRight, Clock, Fingerprint, GitCommitVertical, Link2, ShieldQuestion, XCircle } from 'lucide-react';
import type { SoftwarePassport } from '../types';
import { apiFetch } from '../utils/apiClient';

type LedgerEvidence = { id: string; provider: string; control_id: string; subject: string; source_url: string; observed_at: string; verification_method: string; status: 'PASS' | 'FAIL' | 'UNKNOWN'; severity: string; evidence_hash: string; limitation?: string | null };
type LedgerFinding = { id: string; control_id: string; title: string; severity: string; status: string; evidence_ids: string; fingerprint: string; updated_at: string; resolved_at?: string | null };
type LedgerObservation = { id: string; observation_version: number; generated_at: string; previous_observation_id: string | null; evidence_ids: string; finding_ids: string; canonical_payload_hash: string; completeness_basis_points: number; open_finding_count: number; unknown_dimension_count: number };
type Ledger = { observations: LedgerObservation[]; findings: LedgerFinding[]; evidence: LedgerEvidence[]; trace: string };

interface Props {
  passports?: SoftwarePassport[];
}

function responseError(data: any, fallback: string) {
  if (typeof data?.error === 'string') return data.error;
  if (typeof data?.error?.message === 'string') return data.error.message;
  return fallback;
}

function parseIds(value: string): string[] {
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
}

const STATUS_ICON: Record<string, typeof CheckCircle2> = { PASS: CheckCircle2, FAIL: XCircle, UNKNOWN: ShieldQuestion };
const STATUS_COLOR: Record<string, string> = { PASS: 'text-[#89d185]', FAIL: 'text-[#f14c4c]', UNKNOWN: 'text-amber-300' };

export default function EvidenceExplorerView({ passports = [] }: Props) {
  const [passportId, setPassportId] = useState(passports[0]?.id || '');
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);

  useEffect(() => {
    if (!passports.some((p) => p.id === passportId)) setPassportId(passports[0]?.id || '');
  }, [passports, passportId]);

  useEffect(() => {
    if (!passportId) { setLedger(null); return; }
    setLoading(true);
    setError(null);
    setSelectedFindingId(null);
    apiFetch(`/api/trust-loop/ledger/${encodeURIComponent(passportId)}`)
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(responseError(data, 'Unable to load the evidence ledger.'));
        setLedger(data as Ledger);
      })
      .catch((loadError) => { setLedger(null); setError(loadError instanceof Error ? loadError.message : 'Unable to load the evidence ledger.'); })
      .finally(() => setLoading(false));
  }, [passportId]);

  const evidenceById = useMemo(() => new Map((ledger?.evidence || []).map((item) => [item.id, item])), [ledger]);
  const selectedFinding = ledger?.findings.find((f) => f.id === selectedFindingId) || null;
  const claimEvidence = useMemo(() => selectedFinding ? parseIds(selectedFinding.evidence_ids).map((id) => evidenceById.get(id)).filter((item): item is LedgerEvidence => Boolean(item)) : [], [selectedFinding, evidenceById]);
  const claimHistory = useMemo(() => selectedFinding ? (ledger?.observations || []).filter((obs) => parseIds(obs.finding_ids).includes(selectedFinding.id)).sort((a, b) => b.observation_version - a.observation_version) : [], [selectedFinding, ledger]);
  const latestObservation = ledger?.observations[0];

  return (
    <section className="space-y-6" aria-labelledby="evidence-explorer-title">
      <header className="rounded-md border border-[#3c3c3c] bg-[#252526] p-6">
        <div className="text-[10px] font-bold uppercase tracking-[.22em] text-[#3794ff]">Evidence explorer</div>
        <h1 id="evidence-explorer-title" className="mt-2 text-3xl font-semibold tracking-tight">Every claim, traced to its evidence</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[#9d9d9d]">{ledger?.trace || 'Claim → Evidence → Source → Timestamp → Hash → History. Select a finding to see exactly what backs it.'}</p>
        <div className="mt-5">
          <label className="sr-only" htmlFor="evidence-explorer-passport">Passport</label>
          <select id="evidence-explorer-passport" value={passportId} onChange={(event) => setPassportId(event.target.value)} className="min-w-[260px] rounded-xl border border-[#3c3c3c] bg-[#0b101b] px-3 py-2.5 text-sm text-[#d4d4d4]">
            {!passports.length && <option value="">No passports loaded</option>}
            {passports.map((passport) => <option key={passport.id} value={passport.id}>{passport.name} · {passport.version}</option>)}
          </select>
        </div>
        {error && <p role="alert" className="mt-3 text-xs text-[#f14c4c]">{error}</p>}
      </header>

      {latestObservation && (
        <div className="rounded-md border border-[#3c3c3c] bg-[#252526] p-4 text-xs text-[#9d9d9d]">
          Latest observation v{latestObservation.observation_version} generated {new Date(latestObservation.generated_at).toLocaleString()} · evidence completeness {(latestObservation.completeness_basis_points / 100).toFixed(1)}% · {latestObservation.open_finding_count} open finding{latestObservation.open_finding_count === 1 ? '' : 's'} · hash <code className="text-[#d4d4d4]">{latestObservation.canonical_payload_hash.slice(0, 16)}…</code>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[.9fr_1.4fr]">
        <div className="rounded-md border border-[#3c3c3c] bg-[#252526] p-5">
          <h2 className="text-sm font-semibold text-[#d4d4d4]">Claims ({ledger?.findings.length ?? 0})</h2>
          <p className="mt-1 text-xs text-[#9d9d9d]">Each finding is a claim about this passport. Select one to see its evidence chain.</p>
          {loading && <div className="mt-4 space-y-2"><div className="h-14 animate-pulse rounded-xl bg-[#252526]" /><div className="h-14 animate-pulse rounded-xl bg-[#252526]" /></div>}
          {!loading && ledger && ledger.findings.length === 0 && <p className="mt-4 text-xs text-[#9d9d9d]">No findings recorded for this passport.</p>}
          <ul className="mt-4 max-h-[560px] space-y-2 overflow-auto pr-1">
            {ledger?.findings.map((finding) => (
              <li key={finding.id}>
                <button onClick={() => setSelectedFindingId(finding.id)} className={`w-full rounded-xl border px-3 py-3 text-left text-xs transition ${selectedFindingId === finding.id ? 'border-[#3794ff]/40 bg-[#094771] text-[#d4d4d4]' : 'border-[#3c3c3c] bg-[#181818] text-[#d4d4d4] hover:border-[#3794ff]/40'}`}>
                  <div className="flex items-center justify-between gap-2"><span className="font-semibold">{finding.title || finding.control_id}</span><ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#6f6f6f]" /></div>
                  <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-[#9d9d9d]"><span>{finding.severity}</span><span>·</span><span>{finding.status}</span><span>·</span><span>{parseIds(finding.evidence_ids).length} evidence</span></div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-md border border-[#3c3c3c] bg-[#252526] p-5">
          {!selectedFinding ? (
            <div className="grid h-full min-h-[300px] place-items-center text-center text-sm text-[#9d9d9d]">
              <div><Fingerprint className="mx-auto h-8 w-8 text-[#6f6f6f]" /><p className="mt-3">Select a claim to see Claim → Evidence → Source → Timestamp → Hash → History.</p></div>
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[.2em] text-[#3794ff]">Claim</div>
                <h2 className="mt-1 text-lg font-semibold text-[#d4d4d4]">{selectedFinding.title || selectedFinding.control_id}</h2>
                <p className="mt-1 text-xs text-[#9d9d9d]">Control {selectedFinding.control_id} · {selectedFinding.severity} · {selectedFinding.status} · fingerprint <code className="text-[#9d9d9d]">{selectedFinding.fingerprint}</code></p>
              </div>

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[#9d9d9d]">Evidence ({claimEvidence.length})</h3>
                {claimEvidence.length === 0 && <p className="mt-2 text-xs text-[#9d9d9d]">No evidence records are linked to this claim's evidence_ids.</p>}
                <div className="mt-3 space-y-3">
                  {claimEvidence.map((item) => {
                    const StatusIcon = STATUS_ICON[item.status] || ShieldQuestion;
                    return (
                      <div key={item.id} className="rounded-md border border-[#3c3c3c] bg-[#181818] p-4 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 font-semibold text-[#d4d4d4]"><StatusIcon className={`h-3.5 w-3.5 ${STATUS_COLOR[item.status] || 'text-[#9d9d9d]'}`} />{item.provider} · {item.subject}</div>
                          <span className="text-[#9d9d9d]">{item.verification_method}</span>
                        </div>
                        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                          <div><dt className="text-[10px] uppercase tracking-wide text-[#6f6f6f]">Source</dt><dd className="mt-0.5 truncate text-[#d4d4d4]">{item.source_url ? <a href={item.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#3794ff] hover:underline"><Link2 className="h-3 w-3" />{item.source_url}</a> : 'No source URL recorded'}</dd></div>
                          <div><dt className="text-[10px] uppercase tracking-wide text-[#6f6f6f]">Timestamp</dt><dd className="mt-0.5 flex items-center gap-1 text-[#d4d4d4]"><Clock className="h-3 w-3 text-[#6f6f6f]" />{new Date(item.observed_at).toLocaleString()}</dd></div>
                          <div className="sm:col-span-2"><dt className="text-[10px] uppercase tracking-wide text-[#6f6f6f]">Hash</dt><dd className="mt-0.5 break-all font-mono text-[#9d9d9d]">{item.evidence_hash}</dd></div>
                        </dl>
                        {item.limitation && <p className="mt-3 rounded-lg border border-amber-300/15 bg-amber-300/[.05] px-3 py-2 text-[11px] text-amber-100/80">Limitation: {item.limitation}</p>}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[#9d9d9d]">Confidence</h3>
                <p className="mt-2 text-xs leading-5 text-[#9d9d9d]">
                  {latestObservation
                    ? <>SPR does not assign a per-claim confidence score. The passport's latest observation reports <strong className="text-[#d4d4d4]">{(latestObservation.completeness_basis_points / 100).toFixed(1)}% evidence completeness</strong> across {latestObservation.open_finding_count} open finding{latestObservation.open_finding_count === 1 ? '' : 's'} and {latestObservation.unknown_dimension_count} unknown dimension{latestObservation.unknown_dimension_count === 1 ? '' : 's'} — treat individual evidence status (PASS/FAIL/UNKNOWN) above as the per-item signal.</>
                    : 'No observation has been recorded for this passport yet, so no completeness figure is available.'}
                </p>
              </div>

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[#9d9d9d]">History ({claimHistory.length} observation{claimHistory.length === 1 ? '' : 's'} referencing this claim)</h3>
                {claimHistory.length === 0 && <p className="mt-2 text-xs text-[#9d9d9d]">This claim has not appeared in a recorded observation yet.</p>}
                <ol className="mt-3 space-y-2">
                  {claimHistory.map((observation) => (
                    <li key={observation.id} className="flex items-start gap-3 rounded-xl border border-[#3c3c3c] bg-black/15 p-3 text-xs">
                      <GitCommitVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#3794ff]/70" />
                      <div className="min-w-0">
                        <div className="text-[#d4d4d4]">v{observation.observation_version} · {new Date(observation.generated_at).toLocaleString()}</div>
                        <div className="mt-0.5 truncate font-mono text-[10px] text-[#6f6f6f]" title={observation.canonical_payload_hash}>{observation.canonical_payload_hash}</div>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
