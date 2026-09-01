export const TRUST_DIMENSIONS = [
  'security', 'identity', 'integrity', 'reliability', 'compliance', 'provenance',
  'transparency', 'privacy', 'supplyChain', 'aiGovernance', 'resilience', 'reputation'
] as const;

export type TrustDimension = typeof TRUST_DIMENSIONS[number];
export type TrustDimensionState = 'known' | 'partially_known' | 'unknown' | 'stale' | 'expired' | 'unavailable';
export type FreshnessStatus = 'fresh' | 'aging' | 'stale' | 'expired' | 'unknown';

export interface TrustEvidenceInput {
  id: string; name: string; type: string; status: string; source: string;
  timestamp: string; verificationMethod: string; failureReason?: string | null;
}

export interface TrustObservationInput {
  passport: {
    id: string; name: string; version: string; publisher: string;
    fileHash?: string | null; sbom: unknown[]; timeline: unknown[];
  };
  evidence: TrustEvidenceInput[];
  findings: Array<{ status: string; severity: string; detectedAt: string; engineId: string }>;
  observedAt?: Date;
}

const STATUS_CONFIDENCE: Record<string, number> = {
  VERIFIED: 1, PARTIALLY_VERIFIED: 0.75, OBSERVED: 0.6, CONFIGURED: 0.45,
  DECLARED: 0.3, STALE: 0.2, SOURCE_DISCONNECTED: 0.1, FAILED: 0
};

const REQUIRED_EVIDENCE: Record<TrustDimension, string[]> = {
  security: ['Current security scan from an identified scanner'],
  identity: ['Verified owner, publisher, or signing identity'],
  integrity: ['Verified artifact digest or digital signature'],
  reliability: ['Availability, incident, or reliability observations'],
  compliance: ['Current control assessment or audit evidence'],
  provenance: ['Build provenance or signed attestation'],
  transparency: ['Observed source, build, or component disclosure'],
  privacy: ['Privacy assessment or data-flow evidence'],
  supplyChain: ['Observed SBOM and dependency scan'],
  aiGovernance: ['Model inventory, dataset declaration, and approval evidence'],
  resilience: ['Recovery, failover, or resilience test evidence'],
  reputation: ['Longitudinal verified operational history']
};

const FRESH_SECONDS = 30 * 86_400;
const STALE_SECONDS = 90 * 86_400;
const EXPIRED_SECONDS = 180 * 86_400;

function ageAdjustedConfidence(status: string, timestamp: string, observedAt: Date): number {
  const recordedAt = Date.parse(timestamp);
  if (!Number.isFinite(recordedAt)) return 0;
  const ageDays = Math.max(0, (observedAt.getTime() - recordedAt) / 86_400_000);
  return Number(((STATUS_CONFIDENCE[status] ?? 0) * Math.pow(0.5, ageDays / 180)).toFixed(3));
}

function freshness(timestamp: string, observedAt: Date): { state: FreshnessStatus; nextRefreshAt: string | null } {
  const recordedAt = Date.parse(timestamp);
  if (!Number.isFinite(recordedAt)) return { state: 'unknown', nextRefreshAt: null };
  const age = Math.max(0, (observedAt.getTime() - recordedAt) / 1000);
  return {
    state: age < FRESH_SECONDS ? 'fresh' : age < STALE_SECONDS ? 'aging' : age < EXPIRED_SECONDS ? 'stale' : 'expired',
    nextRefreshAt: new Date(recordedAt + FRESH_SECONDS * 1000).toISOString()
  };
}

function dimensionsForEvidence(type: string): TrustDimension[] {
  switch (type.toLowerCase()) {
    case 'signature': return ['identity', 'integrity', 'provenance'];
    case 'security scan': return ['security', 'supplyChain'];
    case 'build log': return ['integrity', 'provenance', 'transparency'];
    case 'audit report': return ['compliance'];
    case 'attestation': return ['identity', 'provenance'];
    default: return [];
  }
}

export function buildTrustObservation(input: TrustObservationInput) {
  const observedAt = input.observedAt ?? new Date();
  const grouped = new Map<TrustDimension, any[]>(TRUST_DIMENSIONS.map(dimension => [dimension, []]));

  for (const item of input.evidence) {
    const observation = {
      evidenceId: item.id,
      statement: item.failureReason
        ? `${item.name}: verification failed (${item.failureReason})`
        : `${item.name}: ${item.status.toLowerCase().replaceAll('_', ' ')}`,
      source: item.source,
      timestamp: item.timestamp,
      evidenceType: item.type,
      verificationMethod: item.verificationMethod,
      status: item.status,
      confidence: ageAdjustedConfidence(item.status, item.timestamp, observedAt)
    };
    for (const dimension of dimensionsForEvidence(item.type)) grouped.get(dimension)!.push(observation);
  }

  if (input.passport.sbom.length > 0) {
    const observation = {
      evidenceId: `passport:${input.passport.id}:sbom`,
      statement: `${input.passport.sbom.length} SBOM component records are stored`,
      source: `passport:${input.passport.id}`,
      timestamp: observedAt.toISOString(),
      evidenceType: 'SBOM record',
      verificationMethod: 'Persisted document observation; component authenticity not independently verified',
      status: 'OBSERVED',
      confidence: 0.6
    };
    grouped.get('transparency')!.push(observation);
    grouped.get('supplyChain')!.push(observation);
  }

  const vector: Record<string, any> = {};
  for (const dimension of TRUST_DIMENSIONS) {
    const items = grouped.get(dimension)!;
    if (items.length === 0) {
      vector[dimension] = {
        dimension, state: 'unknown', score: null, confidence: null, completeness: 0,
        trend: 'unknown',
        explanation: 'Unknown — SPR currently has insufficient observable evidence to evaluate this dimension.',
        reasonCodes: ['INSUFFICIENT_OBSERVABLE_EVIDENCE'],
        evidenceCount: 0, findingCount: 0, openFindingCount: 0,
        lastObservedAt: null, oldestEvidenceAt: null, newestEvidenceAt: null,
        nextRefreshAt: null, freshnessStatus: 'unknown', collectorStatuses: [],
        verificationMethods: [], limitations: [`No qualifying ${dimension} evidence is currently available.`],
        observations: [], missingEvidence: REQUIRED_EVIDENCE[dimension]
      };
      continue;
    }

    const sorted = [...items].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const newest = sorted.at(-1)!;
    const currentFreshness = freshness(newest.timestamp, observedAt);
    const failedOnly = items.every(item => ['FAILED', 'SOURCE_DISCONNECTED'].includes(item.status));
    const relatedFindings = input.findings.filter(finding => items.some(item => item.source === finding.engineId));
    const state: TrustDimensionState = failedOnly ? 'unavailable'
      : currentFreshness.state === 'expired' ? 'expired'
      : currentFreshness.state === 'stale' ? 'stale'
      : 'partially_known';
    vector[dimension] = {
      dimension, state, score: null,
      confidence: failedOnly || state === 'expired' ? null
        : Number((items.reduce((sum, item) => sum + item.confidence, 0) / items.length).toFixed(3)),
      completeness: 1, trend: 'unknown',
      explanation: failedOnly
        ? 'This check failed before a reliable result was produced. SPR does not treat this as a pass or a fail.'
        : `SPR observed ${items.length} persisted evidence record${items.length === 1 ? '' : 's'}. A numeric score is not eligible because no versioned semantic scoring policy is configured for this evidence.`,
      reasonCodes: failedOnly ? ['COLLECTOR_RESULT_UNAVAILABLE'] : ['SCORING_POLICY_NOT_CONFIGURED'],
      evidenceCount: items.length,
      findingCount: relatedFindings.length,
      openFindingCount: relatedFindings.filter(finding => !['Resolved', 'Mitigated'].includes(finding.status)).length,
      lastObservedAt: newest.timestamp, oldestEvidenceAt: sorted[0].timestamp, newestEvidenceAt: newest.timestamp,
      nextRefreshAt: currentFreshness.nextRefreshAt, freshnessStatus: currentFreshness.state,
      collectorStatuses: [...new Map(items.map(item => [item.source, {
        collectorId: item.source,
        state: item.status === 'FAILED' ? 'failed' : 'succeeded',
        lastObservedAt: item.timestamp
      }])).values()],
      verificationMethods: [...new Set(items.map(item => item.verificationMethod))],
      limitations: [
        'Observed evidence may not cover every component, weakness, or operational condition.',
        'Payload integrity does not establish that an external source is correct or exhaustive.'
      ],
      observations: items, missingEvidence: []
    };
  }

  const unknownDimensions = TRUST_DIMENSIONS.filter(dimension => vector[dimension].state === 'unknown');
  const knownDimensions = TRUST_DIMENSIONS.filter(dimension => vector[dimension].state !== 'unknown');
  return {
    schemaVersion: 'spr.trust-observation.v1',
    passport: {
      id: input.passport.id, name: input.passport.name,
      version: input.passport.version, publisher: input.passport.publisher
    },
    observedAt: observedAt.toISOString(),
    rule: 'If SPR cannot observe it, SPR does not claim it.',
    scoringPolicy: {
      version: 'unconfigured', calculationVersion: 'spr.trust-observation.v1',
      minimumQualifyingEvidence: 1, minimumUsableConfidence: 0.5,
      scoreEligibility: 'Numeric scores require a configured, versioned semantic scoring policy and qualifying current evidence.'
    },
    vector,
    unknownLayer: {
      knownDimensions, unknownDimensions,
      eligibleEvidenceRequirements: TRUST_DIMENSIONS.length,
      satisfiedEvidenceRequirements: knownDimensions.length,
      completeness: Number((knownDimensions.length / TRUST_DIMENSIONS.length).toFixed(3)),
      explanation: 'Completeness measures how much of SPR’s defined observable evidence set is currently available. It does not measure whether the software is safe or compliant.'
    },
    history: input.passport.timeline,
    findingSummary: {
      observed: input.findings.length,
      open: input.findings.filter(finding => !['Resolved', 'Mitigated'].includes(finding.status)).length,
      note: input.findings.length === 0
        ? 'No findings were observed within the evidence and checks SPR completed. This does not establish that no vulnerabilities, weaknesses, or risks exist.'
        : 'SPR observed findings within the completed evidence scope. Findings may not represent every weakness or risk affecting the software.'
    }
  };
}
