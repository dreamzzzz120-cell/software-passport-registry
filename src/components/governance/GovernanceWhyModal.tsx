import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, X } from 'lucide-react';
import { apiFetch } from '../../utils/apiClient';

type Evidence = {
  id: string; provider: string; controlId: string; sourceUrl: string; observedAt: string;
  verificationMethod: string; status: 'PASS' | 'FAIL' | 'UNKNOWN'; severity: string; evidenceHash: string;
  limitation: string | null; evidenceType: string | null; confidenceBasisPoints: number | null; reviewAt: string | null;
};
type WhyResult = {
  conclusion: { type: 'control' | 'finding'; id: string; title: string; status: string };
  latestTest?: { id: string; result: string; testedAt: string; testerName: string; methodology: string } | null;
  evidence: Evidence[];
  chainComplete: boolean;
  missing: string[];
};

export default function GovernanceWhyModal({ kind, id, onClose }: { kind: 'control' | 'finding'; id: string; onClose: () => void }) {
  const [data, setData] = useState<WhyResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    apiFetch(`/api/governance/why/${kind}/${encodeURIComponent(id)}`)
      .then(async (r) => { if (!r.ok) throw new Error('Unable to load the evidence chain for this item.'); return r.json(); })
      .then((body) => { if (!cancelled) setData(body); })
      .catch((e) => { if (!cancelled) setError(e?.message || 'Unable to load the evidence chain.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [kind, id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl rounded-md border border-[#3c3c3c] bg-[#252526] p-6 shadow-2xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-bold text-[#d4d4d4]">Why?</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-[#9d9d9d] hover:bg-[#383838]"><X className="h-4 w-4" /></button>
        </div>
        {loading && <div className="mt-6 flex items-center gap-2 text-sm text-[#9d9d9d]"><Loader2 className="h-4 w-4 animate-spin" /> Tracing the evidence chain…</div>}
        {error && <div role="alert" className="mt-4 rounded-md border border-[#f14c4c]/40 bg-[#f14c4c]/10 px-4 py-3 text-sm text-[#f14c4c]">{error}</div>}
        {data && (
          <div className="mt-4 space-y-4">
            <div className="rounded-md border border-[#3c3c3c] bg-[#181818] p-4">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#6f6f6f]">Conclusion</div>
              <p className="mt-1 text-sm font-semibold text-[#d4d4d4]">{data.conclusion.title}</p>
              <p className="mt-0.5 text-xs text-[#9d9d9d]">Status: {data.conclusion.status}</p>
            </div>

            {data.latestTest !== undefined && (
              <div className="rounded-md border border-[#3c3c3c] bg-[#181818] p-4">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#6f6f6f]">Latest control test</div>
                {data.latestTest ? (
                  <div className="mt-1 text-xs text-[#9d9d9d]">
                    <p><span className="font-semibold text-[#d4d4d4]">{data.latestTest.result}</span> by {data.latestTest.testerName} on {new Date(data.latestTest.testedAt).toLocaleString()}</p>
                    {data.latestTest.methodology && <p className="mt-1">Methodology: {data.latestTest.methodology}</p>}
                  </div>
                ) : <p className="mt-1 text-xs italic text-[#6f6f6f]">No test has been recorded.</p>}
              </div>
            )}

            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#6f6f6f]">Evidence ({data.evidence.length})</div>
              {data.evidence.length === 0 ? (
                <p className="mt-2 text-xs italic text-[#6f6f6f]">No evidence records were found for this conclusion.</p>
              ) : (
                <div className="mt-2 space-y-2">
                  {data.evidence.map((e) => (
                    <div key={e.id} className="rounded-md border border-[#3c3c3c] bg-[#181818] p-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[#d4d4d4]">{e.provider} · {e.controlId}</span>
                        <span className={`rounded-sm border px-1.5 py-0.5 text-[9px] font-bold uppercase ${e.status === 'PASS' ? 'border-[#89d185]/40 text-[#89d185]' : e.status === 'FAIL' ? 'border-[#f14c4c]/40 text-[#f14c4c]' : 'border-[#3c3c3c] text-[#9d9d9d]'}`}>{e.status}</span>
                      </div>
                      <p className="mt-1 text-[#9d9d9d]">Observed {new Date(e.observedAt).toLocaleString()} · {e.verificationMethod}</p>
                      {e.sourceUrl && <a href={e.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[#3794ff] hover:underline">Source <ExternalLink className="h-3 w-3" /></a>}
                      <p className="mt-1 break-all font-mono text-[10px] text-[#6f6f6f]">{e.evidenceHash}</p>
                      {e.limitation && <p className="mt-1 italic text-[#cca700]">{e.limitation}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={`rounded-md border p-4 ${data.chainComplete ? 'border-[#89d185]/40 bg-[#89d185]/10' : 'border-[#cca700]/40 bg-[#cca700]/10'}`}>
              <div className="flex items-center gap-2 text-sm font-bold">
                {data.chainComplete ? <CheckCircle2 className="h-4 w-4 text-[#89d185]" /> : <AlertTriangle className="h-4 w-4 text-[#cca700]" />}
                <span className={data.chainComplete ? 'text-[#89d185]' : 'text-[#cca700]'}>{data.chainComplete ? 'Verification chain complete' : 'Verification chain incomplete'}</span>
              </div>
              {data.missing.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-[#d4d4d4]">
                  {data.missing.map((m, i) => <li key={i}>• {m}</li>)}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
