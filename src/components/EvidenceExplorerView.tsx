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
const STATUS_COLOR: Record<string, string> = { PASS: 'text-[#0e700e]', FAIL: 'text-[#a4262c]', UNKNOWN: 'text-[#8a5700]' };

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
    <section className="space-y-4 pb-8" aria-labelledby="evidence-explorer-title">
      <div className="mb-1 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 id="evidence-explorer-title" className="text-[22px] font-semibold text-[#201f1e]">Evidence Explorer</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[#605e5c]">{ledger?.trace || 'Claim → Evidence → Source → Timestamp → Hash → History. Select a finding to see exactly what backs it.'}</p>
        </div>
        <div>
          <label className="sr-only" htmlFor="evidence-explorer-passport">Passport</label>
          <select id="evidence-explorer-passport" value={passportId} onChange={(event) => setPassportId(event.target.value)} className="h-9 min-w-[240px] rounded border border-[#c8c6c4] px-3 text-[13px] text-[#323130] outline-none focus:border-[#0f6cbd] focus:ring-1 focus:ring-[#0f6cbd]">
            {!passports.length && <option value="">No passports loaded</option>}
            {passports.map((passport) => <option key={passport.id} value={passport.id}>{passport.name} · {passport.version}</option>)}
          </select>
        </div>
      </div>
      {error && <p role="alert" className="rounded-md border border-[#fdf2f2] bg-[#fdf2f2] px-3 py-2 text-[13px] text-[#a4262c]">{error}</p>}

      <details className="rounded-md border border-[#e1dfdd] bg-[#faf9f8] text-[13px]">
        <summary className="cursor-pointer select-none px-3 py-2 font-medium text-[#323130]">ⓘ What is this? · How it works</summary>
        <div className="px-3 pb-3 text-[#605e5c]">
          <p>Every claim SPR makes about a passport is traceable to the evidence that backs it, where it came from, when it was observed, and its integrity hash.</p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
            <li>Pick a passport to load its evidence ledger.</li>
            <li>Select a claim in the list to see its evidence chain, confidence context, and observation history.</li>
          </ol>
        </div>
      </details>

      {latestObservation && (
        <div className="rounded-md border border-[#e1dfdd] bg-white p-3 text-[13px] text-[#605e5c]">
          Latest observation v{latestObservation.observation_version} generated {new Date(latestObservation.generated_at).toLocaleString()} · evidence completeness {(latestObservation.completeness_basis_points / 100).toFixed(1)}% · {latestObservation.open_finding_count} open finding{latestObservation.open_finding_count === 1 ? '' : 's'} · hash <code className="text-[#323130]">{latestObservation.canonical_payload_hash.slice(0, 16)}…</code>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[.9fr_1.4fr]">
        <div className="rounded-md border border-[#e1dfdd] bg-white p-4">
          <h2 className="text-[14px] font-semibold text-[#201f1e]">Claims ({ledger?.findings.length ?? 0})</h2>
          <p className="mt-1 text-[12px] text-[#605e5c]">Each finding is a claim about this passport. Select one to see its evidence chain.</p>
          {loading && <div className="mt-3 space-y-2"><div className="h-12 animate-pulse rounded border border-[#e1dfdd] bg-[#f3f2f1]" /><div className="h-12 animate-pulse rounded border border-[#e1dfdd] bg-[#f3f2f1]" /></div>}
          {!loading && ledger && ledger.findings.length === 0 && <p className="mt-3 text-[13px] text-[#605e5c]">No findings recorded for this passport.</p>}
          <ul className="mt-3 max-h-[560px] space-y-1.5 overflow-auto pr-1">
            {ledger?.findings.map((finding) => (
              <li key={finding.id}>
                <button onClick={() => setSelectedFindingId(finding.id)} className={`w-full rounded-md border px-3 py-2.5 text-left text-[13px] transition ${selectedFindingId === finding.id ? 'border-[#0f6cbd] bg-[#eff6fc] text-[#201f1e]' : 'border-[#e1dfdd] bg-white text-[#323130] hover:bg-black/[.02]'}`}>
                  <div className="flex items-center justify-between gap-2"><span className="font-medium">{finding.title || finding.control_id}</span><ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#8a8886]" /></div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] uppercase tracking-wide text-[#8a8886]"><span>{finding.severity}</span><span>·</span><span>{finding.status}</span><span>·</span><span>{parseIds(finding.evidence_ids).length} evidence</span></div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-md border border-[#e1dfdd] bg-white p-4">
          {!selectedFinding ? (
            <div className="grid h-full min-h-[280px] place-items-center text-center text-[13px] text-[#605e5c]">
              <div><Fingerprint className="mx-auto h-6 w-6 text-[#c8c6c4]" /><p className="mt-2">Select a claim to see Claim → Evidence → Source → Timestamp → Hash → History.</p></div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[#605e5c]">Claim</div>
                <h2 className="mt-1 text-[16px] font-semibold text-[#201f1e]">{selectedFinding.title || selectedFinding.control_id}</h2>
                <p className="mt-1 text-[12px] text-[#605e5c]">Control {selectedFinding.control_id} · {selectedFinding.severity} · {selectedFinding.status} · fingerprint <code className="text-[#323130]">{selectedFinding.fingerprint}</code></p>
              </div>

              <div>
                <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[#605e5c]">Evidence ({claimEvidence.length})</h3>
                {claimEvidence.length === 0 && <p className="mt-1.5 text-[13px] text-[#605e5c]">No evidence records are linked to this claim's evidence_ids.</p>}
                <div className="mt-2 space-y-2">
                  {claimEvidence.map((item) => {
                    const StatusIcon = STATUS_ICON[item.status] || ShieldQuestion;
                    return (
                      <div key={item.id} className="rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-3 text-[13px]">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 font-medium text-[#201f1e]"><StatusIcon className={`h-3.5 w-3.5 ${STATUS_COLOR[item.status] || 'text-[#605e5c]'}`} />{item.provider} · {item.subject}</div>
                          <span className="text-[#605e5c]">{item.verification_method}</span>
                        </div>
                        <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                          <div><dt className="text-[11px] uppercase tracking-wide text-[#8a8886]">Source</dt><dd className="mt-0.5 truncate text-[#323130]">{item.source_url ? <a href={item.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#0f6cbd] hover:underline"><Link2 className="h-3 w-3" />{item.source_url}</a> : 'No source URL recorded'}</dd></div>
                          <div><dt className="text-[11px] uppercase tracking-wide text-[#8a8886]">Timestamp</dt><dd className="mt-0.5 flex items-center gap-1 text-[#323130]"><Clock className="h-3 w-3 text-[#8a8886]" />{new Date(item.observed_at).toLocaleString()}</dd></div>
                          <div className="sm:col-span-2"><dt className="text-[11px] uppercase tracking-wide text-[#8a8886]">Hash</dt><dd className="mt-0.5 break-all font-mono text-[#605e5c]">{item.evidence_hash}</dd></div>
                        </dl>
                        {item.limitation && <p className="mt-2 rounded border border-[#fff4ce] bg-[#fff4ce] px-2.5 py-1.5 text-[11px] text-[#8a5700]">Limitation: {item.limitation}</p>}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[#605e5c]">Confidence</h3>
                <p className="mt-1.5 text-[13px] leading-5 text-[#605e5c]">
                  {latestObservation
                    ? <>SPR does not assign a per-claim confidence score. The passport's latest observation reports <strong className="text-[#323130]">{(latestObservation.completeness_basis_points / 100).toFixed(1)}% evidence completeness</strong> across {latestObservation.open_finding_count} open finding{latestObservation.open_finding_count === 1 ? '' : 's'} and {latestObservation.unknown_dimension_count} unknown dimension{latestObservation.unknown_dimension_count === 1 ? '' : 's'} — treat individual evidence status (PASS/FAIL/UNKNOWN) above as the per-item signal.</>
                    : 'No observation has been recorded for this passport yet, so no completeness figure is available.'}
                </p>
              </div>

              <div>
                <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[#605e5c]">History ({claimHistory.length} observation{claimHistory.length === 1 ? '' : 's'} referencing this claim)</h3>
                {claimHistory.length === 0 && <p className="mt-1.5 text-[13px] text-[#605e5c]">This claim has not appeared in a recorded observation yet.</p>}
                <ol className="mt-2 space-y-1.5">
                  {claimHistory.map((observation) => (
                    <li key={observation.id} className="flex items-start gap-2.5 rounded-md border border-[#e1dfdd] bg-[#faf9f8] p-2.5 text-[13px]">
                      <GitCommitVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#0f6cbd]" />
                      <div className="min-w-0">
                        <div className="text-[#323130]">v{observation.observation_version} · {new Date(observation.generated_at).toLocaleString()}</div>
                        <div className="mt-0.5 truncate font-mono text-[11px] text-[#8a8886]" title={observation.canonical_payload_hash}>{observation.canonical_payload_hash}</div>
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
