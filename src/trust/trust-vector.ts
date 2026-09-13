/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The 12-dimension Trust Vector.
 *
 * One passport, twelve independent readings, each computed from a specific
 * set of observed records and each carrying the ids of the records it was
 * computed from. A dimension whose inputs were never observed is UNKNOWN
 * (value null) with the reason stated -- it is never defaulted to a number.
 *
 * The vector is a companion to, not a replacement for, the canonical
 * passport score in scoring-engine.ts: it does not write overall_score and
 * the engine does not read it. There is deliberately no "overall" here; a
 * single blended number is exactly what a twelve-axis view exists to avoid.
 *
 * Pure: takes a snapshot, returns the vector. The route loads the snapshot.
 */

export const TRUST_VECTOR_VERSION = 'spr-trust-vector-v1';

export const TRUST_DIMENSIONS = [
  { id: 'vulnerability_exposure', label: 'Vulnerability exposure', basis: 'Open OSV vulnerability findings by severity, from the last completed dependency scan.' },
  { id: 'dependency_hygiene', label: 'Dependency hygiene', basis: 'Share of SBOM components with an open vulnerability, and whether fixes exist for them.' },
  { id: 'secrets_and_configuration', label: 'Secrets & configuration', basis: 'Open secret and infrastructure-as-code findings from the last completed security scan.' },
  { id: 'licence_compliance', label: 'Licence compliance', basis: 'Open licence findings (undeclared or unobservable licences) from the last completed security scan.' },
  { id: 'provenance_and_integrity', label: 'Provenance & integrity', basis: 'Signature and attestation evidence, and signature-failure findings.' },
  { id: 'evidence_verification', label: 'Evidence verification', basis: 'Share of evidence items that were independently verified rather than self-reported.' },
  { id: 'evidence_freshness', label: 'Evidence freshness', basis: 'Age of the most recent completed scan or observation.' },
  { id: 'evidence_completeness', label: 'Evidence completeness', basis: 'The canonical evidence-completeness measure from the scoring engine.' },
  { id: 'vendor_due_diligence', label: 'Vendor due diligence', basis: 'Vendor record and recorded vendor audits for the publisher.' },
  { id: 'remediation_responsiveness', label: 'Remediation responsiveness', basis: 'Resolved versus open findings, and the age of the oldest open critical/high finding.' },
  { id: 'maintenance_activity', label: 'Maintenance activity', basis: 'Recency of the repository state SPR last acquired (commit acquisition time).' },
  { id: 'monitoring_coverage', label: 'Monitoring coverage', basis: 'Enabled monitoring configurations for this passport and whether their last run succeeded.' },
] as const;
export type TrustDimensionId = typeof TRUST_DIMENSIONS[number]['id'];

export interface DimensionReading {
  id: TrustDimensionId;
  label: string;
  /** 0..100, or null when the inputs were not observed. */
  value: number | null;
  status: 'observed' | 'unknown';
  /** Plain statement of what was counted, or why it is unknown. */
  detail: string;
  /** Ids of the records this reading was computed from. */
  basisIds: string[];
  observedAt: string | null;
}

export interface TrustVector {
  version: typeof TRUST_VECTOR_VERSION;
  passportId: string;
  computedAt: string;
  dimensions: DimensionReading[];
  observedCount: number;
  unknownCount: number;
  policy: string;
}

export interface TrustVectorFinding { id: string; severity: string; category: string; status: string; detectedAt: string | null; fixedVersion: string | null; component: string | null; updatedAt: string | null }
export interface TrustVectorEvidence { id: string; type: string; verified: boolean; status: string; timestamp: string | null }
export interface TrustVectorInput {
  passportId: string;
  now: number;
  evidenceCompleteness: number | null;
  sbomComponentCount: number | null;
  lastDependencyScanCompletedAt: string | null;
  lastSecurityScanCompletedAt: string | null;
  lastRepositoryAcquiredAt: string | null;
  lastObservationAt: string | null;
  findings: TrustVectorFinding[];
  evidence: TrustVectorEvidence[];
  vendor: { id: string; auditCount: number; lastAuditAt: string | null } | null;
  monitoring: Array<{ id: string; enabled: boolean; lastStatus: string; lastSuccessfulAt: string | null }>;
  remediationTasks: Array<{ id: string; status: string }>;
}

export const TRUST_VECTOR_POLICY = 'Each dimension is computed only from the records listed in basisIds. A dimension whose inputs were never observed is UNKNOWN, not a low score. The vector does not feed the canonical passport score.';

const OPEN = (status: string) => !['resolved', 'closed', 'verified', 'mitigated', 'fixed'].includes(status.toLowerCase());
const SEV_WEIGHT: Record<string, number> = { critical: 35, high: 20, medium: 8, low: 3, informational: 0 };
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const daysBetween = (iso: string | null, now: number) => { if (!iso) return null; const t = Date.parse(iso); return Number.isFinite(t) ? (now - t) / 86_400_000 : null; };
const sev = (f: TrustVectorFinding) => String(f.severity).toLowerCase();

function reading(id: TrustDimensionId, value: number | null, detail: string, basisIds: string[], observedAt: string | null): DimensionReading {
  const label = TRUST_DIMENSIONS.find((d) => d.id === id)!.label;
  return { id, label, value: value === null ? null : clamp(value), status: value === null ? 'unknown' : 'observed', detail, basisIds, observedAt };
}

export function computeTrustVector(input: TrustVectorInput): TrustVector {
  const open = input.findings.filter((f) => OPEN(f.status));
  const byCategory = (category: string) => open.filter((f) => f.category.toLowerCase() === category.toLowerCase());
  const dims: DimensionReading[] = [];

  // 1. Vulnerability exposure
  {
    const vulns = byCategory('Vulnerability');
    if (!input.lastDependencyScanCompletedAt) dims.push(reading('vulnerability_exposure', null, 'No completed dependency vulnerability scan for this passport.', [], null));
    else {
      const penalty = vulns.reduce((sum, f) => sum + (SEV_WEIGHT[sev(f)] ?? 5), 0);
      const counts = ['critical', 'high', 'medium', 'low'].map((s) => `${vulns.filter((f) => sev(f) === s).length} ${s}`).join(', ');
      dims.push(reading('vulnerability_exposure', 100 - penalty, `${vulns.length} open vulnerability finding(s): ${counts}.`, vulns.map((f) => f.id), input.lastDependencyScanCompletedAt));
    }
  }
  // 2. Dependency hygiene
  {
    const vulns = byCategory('Vulnerability');
    if (input.sbomComponentCount === null || !input.lastDependencyScanCompletedAt) dims.push(reading('dependency_hygiene', null, 'No SBOM has been generated for this passport.', [], null));
    else if (input.sbomComponentCount === 0) dims.push(reading('dependency_hygiene', null, 'The generated SBOM contains no components, so there is nothing to assess.', [], input.lastDependencyScanCompletedAt));
    else {
      const affected = new Set(vulns.map((f) => f.component).filter(Boolean)).size;
      const withFix = vulns.filter((f) => f.fixedVersion).length;
      const affectedShare = affected / input.sbomComponentCount;
      const fixShare = vulns.length ? withFix / vulns.length : 1;
      dims.push(reading('dependency_hygiene', 100 - affectedShare * 100 * 3 - (1 - fixShare) * 20, `${affected} of ${input.sbomComponentCount} SBOM component(s) carry an open vulnerability; ${withFix} of ${vulns.length} finding(s) have a fixed version available.`, vulns.map((f) => f.id), input.lastDependencyScanCompletedAt));
    }
  }
  // 3. Secrets & configuration
  {
    const items = [...byCategory('Secret'), ...byCategory('Configuration')];
    if (!input.lastSecurityScanCompletedAt) dims.push(reading('secrets_and_configuration', null, 'No completed security (secret/IaC) scan for this passport.', [], null));
    else dims.push(reading('secrets_and_configuration', 100 - items.reduce((sum, f) => sum + (SEV_WEIGHT[sev(f)] ?? 5), 0), `${byCategory('Secret').length} open secret finding(s) and ${byCategory('Configuration').length} open configuration finding(s).`, items.map((f) => f.id), input.lastSecurityScanCompletedAt));
  }
  // 4. Licence compliance
  {
    const items = byCategory('License');
    if (!input.lastSecurityScanCompletedAt) dims.push(reading('licence_compliance', null, 'No completed licence scan for this passport.', [], null));
    else if (input.sbomComponentCount === null || input.sbomComponentCount === 0) dims.push(reading('licence_compliance', null, 'No SBOM components to assess licences for.', [], input.lastSecurityScanCompletedAt));
    else dims.push(reading('licence_compliance', 100 - (items.length / input.sbomComponentCount) * 100, `${items.length} of ${input.sbomComponentCount} component(s) have an open licence finding.`, items.map((f) => f.id), input.lastSecurityScanCompletedAt));
  }
  // 5. Provenance & integrity
  {
    const sig = input.evidence.filter((e) => ['signature', 'attestation'].includes(e.type.toLowerCase()));
    const failures = byCategory('Signature Failure');
    if (!input.lastDependencyScanCompletedAt && sig.length === 0) dims.push(reading('provenance_and_integrity', null, 'No scan has run and no signature or attestation evidence has been supplied.', [], null));
    else {
      const verified = sig.filter((e) => e.verified);
      const value = verified.length ? 90 : sig.length ? 45 : 20;
      dims.push(reading('provenance_and_integrity', value - failures.length * 25, `${verified.length} verified and ${sig.length - verified.length} unverified signature/attestation item(s); ${failures.length} signature-failure finding(s).`, [...sig.map((e) => e.id), ...failures.map((f) => f.id)], sig[0]?.timestamp ?? input.lastDependencyScanCompletedAt));
    }
  }
  // 6. Evidence verification
  {
    if (input.evidence.length === 0) dims.push(reading('evidence_verification', null, 'No evidence items recorded for this passport.', [], null));
    else {
      const verified = input.evidence.filter((e) => e.verified).length;
      dims.push(reading('evidence_verification', (verified / input.evidence.length) * 100, `${verified} of ${input.evidence.length} evidence item(s) independently verified.`, input.evidence.map((e) => e.id), input.evidence[0]?.timestamp ?? null));
    }
  }
  // 7. Evidence freshness
  {
    const latest = [input.lastDependencyScanCompletedAt, input.lastSecurityScanCompletedAt, input.lastObservationAt].filter((x): x is string => Boolean(x)).sort().at(-1) ?? null;
    const age = daysBetween(latest, input.now);
    if (age === null) dims.push(reading('evidence_freshness', null, 'No completed scan or observation to date.', [], null));
    else dims.push(reading('evidence_freshness', 100 - Math.max(0, age - 7) * (100 / 83), `Most recent completed scan or observation is ${age.toFixed(1)} day(s) old.`, [], latest));
  }
  // 8. Evidence completeness
  {
    if (input.evidenceCompleteness === null) dims.push(reading('evidence_completeness', null, 'The scoring engine has not computed evidence completeness (no resolved evidence yet).', [], null));
    else dims.push(reading('evidence_completeness', input.evidenceCompleteness, `${input.evidenceCompleteness}% of expected evidence resolved to PASS/FAIL.`, [], input.lastObservationAt));
  }
  // 9. Vendor due diligence
  {
    if (!input.vendor) dims.push(reading('vendor_due_diligence', null, 'No vendor record is linked to this publisher.', [], null));
    else {
      const age = daysBetween(input.vendor.lastAuditAt, input.now);
      const value = input.vendor.auditCount === 0 ? 25 : age === null ? 60 : age <= 365 ? 90 : 60;
      dims.push(reading('vendor_due_diligence', value, `Vendor record present with ${input.vendor.auditCount} recorded audit(s)${input.vendor.lastAuditAt ? `, latest ${age!.toFixed(0)} day(s) ago` : ''}.`, [input.vendor.id], input.vendor.lastAuditAt));
    }
  }
  // 10. Remediation responsiveness
  {
    if (input.findings.length === 0) dims.push(reading('remediation_responsiveness', null, 'No findings have been recorded, so there is nothing to remediate yet.', [], null));
    else {
      const resolved = input.findings.length - open.length;
      const oldestHigh = open.filter((f) => ['critical', 'high'].includes(sev(f))).map((f) => daysBetween(f.detectedAt, input.now)).filter((d): d is number => d !== null).sort((a, b) => b - a)[0] ?? 0;
      const value = (resolved / input.findings.length) * 60 + Math.max(0, 40 - oldestHigh);
      dims.push(reading('remediation_responsiveness', value, `${resolved} of ${input.findings.length} finding(s) resolved; oldest open critical/high is ${oldestHigh.toFixed(0)} day(s) old; ${input.remediationTasks.filter((t) => t.status !== 'CANCELLED').length} remediation task(s).`, [...input.findings.map((f) => f.id), ...input.remediationTasks.map((t) => t.id)], null));
    }
  }
  // 11. Maintenance activity
  {
    const age = daysBetween(input.lastRepositoryAcquiredAt, input.now);
    if (age === null) dims.push(reading('maintenance_activity', null, 'SPR has not acquired a repository state for this passport, so upstream activity is unobserved.', [], null));
    else dims.push(reading('maintenance_activity', 100 - Math.max(0, age - 30) * (100 / 335), `Repository state was last acquired ${age.toFixed(1)} day(s) ago; commit recency is only observed as of that acquisition.`, [], input.lastRepositoryAcquiredAt));
  }
  // 12. Monitoring coverage
  {
    const enabled = input.monitoring.filter((m) => m.enabled);
    if (input.monitoring.length === 0) dims.push(reading('monitoring_coverage', null, 'No monitoring configuration exists for this passport.', [], null));
    else {
      const healthy = enabled.filter((m) => m.lastStatus.toLowerCase() === 'success' || m.lastStatus.toLowerCase() === 'ok').length;
      dims.push(reading('monitoring_coverage', enabled.length === 0 ? 0 : (healthy / enabled.length) * 100, `${enabled.length} enabled monitor(s), ${healthy} with a successful last run.`, input.monitoring.map((m) => m.id), enabled.map((m) => m.lastSuccessfulAt).filter(Boolean).sort().at(-1) ?? null));
    }
  }

  const observedCount = dims.filter((d) => d.status === 'observed').length;
  return { version: TRUST_VECTOR_VERSION, passportId: input.passportId, computedAt: new Date(input.now).toISOString(), dimensions: dims, observedCount, unknownCount: dims.length - observedCount, policy: TRUST_VECTOR_POLICY };
}
