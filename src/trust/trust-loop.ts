import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.ts';

export type ControlStatus = 'PASS' | 'FAIL' | 'UNKNOWN';
export type Severity = 'informational' | 'low' | 'medium' | 'high' | 'critical';

export type ControlObservation = {
  provider: string;
  controlId: string;
  title: string;
  status: ControlStatus;
  severity: Severity;
  subject: string;
  observedAt: string;
  sourceUrl: string;
  verificationMethod: string;
  value: unknown;
  limitation?: string;
  evidenceId?: string;
  hash?: string;
};

export type FindingStatus = 'OPEN' | 'UNKNOWN' | 'RESOLVED';
export type Finding = {
  id: string;
  tenantId: string;
  passportId: string;
  clientId: string;
  assetId: string;
  controlId: string;
  title: string;
  severity: Severity;
  status: FindingStatus;
  description: string;
  remediation: string;
  evidenceIds: string[];
  fingerprint: string;
  policyVersion: string;
};

const POLICY_VERSION = 'spr.findings.v2';
const SCORE_VERSION = 'spr.score.v2';
const CONFIDENCE_VERSION = 'spr.confidence.v2';
const MAX_VALUE_BYTES = 1_500_000;

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

function sha256(value: unknown): string {
  return crypto.createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

function findingId(fingerprint: string): string {
  return `finding_${fingerprint.slice(0, 40)}`;
}

function evidenceId(observation: ControlObservation, tenantId: string, passportId: string): string {
  const hash = sha256({
    tenantId,
    passportId,
    provider: observation.provider,
    controlId: observation.controlId,
    subject: observation.subject,
    sourceUrl: observation.sourceUrl,
    observedAt: observation.observedAt,
    verificationMethod: observation.verificationMethod,
    value: observation.value,
    status: observation.status,
    limitation: observation.limitation ?? null,
  });
  return `evidence_${hash.slice(0, 40)}`;
}

function severityWeight(severity: Severity): number {
  return { informational: 0, low: 5, medium: 10, high: 20, critical: 35 }[severity];
}

function freshnessMultiplier(observedAt: string, now = Date.now()): number {
  const ageHours = Math.max(0, (now - new Date(observedAt).getTime()) / 3_600_000);
  if (!Number.isFinite(ageHours)) return 0;
  if (ageHours <= 24) return 1;
  if (ageHours <= 72) return 0.95;
  if (ageHours <= 168) return 0.85;
  if (ageHours <= 720) return 0.7;
  return 0.5;
}

function semanticSignals(finding: Finding): Set<string> {
  const text = `${finding.controlId} ${finding.title} ${finding.description}`.toLowerCase();
  const signals = new Set<string>();
  if (/mfa|multi.?factor|authentication/.test(text)) signals.add('mfa');
  if (/internet|external|public|exposed|exposure|publicly.?accessible/.test(text)) signals.add('exposure');
  if (/privileged|admin|administrator|owner|root/.test(text)) signals.add('privilege');
  if (/vulnerab|cve|security.?alert|critical.?alert/.test(text)) signals.add('vulnerability');
  if (/encryption|encrypt|kms|key.?management/.test(text)) signals.add('encryption');
  if (/logging|audit.?log|activity.?log|cloudtrail|monitoring/.test(text)) signals.add('logging');
  return signals;
}

export function observationsToFindings(input: {
  tenantId: string;
  passportId: string;
  clientId: string;
  assetId: string;
  observations: ControlObservation[];
}): Finding[] {
  return input.observations.map((observation) => {
    const fingerprint = sha256({
      tenantId: input.tenantId,
      passportId: input.passportId,
      provider: observation.provider,
      controlId: observation.controlId,
      subject: observation.subject,
    });
    const status: FindingStatus = observation.status === 'FAIL' ? 'OPEN' : observation.status === 'UNKNOWN' ? 'UNKNOWN' : 'RESOLVED';
    return {
      id: findingId(fingerprint),
      tenantId: input.tenantId,
      passportId: input.passportId,
      clientId: input.clientId,
      assetId: input.assetId,
      controlId: observation.controlId,
      title: observation.title,
      severity: observation.status === 'PASS' ? 'informational' : observation.severity,
      status,
      description: observation.status === 'FAIL'
        ? `${observation.title} failed based on authoritative provider evidence.`
        : observation.status === 'UNKNOWN'
          ? `${observation.title} is UNKNOWN because authoritative evidence was unavailable or insufficient; SPR does not infer a pass.`
          : `${observation.title} passed based on authoritative provider evidence.`,
      remediation: observation.status === 'FAIL'
        ? `Remediate ${observation.controlId}, recollect the underlying source, and independently verify the new observation before closure.`
        : '',
      evidenceIds: observation.evidenceId ? [observation.evidenceId] : [],
      fingerprint,
      policyVersion: POLICY_VERSION,
    };
  });
}

export function correlateFindings(findings: Finding[]): Finding[] {
  const open = findings.filter((finding) => finding.status === 'OPEN');
  const bySignal = new Map<string, Finding[]>();
  for (const finding of open) {
    for (const signal of semanticSignals(finding)) {
      const list = bySignal.get(signal) ?? [];
      list.push(finding);
      bySignal.set(signal, list);
    }
  }

  const mfa = bySignal.get('mfa') ?? [];
  const exposure = bySignal.get('exposure') ?? [];
  const privilege = bySignal.get('privilege') ?? [];
  const vulnerability = bySignal.get('vulnerability') ?? [];

  if (mfa.length && exposure.length && (privilege.length || vulnerability.length)) {
    const contributors = [...mfa, ...exposure, ...privilege, ...vulnerability];
    const first = contributors[0];
    const evidenceIds = [...new Set(contributors.flatMap((finding) => finding.evidenceIds))];
    const fingerprint = sha256({
      tenantId: first.tenantId,
      passportId: first.passportId,
      controlId: 'cross-source-privileged-exposure',
      contributors: contributors.map((finding) => finding.fingerprint).sort(),
    });
    findings.push({
      ...first,
      id: findingId(fingerprint),
      controlId: 'cross-source-privileged-exposure',
      title: 'Correlated privileged internet exposure without MFA',
      severity: 'critical',
      status: 'OPEN',
      description: 'Independent evidence correlates external exposure, privileged access and missing MFA. The combined condition materially increases compromise impact and likelihood.',
      remediation: 'Remove unnecessary external exposure or privileged access, enforce phishing-resistant MFA, then recollect every contributing source and independently verify resolution.',
      evidenceIds,
      fingerprint,
      policyVersion: POLICY_VERSION,
    });
  }

  return [...new Map(findings.map((finding) => [finding.id, finding])).values()];
}

async function persistEvidence(input: {
  tenantId: string;
  passportId: string;
  clientId: string;
  assetId: string;
  observations: ControlObservation[];
  createdAt: string;
}): Promise<string[]> {
  const evidenceIds: string[] = [];
  for (const observation of input.observations) {
    const serialized = JSON.stringify(observation.value);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_VALUE_BYTES) throw new Error('EVIDENCE_VALUE_TOO_LARGE');
    const id = observation.evidenceId ?? evidenceId(observation, input.tenantId, input.passportId);
    const hash = observation.hash ?? sha256({
      tenantId: input.tenantId,
      passportId: input.passportId,
      provider: observation.provider,
      controlId: observation.controlId,
      subject: observation.subject,
      sourceUrl: observation.sourceUrl,
      observedAt: observation.observedAt,
      verificationMethod: observation.verificationMethod,
      status: observation.status,
      severity: observation.severity,
      value: observation.value,
      limitation: observation.limitation ?? null,
    });
    observation.evidenceId = id;
    observation.hash = hash;
    evidenceIds.push(id);
    await db.execute(sql`
      INSERT INTO evidence_ledger
        (id,tenant_id,passport_id,client_id,asset_id,provider,control_id,subject,source_url,observed_at,verification_method,status,severity,value,evidence_hash,limitation,created_at)
      VALUES
        (${id},${input.tenantId},${input.passportId},${input.clientId},${input.assetId},${observation.provider},${observation.controlId},${observation.subject},${observation.sourceUrl},${observation.observedAt},${observation.verificationMethod},${observation.status},${observation.severity},${serialized},${hash},${observation.limitation ?? null},${input.createdAt})
      ON CONFLICT (id) DO NOTHING
    `);
  }
  return evidenceIds;
}

async function persistFindings(findings: Finding[], now: string): Promise<void> {
  for (const finding of findings) {
    await db.execute(sql`
      INSERT INTO trust_findings
        (id,tenant_id,passport_id,client_id,asset_id,control_id,title,severity,status,description,remediation,evidence_ids,fingerprint,policy_version,created_at,updated_at)
      VALUES
        (${finding.id},${finding.tenantId},${finding.passportId},${finding.clientId},${finding.assetId},${finding.controlId},${finding.title},${finding.severity},${finding.status},${finding.description},${finding.remediation},${JSON.stringify(finding.evidenceIds)},${finding.fingerprint},${finding.policyVersion},${now},${now})
      ON CONFLICT (tenant_id,fingerprint) DO UPDATE SET
        status=EXCLUDED.status,
        severity=EXCLUDED.severity,
        description=EXCLUDED.description,
        remediation=EXCLUDED.remediation,
        evidence_ids=EXCLUDED.evidence_ids,
        policy_version=EXCLUDED.policy_version,
        updated_at=EXCLUDED.updated_at,
        resolved_at=CASE WHEN EXCLUDED.status='RESOLVED' THEN CURRENT_TIMESTAMP ELSE NULL END
    `);
  }
}

export async function persistTrustLoop(input: {
  tenantId: string;
  passportId: string;
  clientId: string;
  assetId: string;
  observations: ControlObservation[];
  generationReason?: string;
  actorType?: string;
  collectorVersionMap?: Record<string, string>;
}) {
  if (!input.tenantId || !input.passportId || !input.clientId || !input.assetId) throw new Error('TRUST_LOOP_SCOPE_REQUIRED');
  if (!input.observations.length) throw new Error('TRUST_LOOP_REQUIRES_OBSERVATIONS');

  const now = new Date().toISOString();
  const evidenceIds = await persistEvidence({ ...input, createdAt: now });
  const findings = correlateFindings(observationsToFindings(input));
  await persistFindings(findings, now);

  const known = input.observations.filter((observation) => observation.status !== 'UNKNOWN').length;
  const unknown = input.observations.filter((observation) => observation.status === 'UNKNOWN').length;
  const completeness = Math.round((known / input.observations.length) * 10000);
  const freshEvidence = input.observations.reduce((sum, observation) => sum + freshnessMultiplier(observation.observedAt), 0) / input.observations.length;
  const open = findings.filter((finding) => finding.status === 'OPEN');
  const riskPenalty = open.reduce((sum, finding) => sum + severityWeight(finding.severity), 0);
  const score = Math.max(0, Math.min(100, 100 - riskPenalty));
  const confidence = Math.round(Math.max(0, Math.min(10000, (completeness / 100) * 100 * freshEvidence * 100)));

  const previous = await db.execute(sql`
    SELECT id, observation_version, canonical_payload_hash
    FROM trust_observations
    WHERE tenant_id=${input.tenantId} AND passport_id=${input.passportId}
    ORDER BY observation_version DESC
    LIMIT 1
  `);
  const previousRow = (previous as any).rows?.[0];
  const version = Number(previousRow?.observation_version ?? 0) + 1;
  const payload = {
    schemaVersion: 'spr.passport.v2',
    scoreVersion: SCORE_VERSION,
    confidenceVersion: CONFIDENCE_VERSION,
    generatedAt: now,
    evidenceIds,
    findingIds: findings.map((finding) => finding.id).sort(),
    completenessBasisPoints: completeness,
    confidenceBasisPoints: confidence,
    score,
    open: open.length,
    unknown,
    limitations: input.observations.filter((observation) => observation.limitation).map((observation) => ({ controlId: observation.controlId, limitation: observation.limitation })),
  };
  const canonicalPayloadHash = sha256({ previousHash: previousRow?.canonical_payload_hash ?? null, payload });
  const observationId = newId('trustobs');

  await db.execute(sql`
    INSERT INTO trust_observations
      (id,tenant_id,passport_id,client_id,asset_id,schema_version,observation_version,generated_at,previous_observation_id,evidence_ids,finding_ids,scoring_policy_version,confidence_policy_version,completeness_basis_points,known_dimension_count,unknown_dimension_count,stale_dimension_count,expired_dimension_count,canonical_payload_hash,immutable_payload,generation_reason,generated_by_actor_type,collector_version_map,partially_known_dimension_count,unavailable_dimension_count,open_finding_count,persisted_finding_count,idempotency_key,created_at)
    VALUES
      (${observationId},${input.tenantId},${input.passportId},${input.clientId},${input.assetId},'spr.passport.v2',${version},${now},${previousRow?.id ?? null},${JSON.stringify(evidenceIds)},${JSON.stringify(findings.map((finding) => finding.id))},${SCORE_VERSION},${CONFIDENCE_VERSION},${completeness},${known},${unknown},0,0,${canonicalPayloadHash},${JSON.stringify(payload)},${input.generationReason ?? 'evidence_change'},${input.actorType ?? 'worker'},${JSON.stringify(input.collectorVersionMap ?? {})},0,${unknown},${open.length},${findings.length},${`${input.tenantId}:${input.passportId}:${canonicalPayloadHash}`},${now})
    ON CONFLICT (tenant_id,idempotency_key) DO NOTHING
  `);

  const passportRows = await db.execute(sql`SELECT timeline FROM passports WHERE id=${input.passportId} AND tenant_id=${input.tenantId} LIMIT 1`);
  const passport = (passportRows as any).rows?.[0];
  let timeline: unknown[] = [];
  try { timeline = Array.isArray(passport?.timeline) ? passport.timeline : JSON.parse(passport?.timeline ?? '[]'); } catch { timeline = []; }
  timeline.push({ at: now, type: 'trust_snapshot', observationId, version, score, confidence, completeness });
  timeline = timeline.slice(-500);

  await db.execute(sql`
    UPDATE passports SET
      overall_score=${score},
      security_score=${score},
      compliance_score=${score},
      evidence=${JSON.stringify(evidenceIds)},
      vulnerabilities=${JSON.stringify(findings.filter((finding) => finding.status === 'OPEN'))},
      timeline=${JSON.stringify(timeline)}
    WHERE id=${input.passportId} AND tenant_id=${input.tenantId}
  `);

  return { observationId, version, score, confidence, completeness, findings, evidenceIds, payloadHash: canonicalPayloadHash };
}

export async function verifyRemediation(input: {
  tenantId: string;
  findingId: string;
  observationIds: string[];
  evidenceIds: string[];
  actorId?: string;
}) {
  const findingRows = await db.execute(sql`
    SELECT id,status,evidence_ids,passport_id,updated_at
    FROM trust_findings
    WHERE id=${input.findingId} AND tenant_id=${input.tenantId}
    LIMIT 1
  `);
  const finding = (findingRows as any).rows?.[0];
  if (!finding) throw new Error('FINDING_NOT_FOUND');
  const evidenceIds = [...new Set(input.evidenceIds)];
  const observationIds = [...new Set(input.observationIds)];
  if (!evidenceIds.length || !observationIds.length) throw new Error('VERIFICATION_REQUIRES_NEW_EVIDENCE');

  const evidenceRows = await db.execute(sql`
    SELECT id,observed_at,status,evidence_hash,control_id
    FROM evidence_ledger
    WHERE tenant_id=${input.tenantId} AND passport_id=${finding.passport_id} AND id = ANY(${evidenceIds})
  `);
  const observationRows = await db.execute(sql`
    SELECT id,generated_at,evidence_ids
    FROM trust_observations
    WHERE tenant_id=${input.tenantId} AND passport_id=${finding.passport_id} AND id = ANY(${observationIds})
  `);
  const evidence = (evidenceRows as any).rows ?? [];
  const observations = (observationRows as any).rows ?? [];
  if (evidence.length !== evidenceIds.length || observations.length !== observationIds.length) throw new Error('VERIFICATION_EVIDENCE_NOT_OWNED');
  if (evidence.some((row: any) => row.status !== 'PASS')) throw new Error('VERIFICATION_REQUIRES_PASS_EVIDENCE');

  const priorEvidenceIds: string[] = (() => { try { return JSON.parse(finding.evidence_ids ?? '[]'); } catch { return []; } })();
  const priorRows = priorEvidenceIds.length ? await db.execute(sql`
    SELECT MAX(observed_at) AS latest_prior
    FROM evidence_ledger
    WHERE tenant_id=${input.tenantId} AND passport_id=${finding.passport_id} AND id = ANY(${priorEvidenceIds})
  `) : null;
  const latestPrior = (priorRows as any)?.rows?.[0]?.latest_prior;
  if (latestPrior && evidence.some((row: any) => new Date(row.observed_at).getTime() <= new Date(latestPrior).getTime())) throw new Error('VERIFICATION_REQUIRES_NEWER_EVIDENCE');

  const observationEvidence = new Set(observations.flatMap((row: any) => {
    try { return JSON.parse(row.evidence_ids ?? '[]'); } catch { return []; }
  }));
  if (evidenceIds.some((id) => !observationEvidence.has(id))) throw new Error('VERIFICATION_EVIDENCE_NOT_LINKED_TO_OBSERVATION');

  const verificationId = newId('verify');
  await db.execute(sql`
    INSERT INTO remediation_verification_ledger
      (id,tenant_id,finding_id,status,prior_evidence_ids,verification_evidence_ids,observation_ids,actor_id,created_at)
    VALUES
      (${verificationId},${input.tenantId},${input.findingId},'VERIFIED',${JSON.stringify(priorEvidenceIds)},${JSON.stringify(evidenceIds)},${JSON.stringify(observationIds)},${input.actorId ?? null},${new Date().toISOString()})
  `);
  await db.execute(sql`
    UPDATE trust_findings
    SET status='RESOLVED', resolved_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
    WHERE id=${input.findingId} AND tenant_id=${input.tenantId}
  `);
  return { verificationId, findingId: input.findingId, status: 'VERIFIED', evidenceIds, observationIds };
}
