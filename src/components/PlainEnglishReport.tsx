import { useEffect, useState, type ReactElement } from 'react';
import { AlertCircle, BookOpen, CheckCircle2, HelpCircle, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

type ExplainedFinding = {
  id: string; whatWeFound: string; whyItMatters: string; howSerious: { level: string; explanation: string };
  whatWeKnow: string; whatWeDontKnow: string | null; whatToDoNext: string;
  status: 'Verified' | 'Needs Review' | 'Unknown' | 'Resolved';
};
type PlainEnglish = {
  headline: string; situation: string; whatIsGood: string[]; whatNeedsAttention: string[];
  scoreExplanation: { value: number | null; explanation: string; disclaimer: string };
  findings: ExplainedFinding[]; glossary: Record<string, string>; generatedAt: string;
};

const STATUS_ICON: Record<string, ReactElement> = {
  Verified: <ShieldCheck className="h-4 w-4 text-[#89d185]" />, Resolved: <CheckCircle2 className="h-4 w-4 text-[#89d185]" />,
  'Needs Review': <AlertCircle className="h-4 w-4 text-[#cca700]" />, Unknown: <HelpCircle className="h-4 w-4 text-[#9d9d9d]" />,
};
const STATUS_BORDER: Record<string, string> = {
  Verified: 'border-[#89d185]/40', Resolved: 'border-[#89d185]/40', 'Needs Review': 'border-[#cca700]/40', Unknown: 'border-[#3c3c3c]',
};

export default function PlainEnglishReport({ passportId, reportType }: { passportId: string; reportType: string }) {
  const [data, setData] = useState<PlainEnglish | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showGlossary, setShowGlossary] = useState(false);

  useEffect(() => {
    if (!passportId) return;
    let cancelled = false;
    setLoading(true); setError('');
    apiFetch(`/api/trust-loop/reports/${encodeURIComponent(passportId)}/plain-english?type=${encodeURIComponent(reportType)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('SPR could not generate a plain-English report for this passport.');
        return response.json();
      })
      .then((body) => { if (!cancelled) setData(body); })
      .catch((e) => { if (!cancelled) setError(e?.message || 'Unable to load this report.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [passportId, reportType]);

  if (loading) return <div className="flex items-center gap-2 py-10 text-sm text-[#9d9d9d]"><Loader2 className="h-4 w-4 animate-spin" /> Generating a plain-English summary…</div>;
  if (error) return <div role="alert" className="rounded-md border border-[#f14c4c]/40 bg-[#f14c4c]/10 px-4 py-3 text-sm text-[#f14c4c]">{error}</div>;
  if (!data) return null;

  return (
    <div className="space-y-5">
      <div className="spr-panel p-5">
        <div className="text-xs font-bold uppercase tracking-[.18em] text-[#3794ff]">At a glance</div>
        <h2 className="mt-2 text-xl font-bold text-[#d4d4d4]">{data.headline}</h2>
        <p className="mt-2 text-sm leading-6 text-[#9d9d9d]">{data.situation}</p>
        <div className="mt-4 rounded-md border border-[#3c3c3c] bg-[#252526] p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-[#6f6f6f]">Trust score</div>
          <div className="mt-1 text-2xl font-bold text-[#d4d4d4]">{data.scoreExplanation.value === null ? 'Not yet calculable' : data.scoreExplanation.value}</div>
          <p className="mt-2 text-sm text-[#9d9d9d]">{data.scoreExplanation.explanation}</p>
          <p className="mt-2 text-xs italic text-[#6f6f6f]">{data.scoreExplanation.disclaimer}</p>
        </div>
        {(data.whatIsGood.length > 0 || data.whatNeedsAttention.length > 0) && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#89d185]"><ShieldCheck className="h-4 w-4" /> What's good</div>
              <ul className="mt-2 space-y-1 text-sm text-[#d4d4d4]">{data.whatIsGood.length ? data.whatIsGood.map((item, i) => <li key={i}>• {item}</li>) : <li className="text-[#6f6f6f]">Nothing to report yet.</li>}</ul>
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#cca700]"><AlertCircle className="h-4 w-4" /> What needs attention</div>
              <ul className="mt-2 space-y-1 text-sm text-[#d4d4d4]">{data.whatNeedsAttention.length ? data.whatNeedsAttention.map((item, i) => <li key={i}>• {item}</li>) : <li className="text-[#6f6f6f]">Nothing currently needs attention.</li>}</ul>
            </div>
          </div>
        )}
      </div>

      {data.findings.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-[#d4d4d4]">Findings, explained</h3>
          {data.findings.map((finding) => (
            <div key={finding.id} className={`spr-panel border p-4 ${STATUS_BORDER[finding.status]}`}>
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold text-[#d4d4d4]">{finding.whatWeFound}</p>
                <span className="flex shrink-0 items-center gap-1.5 text-xs font-bold text-[#d4d4d4]">{STATUS_ICON[finding.status]} {finding.status}</span>
              </div>
              <dl className="mt-3 space-y-2 text-xs">
                <div><dt className="font-bold uppercase tracking-wider text-[#6f6f6f]">Why it matters</dt><dd className="mt-0.5 text-[#9d9d9d]">{finding.whyItMatters}</dd></div>
                <div><dt className="font-bold uppercase tracking-wider text-[#6f6f6f]">How serious ({finding.howSerious.level})</dt><dd className="mt-0.5 text-[#9d9d9d]">{finding.howSerious.explanation}</dd></div>
                <div><dt className="font-bold uppercase tracking-wider text-[#6f6f6f]">What SPR knows</dt><dd className="mt-0.5 text-[#9d9d9d]">{finding.whatWeKnow}</dd></div>
                {finding.whatWeDontKnow && <div><dt className="font-bold uppercase tracking-wider text-[#6f6f6f]">What SPR doesn't know</dt><dd className="mt-0.5 text-[#9d9d9d]">{finding.whatWeDontKnow}</dd></div>}
                <div><dt className="font-bold uppercase tracking-wider text-[#6f6f6f]">What to do next</dt><dd className="mt-0.5 text-[#9d9d9d]">{finding.whatToDoNext}</dd></div>
              </dl>
            </div>
          ))}
        </div>
      )}

      <div className="spr-panel p-4">
        <button onClick={() => setShowGlossary((v) => !v)} className="flex w-full items-center justify-between text-sm font-semibold text-[#d4d4d4]">
          <span className="flex items-center gap-1.5"><BookOpen className="h-4 w-4 text-[#9d9d9d]" /> Glossary</span>
          <span className="text-xs text-[#6f6f6f]">{showGlossary ? 'Hide' : 'Show'}</span>
        </button>
        {showGlossary && (
          <dl className="mt-3 space-y-2.5 border-t border-[#3c3c3c] pt-3 text-xs">
            {Object.entries(data.glossary).map(([term, definition]) => (
              <div key={term}><dt className="font-bold text-[#d4d4d4]">{term}</dt><dd className="mt-0.5 text-[#9d9d9d]">{definition}</dd></div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}
