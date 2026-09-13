/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Public Data Processing Agreement page, rendered from the same document
 * module the server hashes and the PDF embeds. Also handles the
 * verification view: /dpa/verify/<executionId>/<signature> asks the API
 * whether that execution is genuine and shows exactly what it answers.
 */

import { useEffect, useState } from 'react';
import LegalPageLayout from './LegalPageLayout';
import { DPA_PREAMBLE, DPA_EFFECTIVE_DATE, DPA_VERSION, dpaAllSections } from '../../legal/dpa-document';
import { apiFetch } from '../../utils/apiClient';

interface VerifyResult {
  verified: boolean;
  execution?: { id: string; documentVersion: string; documentSha256: string; customerLegalName: string; signatoryName: string; signatoryTitle: string; signatoryEmail: string; executedAt: string; isCurrentVersion: boolean };
  currentVersion?: string;
  error?: string;
  message?: string;
}

export default function DpaView({ verify }: { verify?: { executionId: string; signature: string } }) {
  const [serverInfo, setServerInfo] = useState<{ version: string; sha256: string } | null>(null);
  const [result, setResult] = useState<VerifyResult | 'loading' | null>(verify ? 'loading' : null);

  useEffect(() => {
    apiFetch('/api/public/dpa').then(async (r) => { if (r.ok) setServerInfo(await r.json()); }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!verify) return;
    let cancelled = false;
    apiFetch(`/api/public/dpa/verify/${encodeURIComponent(verify.executionId)}/${encodeURIComponent(verify.signature)}`)
      .then(async (r) => { const data = await r.json().catch(() => ({})); if (!cancelled) setResult({ verified: r.ok && data.verified === true, ...data }); })
      .catch((err) => { if (!cancelled) setResult({ verified: false, error: err instanceof Error ? err.message : 'network' }); });
    return () => { cancelled = true; };
  }, [verify]);

  return (
    <LegalPageLayout title="Data Processing Agreement" lastUpdated={DPA_EFFECTIVE_DATE}>
      {verify && (
        <div className={`rounded-md border p-5 ${result === 'loading' ? 'border-[var(--spr-border)]' : result?.verified ? 'border-[var(--spr-green)]/40 bg-[var(--spr-green)]/5' : 'border-[var(--spr-red)]/40 bg-[var(--spr-red)]/5'}`}>
          {result === 'loading' ? <p>Checking signature…</p> : result?.verified && result.execution ? (
            <div>
              <div className="text-base font-semibold text-[var(--spr-text)]">Signature verified.</div>
              <p className="mt-1">This execution record was signed by Software Passport Registry and has not been altered.</p>
              <ul className="mt-3">
                <li>Customer: <strong>{result.execution.customerLegalName}</strong></li>
                <li>Signatory: {result.execution.signatoryName}, {result.execution.signatoryTitle} ({result.execution.signatoryEmail})</li>
                <li>Executed: {new Date(result.execution.executedAt).toLocaleString()}</li>
                <li>Document version: {result.execution.documentVersion}{result.execution.isCurrentVersion ? ' (current)' : ` — the current version is ${result.currentVersion}`}</li>
                <li>Document SHA-256: <code>{result.execution.documentSha256}</code></li>
                <li>Execution id: <code>{result.execution.id}</code></li>
              </ul>
            </div>
          ) : (
            <div>
              <div className="text-base font-semibold text-[var(--spr-text)]">Not verified.</div>
              <p className="mt-1">{result?.message || 'No execution with this id and signature exists. The link may have been altered, or the record may have been deleted with its workspace.'}</p>
            </div>
          )}
        </div>
      )}

      <p>Version <strong>{DPA_VERSION}</strong>{serverInfo && serverInfo.version === DPA_VERSION ? <> · canonical SHA-256 <code>{serverInfo.sha256}</code></> : null}. Workspace Owners execute this agreement from Settings → Data Processing Agreement; the executed copy is signed by SPR and downloadable as a PDF, and any copy can be verified by its signature.</p>
      {DPA_PREAMBLE.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
      {dpaAllSections().map((section) => (
        <section key={section.heading}>
          <h2>{section.heading}</h2>
          {section.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
          {section.bullets && <ul>{section.bullets.map((bullet, index) => <li key={index}>{bullet}</li>)}</ul>}
        </section>
      ))}
    </LegalPageLayout>
  );
}
