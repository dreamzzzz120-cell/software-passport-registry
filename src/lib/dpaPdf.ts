/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Renders the executed Data Processing Agreement as a PDF: the full document
 * text from src/legal/dpa-document.ts followed by the execution record and
 * the server signature, plus the URL where anyone can verify that signature.
 * The text is the same canonical wording the server hashed; the PDF adds
 * nothing to it.
 */

import { jsPDF } from 'jspdf';
import { DPA_PREAMBLE, DPA_EFFECTIVE_DATE, dpaAllSections } from '../legal/dpa-document';

export interface DpaExecutionView {
  id: string; documentVersion: string; documentSha256: string; customerLegalName: string;
  signatoryName: string; signatoryTitle: string; signatoryEmail: string; executedAt: string;
  signature: string; isCurrentVersion: boolean; verifyUrl: string;
}

export function buildDpaPdf(execution: DpaExecutionView): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 56;
  const width = doc.internal.pageSize.getWidth() - margin * 2;
  const pageHeight = doc.internal.pageSize.getHeight();
  let y = margin;

  const ensure = (needed: number) => { if (y + needed > pageHeight - margin) { doc.addPage(); y = margin; } };
  const text = (value: string, size: number, style: 'normal' | 'bold' = 'normal', gap = 6) => {
    doc.setFont('helvetica', style); doc.setFontSize(size);
    const lines = doc.splitTextToSize(value, width) as string[];
    const lineHeight = size * 1.35;
    for (const line of lines) { ensure(lineHeight); doc.text(line, margin, y); y += lineHeight; }
    y += gap;
  };

  text('Software Passport Registry — Data Processing Agreement', 16, 'bold', 4);
  text(`Version ${execution.documentVersion} · Effective ${DPA_EFFECTIVE_DATE} · Document SHA-256 ${execution.documentSha256}`, 8, 'normal', 12);

  text('Execution record', 12, 'bold', 4);
  for (const line of [
    `Customer: ${execution.customerLegalName}`,
    `Signatory: ${execution.signatoryName}, ${execution.signatoryTitle} (${execution.signatoryEmail})`,
    `Executed at: ${execution.executedAt}`,
    `Execution id: ${execution.id}`,
    `Server signature (HMAC-SHA256): ${execution.signature}`,
    `Verify at: ${execution.verifyUrl}`,
    'Processor: Software Passport Registry Ltd., British Columbia, Canada. Accepted electronically through the Service by the workspace Owner; the signature above was computed by SPR over the execution record and can be checked at the URL shown.',
  ]) text(line, 9, 'normal', 2);
  y += 10;

  for (const paragraph of DPA_PREAMBLE) text(paragraph, 9.5);
  for (const section of dpaAllSections()) {
    y += 4;
    text(section.heading, 11, 'bold', 3);
    for (const paragraph of section.paragraphs) text(paragraph, 9.5);
    for (const bullet of section.bullets ?? []) text(`• ${bullet}`, 9.5, 'normal', 3);
  }
  return doc;
}
