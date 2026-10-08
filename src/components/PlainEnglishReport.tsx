import { useEffect, useState, type ReactElement } from 'react';
import { AlertCircle, BookOpen, CheckCircle2, HelpCircle, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import type { PlainEnglishReport as ReportData } from '../trust/plain-english-report';

type ExplainedFinding = {
  id: string; whatWeFound: string; whyItMatters: string; howSerious: { level: string; explanation: string };
  whatWeKnow: string; whatWeDontKnow: string | null; whatToDoNext: string;
  status: 'Verified' | 'Needs Review' | 'Unknown' | 'Resolved';
};
type PlainEnglish = ReportData;

const STATUS_ICON: Record<string, ReactElement> = {
  Verified: <ShieldCheck className="h-4 w-4 text-[var(--spr-green)]" />, Resolved: <CheckCircle2 className="h-4 w-4 text-[var(--spr-green)]" />,
  'Needs Review': <AlertCircle className="h-4 w-4 text-[var(--spr-amber)]" />, Unknown: <HelpCircle className="h-4 w-4 text-[var(--spr-text-muted)]" />,
};
const STATUS_BORDER: Record<string, string> = {
  Verified: 'border-[var(--spr-green)]/40', Resolved: 'border-[var(--spr-green)]/40', 'Needs Review': 'border-[var(--spr-amber)]/40', Unknown: 'border-[var(--spr-border)]',
};

export default function PlainEnglishReport({ passportId, reportType }: { passportId: string; reportType: string }) {
  const [data, setData] = useState<PlainEnglish | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showGlossary, setShowGlossary] = useState(true);

  useEffect(() => {
    if (!passportId) return;
    let cancelled = false;
    setLoading(true); setError(''); setData(null);
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

  if (loading) return <div className="flex items-center gap-2 py-10 text-sm text-[var(--spr-text-muted)]"><Loader2 className="h-4 w-4 animate-spin" /> Generating a plain-English summary…</div>;
  if (error) return <div role="alert" className="rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-red)]/10 px-4 py-3 text-sm text-[var(--spr-red)]">{error}</div>;
  if (!data) return null;

  return (
    <div className="space-y-5">
      {data.readerGuide && <section className="spr-panel p-5" aria-label="How to read this report">
        <h2 className="text-xl font-bold">Software evidence report: {data.readerGuide.softwareName}</h2>
        <p className="mt-2 text-sm leading-6">{data.readerGuide.purpose}</p>
        <p className="mt-2 text-xs">Report generated: {data.generatedAt}. Dates in source records identify when observations were made.</p>
        <h3 className="mt-4 font-semibold">Start here — no technical background needed</h3>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm">{data.readerGuide.steps.map(step => <li key={step}>{step}</li>)}</ol>
      </section>}
      <div className="spr-panel p-5">
        <div className="text-xs font-bold uppercase tracking-[.18em] text-[var(--spr-highlight)]">At a glance</div>
        <h2 className="mt-2 text-xl font-bold text-[var(--spr-text)]">{data.headline}</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--spr-text-muted)]">{data.situation}</p>
        <div className="mt-4 rounded-md border border-[var(--spr-border)] bg-[var(--spr-surface-alt)] p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-[var(--spr-text-faint)]">Trust score</div>
          <div className="mt-1 text-2xl font-bold text-[var(--spr-text)]">{data.scoreExplanation.value === null ? 'Not yet calculable' : data.scoreExplanation.value}</div>
          <p className="mt-2 text-sm text-[var(--spr-text-muted)]">{data.scoreExplanation.explanation}</p>
          <p className="mt-2 text-xs italic text-[var(--spr-text-faint)]">{data.scoreExplanation.disclaimer}</p>
        </div>
        {(data.whatIsGood.length > 0 || data.whatNeedsAttention.length > 0) && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[var(--spr-green)]"><ShieldCheck className="h-4 w-4" /> What's good</div>
              <ul className="mt-2 space-y-1 text-sm text-[var(--spr-text)]">{data.whatIsGood.length ? data.whatIsGood.map((item, i) => <li key={i}>• {item}</li>) : <li className="text-[var(--spr-text-faint)]">Nothing to report yet.</li>}</ul>
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[var(--spr-amber)]"><AlertCircle className="h-4 w-4" /> What needs attention</div>
              <ul className="mt-2 space-y-1 text-sm text-[var(--spr-text)]">{data.whatNeedsAttention.length ? data.whatNeedsAttention.map((item, i) => <li key={i}>• {item}</li>) : <li className="text-[var(--spr-text-faint)]">Nothing currently needs attention.</li>}</ul>
            </div>
          </div>
        )}
      </div>

      {data.coverage && <section className="spr-panel p-5" aria-label="Coverage and limitations">
        <h3 className="font-bold">What this report covers — and what remains unknown</h3>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt>Connected-source evidence records</dt><dd>{data.coverage.evidenceRecords}</dd></div>
          <div><dt>Repository evidence records</dt><dd>{data.coverage.repositoryEvidenceRecords}</dd></div>
          <div><dt>Software ingredients recorded (SBOM components)</dt><dd>{data.coverage.components}</dd></div>
          <div><dt>Checks without enough information (unknown dimensions)</dt><dd>{data.coverage.unknownDimensions}</dd></div>
          <div><dt>Latest connected-source observation</dt><dd>{data.coverage.latestObservationAt ?? 'Not recorded; freshness cannot be established here'}</dd></div>
          <div><dt>Recorded verification status</dt><dd>{data.coverage.verificationStatus}</dd></div>
        </dl>
        <p className="mt-3 text-sm">Counts describe recorded material, not the percentage of your environment checked. Unknown dimensions are separate from individual findings.</p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">{data.readerGuide?.boundaries.map(item => <li key={item}>{item}</li>)}</ul>
      </section>}

      {data.actionPlan && <section className="spr-panel p-5" aria-label="Action plan">
        <h3 className="font-bold">Your next steps, in review order</h3>
        <p className="mt-2 text-sm">Ask your IT provider to confirm applicability, assign an owner, and agree a deadline. Neither has been assigned by this report.</p>
        {data.actionPlan.length === 0 ? <p className="mt-3 text-sm">No actions can be derived from the recorded findings. Review coverage before making a decision.</p> :
          <ol className="mt-3 list-decimal space-y-4 pl-5">{data.actionPlan.map(action => <li key={action.findingId} className="text-sm">
            <a className="font-semibold underline" href={`#finding-${action.findingId}`}>{action.title}</a>
            <p>{action.priority}</p><p className="mt-1">{action.nextStep}</p>
            <p className="mt-2"><strong>How to confirm completion:</strong> {action.completionEvidence}</p>
          </li>)}</ol>}
      </section>}

      {data.findings.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--spr-text)]">Findings, explained</h3>
          {data.findings.map((finding) => (
            <div id={`finding-${finding.id}`} key={finding.id} className={`spr-panel border p-4 ${STATUS_BORDER[finding.status]}`}>
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold text-[var(--spr-text)]">{finding.whatWeFound}</p>
                <span className="flex shrink-0 items-center gap-1.5 text-xs font-bold text-[var(--spr-text)]">{STATUS_ICON[finding.status]} {finding.status}</span>
              </div>
              <dl className="mt-3 space-y-2 text-xs">
                <div><dt className="font-bold uppercase tracking-wider text-[var(--spr-text-faint)]">Why it matters</dt><dd className="mt-0.5 text-[var(--spr-text-muted)]">{finding.whyItMatters}</dd></div>
                <div><dt className="font-bold uppercase tracking-wider text-[var(--spr-text-faint)]">How serious ({finding.howSerious.level})</dt><dd className="mt-0.5 text-[var(--spr-text-muted)]">{finding.howSerious.explanation}</dd></div>
                <div><dt className="font-bold uppercase tracking-wider text-[var(--spr-text-faint)]">What SPR knows</dt><dd className="mt-0.5 text-[var(--spr-text-muted)]">{finding.whatWeKnow}</dd></div>
                {finding.whatWeDontKnow && <div><dt className="font-bold uppercase tracking-wider text-[var(--spr-text-faint)]">What SPR doesn't know</dt><dd className="mt-0.5 text-[var(--spr-text-muted)]">{finding.whatWeDontKnow}</dd></div>}
                <div><dt className="font-bold uppercase tracking-wider text-[var(--spr-text-faint)]">What to do next</dt><dd className="mt-0.5 text-[var(--spr-text-muted)]">{finding.whatToDoNext}</dd></div>
              </dl>
              <details className="mt-3 text-sm"><summary className="cursor-pointer font-semibold">Original technical record</summary>
                <dl className="mt-2 space-y-1"><div><dt>Finding ID</dt><dd>{finding.id}</dd></div><div><dt>Check identifier (control)</dt><dd>{finding.technical.controlId}</dd></div><div><dt>Recorded status</dt><dd>{finding.technical.rawStatus}</dd></div><div><dt>Last recorded update</dt><dd>{finding.technical.updatedAt}</dd></div></dl>
              </details>
            </div>
          ))}
        </div>
      )}

      <div className="spr-panel p-4">
        <button aria-expanded={showGlossary} onClick={() => setShowGlossary((v) => !v)} className="flex w-full items-center justify-between text-sm font-semibold text-[var(--spr-text)]">
          <span className="flex items-center gap-1.5"><BookOpen className="h-4 w-4 text-[var(--spr-text-muted)]" /> Glossary</span>
          <span className="text-xs text-[var(--spr-text-faint)]">{showGlossary ? 'Hide' : 'Show'}</span>
        </button>
        {showGlossary && (
          <dl className="mt-3 space-y-2.5 border-t border-[var(--spr-border)] pt-3 text-xs">
            {Object.entries(data.glossary).map(([term, definition]) => (
              <div key={term}><dt className="font-bold text-[var(--spr-text)]">{term}</dt><dd className="mt-0.5 text-[var(--spr-text-muted)]">{definition}</dd></div>
            ))}
          </dl>
        )}
      </div>
      {data.sources && <section className="spr-panel p-5" aria-label="Evidence sources">
        <h3 className="font-bold">Where the information came from</h3>
        <p className="mt-2 text-sm">These are connected-source records. A shared check identifier is context, not proof that a record supports every finding. Repository evidence details remain in the technical report.</p>
        {data.sources.length === 0 ? <p className="mt-3 text-sm">No connected-source evidence records are included. Review repository coverage and the technical report separately.</p> :
          <ul className="mt-3 space-y-3 text-sm">{data.sources.map(source => <li key={source.id} className="rounded border border-[var(--spr-border)] p-3">
            <p><strong>{source.provider}</strong> · {source.id}</p><p>Check: {source.control_id}</p><p>Observed: {source.observed_at}</p><p>Method: {source.verification_method} · Recorded status: {source.status}</p><p>Limitations: {source.limitation || 'No limitation recorded for this source; this does not mean there are none.'}</p>
          </li>)}</ul>}
      </section>}
    </div>
  );
}

