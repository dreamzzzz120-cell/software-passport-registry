/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ClaimId, NormalizedEvidence, SourceIdentity } from './verificationPolicy.ts';

/**
 * Maps real `evidence_items` rows onto the normalized shape the evaluator
 * consumes. This is the ONLY place raw evidence is interpreted, and it is a
 * pure function: no database, no network, no clock.
 *
 * It never invents provenance. A row whose signer is unrecognised maps to
 * source 'unknown' (first-party, and therefore unable to verify anything)
 * rather than being guessed into a trusted source. A row with no hash or no
 * parseable timestamp keeps that absence, so the evaluator can fail it with
 * MISSING_PROVENANCE instead of silently passing.
 */

/** Shape of the persisted evidence rows, as returned by GET /user/passports. */
export interface EvidenceRow {
  id: string;
  name?: string | null;
  type?: string | null;
  status?: string | null;
  signer?: string | null;
  timestamp?: string | null;
  hash?: string | null;
  engineId?: string | null;
}

const PINNED_COMMIT = /^[a-f0-9]{40}$/i;

/**
 * Source identity is derived from the recorded signer, which is the actual
 * origin the worker attributed the observation to. Syft is treated as
 * first-party because SPR runs it; GitHub and OSV are genuinely external.
 */
export function sourceFromSigner(signer: string | null | undefined): SourceIdentity {
  const value = String(signer ?? '').trim().toLowerCase();
  if (!value) return 'unknown';
  if (value.includes('github.com')) return 'github.com';
  if (value.includes('osv.dev')) return 'api.osv.dev';
  if (value.startsWith('syft')) return 'syft';
  if (value.includes('slsa') || value.includes('attestation') || value.includes('publisher')) return 'publisher-attestation';
  if (value.includes('spr') || value.includes('repository-worker')) return 'spr-scanner';
  return 'unknown';
}

/**
 * Claim mapping, derived from the evidence names the workers actually write
 * (see osv-worker.ts and security-scanner-worker.ts). An unrecognised record
 * maps to no claim and is excluded rather than being attached to a claim it
 * does not support.
 */
export function claimFromEvidence(row: EvidenceRow): ClaimId | null {
  const name = String(row.name ?? '').toLowerCase();
  const source = sourceFromSigner(row.signer);

  if (name.includes('repository source descriptor')) return 'REPOSITORY_IDENTITY';
  if (name.includes('sbom') || name.includes('manifest inventory')) return 'DEPENDENCY_INVENTORY';
  if (name.includes('osv response') || source === 'api.osv.dev') return 'DEPENDENCY_VULNERABILITY_STATE';
  if (name.includes('slsa') || name.includes('provenance')) return 'BUILD_PROVENANCE';
  if (name.includes('security scan')) return 'SECRET_EXPOSURE_STATE';
  return null;
}

function parseObservedAt(timestamp: string | null | undefined): number | null {
  if (!timestamp) return null;
  const parsed = Date.parse(String(timestamp));
  return Number.isFinite(parsed) ? parsed : null;
}

export interface AdapterInput {
  evidence: EvidenceRow[];
  /**
   * The passport's pinned target identity. For repository scans the worker
   * stores the resolved commit SHA in passports.version. A non-SHA value is
   * treated as unpinned rather than coerced.
   */
  passportVersion?: string | null;
  /** Ids of findings currently open, so adverse observations are flagged. */
  openFindingEvidenceIds?: string[];
}

export interface AdapterResult {
  evidence: NormalizedEvidence[];
  targetIdentity: string | null;
  /** Records excluded because they map to no claim - reported, never hidden. */
  unmappedCount: number;
  /** Records excluded because their timestamp could not be parsed. */
  undatedCount: number;
}

export function adaptEvidenceForEvaluation(input: AdapterInput): AdapterResult {
  const version = String(input.passportVersion ?? '').trim();
  const targetIdentity = PINNED_COMMIT.test(version) ? version : null;
  const adverseIds = new Set(input.openFindingEvidenceIds ?? []);

  const normalized: NormalizedEvidence[] = [];
  let unmappedCount = 0;
  let undatedCount = 0;

  for (const row of input.evidence) {
    const claimId = claimFromEvidence(row);
    if (!claimId) { unmappedCount += 1; continue; }
    const observedAt = parseObservedAt(row.timestamp);
    if (observedAt === null) { undatedCount += 1; continue; }

    normalized.push({
      evidenceId: row.id,
      claimId,
      source: sourceFromSigner(row.signer),
      observedAt,
      // Absent hash is preserved as absent so the evaluator can reject it.
      ...(row.hash ? { contentHash: row.hash } : {}),
      // Every observation from a repository scan describes the pinned commit
      // the passport represents; a passport with no pinned version yields no
      // target identity and cannot satisfy pinned-target claims.
      ...(targetIdentity ? { targetIdentity } : {}),
      ...(adverseIds.has(row.id) ? { adverse: true } : {}),
    });
  }

  return { evidence: normalized, targetIdentity, unmappedCount, undatedCount };
}
