import { useState } from 'react';
import { evidenceGapPlanText, type EvidenceGapPlan } from '../trust/evidence-gap-plan';

export default function EvidenceGapPlanPanel({ plan }: { plan: EvidenceGapPlan }) {
  const [notice, setNotice] = useState('');
  const copyQuestions = async () => {
    const text = [`Evidence questions for ${plan.productName}`, `Report: ${plan.reportHash ?? plan.generatedAt}`,
      'Please identify the source, date and scope of each response. Responses require review before a status changes.', '',
      ...plan.actions.map((action, index) => `${index + 1}. ${action.question}`)].join('\n');
    try { await navigator.clipboard.writeText(text); setNotice('Questions copied for review.'); }
    catch { setNotice('Copy failed. Download the review plan instead.'); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([evidenceGapPlanText(plan)], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'spr-software-review-plan.txt';
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  };
  return (
    <section className="spr-panel p-5" aria-label="Evidence gaps and review plan">
      <h3 className="text-lg font-semibold text-[var(--spr-text)]">Turn evidence gaps into next steps</h3>
      <p className="mt-2 break-all text-xs text-[var(--spr-text-faint)]">Snapshot: {plan.generatedAt} · Report hash: {plan.reportHash ?? 'Not supplied'}</p>
      <p className="mt-2 text-sm leading-6 text-[var(--spr-text-muted)]">{plan.limitation}</p>
      <p className="mt-2 text-xs text-[var(--spr-text-faint)]">{plan.actions.length} proposed review item{plan.actions.length === 1 ? '' : 's'}. Items may overlap; this is not a count of distinct risks. Owners are unassigned.</p>
      <div className="mt-3 flex flex-wrap gap-3 print:hidden">
        <button type="button" onClick={() => void copyQuestions()} disabled={!plan.actions.length} className="spr-btn spr-btn-primary disabled:opacity-40">Copy evidence questions</button>
        <button type="button" onClick={download} className="spr-btn">Download review plan</button>
      </div>
      {notice && <p role="status" className="mt-2 text-xs">{notice}</p>}
      {!plan.actions.length && <p className="mt-4 text-sm">No proposed actions were derived from this report. This does not establish complete coverage or software approval.</p>}
      <div className="mt-4 space-y-3">
        {plan.actions.map(action => (
          <article key={action.id} className="rounded-md border border-[var(--spr-border)] p-4">
            <div className="flex flex-wrap justify-between gap-2">
              <h4 className="text-sm font-semibold">{action.title}</h4>
              <span className="text-xs font-bold">{action.status === 'UNKNOWN' ? 'Unknown' : 'Needs review'}</span>
            </div>
            <dl className="mt-3 space-y-2 text-sm">
              <div><dt className="font-semibold">What is missing or unresolved</dt><dd>{action.reason}</dd></div>
              <div><dt className="font-semibold">Why it matters</dt><dd>{action.whyItMatters}</dd></div>
              <div><dt className="font-semibold">Evidence to request</dt><dd>{action.requestedEvidence}</dd></div>
              <div><dt className="font-semibold">Question for the source owner</dt><dd>{action.question}</dd></div>
              <div><dt className="font-semibold">Next step</dt><dd>{action.nextStep}</dd></div>
              <div><dt className="font-semibold">Suggested recipient</dt><dd>{action.suggestedRecipient}</dd></div>
              <div><dt className="font-semibold">Owner</dt><dd>Unassigned</dd></div>
              <div><dt className="font-semibold">What must happen before closure</dt><dd>{action.completionCriteria}</dd></div>
            </dl>
            <div className="mt-3 border-t border-[var(--spr-border)] pt-2 text-xs text-[var(--spr-text-faint)]">
              <p>Basis: {action.basis}. {action.controlId && <>Control: {action.controlId}. </>}{action.findingId && <>Finding: {action.findingId}.</>}</p>
              <p>Matching source records: confirm their scope before relying on them.</p>
              {action.evidence.length ? <ul className="mt-1 space-y-1">{action.evidence.map(e => <li key={e.id} className="break-words">{e.id} · {e.provider} · {e.status} · {e.observedAt}<br />Source: {e.sourceUrl ?? 'Not supplied'} · Method: {e.verificationMethod} · Hash: {e.hash ?? 'Not supplied'}</li>)}</ul> : <p>No matching source records supplied in this report.</p>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
