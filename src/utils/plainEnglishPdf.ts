import { jsPDF } from 'jspdf';
import type { PlainEnglishReport } from '../trust/plain-english-report';

/** Export the exact loaded explanation; never fetch another assessment. */
export function buildPlainEnglishPdf(report: PlainEnglishReport, freeTrial = false): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const left = 18;
  const width = 174;
  let y = 22;
  doc.setCharSpace(0);
  const pageBottom = 270;
  // Built-in PDF fonts do not contain every Unicode glyph. Normalize punctuation
  // only; original records remain available in JSON and the report screen.
  const printable = (text: string) => text.replace(/[\u2010-\u2015]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\u2026/g, '...');
  const paragraph = (text: string, size = 10, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(30, 41, 59);
    const lines = doc.splitTextToSize(printable(text), width) as string[];
    const lineHeight = size * 0.46;
    for (const line of lines) {
      if (y + lineHeight > pageBottom) { doc.addPage(); y = 22; }
      doc.text(line, left, y);
      y += lineHeight;
    }
    y += 3;
  };
  const heading = (text: string) => {
    if (y + 28 > pageBottom) { doc.addPage(); y = 22; }
    y += 4;
    doc.setDrawColor(15, 108, 189);
    doc.line(left, y, left + width, y);
    y += 8;
    paragraph(text, 14, true);
  };
  const field = (label: string, value: string) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const valueLines = doc.splitTextToSize(printable(value), width) as string[];
    // Keep each label with at least the first two lines of its value.
    const needed = 9 * 0.46 + 3 + Math.min(valueLines.length, 2) * 4.6;
    if (y + needed > pageBottom) { doc.addPage(); y = 22; }
    paragraph(label, 9, true);
    paragraph(value);
  };

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 210, 49, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(94, 234, 212);
  doc.setFontSize(9);
  doc.text('SOFTWARE PASSPORT REGISTRY', left, 17);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(23);
  doc.text('Software evidence report', left, 33);
  y = 62;
  paragraph(report.readerGuide?.softwareName ?? 'Recorded software assessment', 15, true);
  field('Report generated', report.generatedAt);
  paragraph(report.readerGuide?.purpose ?? 'A point-in-time explanation of recorded evidence, findings, and unknowns.');
  heading('1. Your summary');
  paragraph(report.headline, 13, true);
  paragraph(report.situation);
  field('Recorded trust score', report.scoreExplanation.value === null ? 'Not calculable' : String(report.scoreExplanation.value));
  paragraph(report.scoreExplanation.explanation);
  paragraph(report.scoreExplanation.disclaimer, 9);
  if (report.readerGuide) {
    heading('2. How to use this report');
    report.readerGuide.steps.forEach((step, i) => paragraph(`${i + 1}. ${step}`));
  }
  if (report.coverage) {
    heading('3. Coverage and missing information');
    field('Connected-source evidence records', String(report.coverage.evidenceRecords));
    field('Repository evidence records', report.coverage.repositoryEvidenceRecords === null ? 'Not recorded' : String(report.coverage.repositoryEvidenceRecords));
    field('Software ingredients recorded (SBOM components)', report.coverage.components === null ? 'Not recorded' : String(report.coverage.components));
    field('Checks without enough information (unknown dimensions)', String(report.coverage.unknownDimensions));
    field('Latest connected-source observation', report.coverage.latestObservationAt ?? 'Not recorded; freshness cannot be established here.');
    field('Recorded verification status', report.coverage.verificationStatus);
    paragraph('Counts describe recorded material, not the percentage of your environment checked. Unknown dimensions are separate from individual findings.');
    report.readerGuide?.boundaries.forEach(item => paragraph(item, 9));
  }
  heading('4. Your action plan');
  paragraph('Ask your IT provider to confirm applicability, assign an owner, and agree a deadline. Neither has been assigned by this report.');
  if (!report.actionPlan?.length) paragraph('No actions can be derived from the recorded findings. Review coverage before making a decision.');
  report.actionPlan?.forEach((action, i) => {
    paragraph(`${i + 1}. ${action.title}`, 11, true);
    field('Review priority', action.priority);
    field('Next step', action.nextStep);
    field('How to confirm completion', action.completionEvidence);
    field('Finding reference', action.findingId);
  });
  if (report.reviewPlan) {
    heading('Evidence requests and closure criteria');
    field('Report reference', report.reviewPlan.reportHash ?? 'Unavailable');
    paragraph(report.reviewPlan.limitation);
    report.reviewPlan.actions.forEach(action => {
      paragraph(action.title, 12, true);
      field('Reference and outcome', `${action.id}; ${action.status}`);
      field('Why review is needed', action.reason);
      field('Why it matters', action.whyItMatters);
      field('Evidence to request', action.requestedEvidence);
      field('Question for the source owner', action.question);
      field('Suggested contact', action.suggestedRecipient);
      field('Owner', 'Unassigned');
      field('Next step', action.nextStep);
      field('Closure criteria', action.completionCriteria);
      action.evidence.forEach(source => field('Supporting source', `${source.id}; ${source.provider}; ${source.observedAt}; ${source.status}; method: ${source.verificationMethod}; URL: ${source.sourceUrl ?? 'Unavailable'}; hash: ${source.hash ?? 'Unavailable'}`));
    });
  }
  heading('5. Findings explained');
  if (!report.findings.length) paragraph('No findings recorded. This is not an all-clear.');
  report.findings.forEach(finding => {
    paragraph(finding.whatWeFound, 12, true);
    field('Recorded outcome', finding.status);
    field('Why it matters', finding.whyItMatters);
    field(`How serious (${finding.howSerious.level})`, finding.howSerious.explanation);
    field('What SPR knows', finding.whatWeKnow);
    if (finding.whatWeDontKnow) field('What remains unknown', finding.whatWeDontKnow);
    field('What to do next', finding.whatToDoNext);
    field('Original record reference', `${finding.id}; check: ${finding.technical.controlId}; status: ${finding.technical.rawStatus}; last update: ${finding.technical.updatedAt}`);
  });
  heading('6. Evidence source records');
  paragraph('These are connected-source records. A shared check identifier is context, not proof that a source supports every finding. Repository evidence details remain in the technical report.');
  if (!report.sources?.length) paragraph('No connected-source evidence records included. Review repository coverage separately.');
  report.sources?.forEach(source => {
    paragraph(`${source.provider} - ${source.id}`, 11, true);
    field('Check and observation date', `${source.control_id}; ${source.observed_at}`);
    field('Recorded method and status', `${source.verification_method}; ${source.status}`);
    field('Source limitations', source.limitation || 'No limitation recorded; this does not mean there are none.');
  });
  heading('7. Plain-language glossary');
  Object.entries(report.glossary).forEach(([term, definition]) => field(term, definition));

  const count = doc.getNumberOfPages();
  for (let page = 1; page <= count; page++) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    if (page > 1) {
      doc.text('SPR / SOFTWARE EVIDENCE REPORT', left, 12);
      doc.setDrawColor(226, 232, 240);
      doc.line(left, 15, left + width, 15);
    }
    doc.text('Point-in-time evidence; not a security or compliance guarantee.', left, 283);
    doc.text(`Page ${page} of ${count}`, left + width, 289, { align: 'right' });
  }
  if (freeTrial) {
    for (let page = 1; page <= doc.getNumberOfPages(); page++) {
      doc.setPage(page);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.setTextColor(170, 180, 195);
      doc.text('SPR FREE TRIAL - SAMPLE REPORT', 105, 150, { align: 'center', angle: 35 });
      doc.setFontSize(8);
      doc.text('Free trial copy - evidence limitations still apply', 105, 291, { align: 'center' });
    }
  }
  return doc;
}
