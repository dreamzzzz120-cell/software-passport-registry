import { createHash } from 'node:crypto';

export type TrustDecision = 'VERIFIED' | 'PARTIAL' | 'UNKNOWN' | 'DENIED' | 'REVOKED' | 'EXPIRED';

export interface MachineIdentityRef {
  machineId: string;
  organizationId: string;
  passportId?: string | null;
  keyId?: string | null;
}

export interface DelegationHop {
  delegatorId: string;
  delegateId: string;
  scope: string[];
  validUntil: string;
  evidenceDigest: string;
}

export interface AuthorityEnvelope {
  requestedAction: string;
  resource?: string | null;
  scope: string[];
  delegationChain: DelegationHop[];
  policyDigest?: string | null;
}

export interface TrustEnvelope {
  protocol: 'm2m-trust/1';
  envelopeId: string;
  issuer: MachineIdentityRef;
  subject: MachineIdentityRef;
  authority: AuthorityEnvelope;
  passportState: 'ACTIVE' | 'PARTIAL' | 'UNKNOWN' | 'REVOKED' | 'EXPIRED';
  evidenceDigest?: string | null;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
  signature?: {
    alg: 'Ed25519' | 'ES256' | 'RS256';
    keyId: string;
    value: string;
  } | null;
}

export interface TrustEvaluation {
  decision: TrustDecision;
  reasons: string[];
  evaluatedAt: string;
  envelopeDigest: string;
}

const hex64 = /^[a-f0-9]{64}$/;
const iso = (value: string) => Number.isFinite(Date.parse(value));

function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('NON_FINITE_VALUE');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return '{' + Object.keys(obj).sort().map(k => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
  }
  throw new Error('UNSUPPORTED_VALUE');
}

export function digestTrustEnvelope(envelope: TrustEnvelope): string {
  const unsigned = { ...envelope, signature: null };
  return createHash('sha256').update(canonical(unsigned)).digest('hex');
}

export function evaluateTrustEnvelope(
  envelope: TrustEnvelope,
  options: {
    now?: string;
    nonceSeen?: (nonce: string) => boolean;
    signatureVerified?: boolean | null;
    passportVerified?: boolean | null;
    authorityVerified?: boolean | null;
  } = {},
): TrustEvaluation {
  const now = options.now ?? new Date().toISOString();
  const reasons: string[] = [];
  const unknowns: string[] = [];

  if (envelope.protocol !== 'm2m-trust/1') reasons.push('UNSUPPORTED_PROTOCOL');
  if (!iso(envelope.issuedAt) || !iso(envelope.expiresAt) || !iso(now)) reasons.push('INVALID_TIME');
  else {
    const t = Date.parse(now), start = Date.parse(envelope.issuedAt), end = Date.parse(envelope.expiresAt);
    if (t < start) reasons.push('NOT_YET_VALID');
    if (t >= end) reasons.push('EXPIRED');
  }
  if (!envelope.nonce || envelope.nonce.length < 16) reasons.push('NONCE_INVALID');
  if (options.nonceSeen?.(envelope.nonce)) reasons.push('REPLAY_DETECTED');
  if (envelope.evidenceDigest && !hex64.test(envelope.evidenceDigest)) reasons.push('EVIDENCE_DIGEST_INVALID');
  for (const hop of envelope.authority.delegationChain) {
    if (!iso(hop.validUntil) || Date.parse(now) >= Date.parse(hop.validUntil)) reasons.push('DELEGATION_EXPIRED');
    if (!hex64.test(hop.evidenceDigest)) reasons.push('DELEGATION_EVIDENCE_INVALID');
  }

  if (envelope.passportState === 'REVOKED') return result('REVOKED', reasons.concat('PASSPORT_REVOKED'), now, envelope);
  if (envelope.passportState === 'EXPIRED') return result('EXPIRED', reasons.concat('PASSPORT_EXPIRED'), now, envelope);
  if (envelope.passportState === 'UNKNOWN') unknowns.push('PASSPORT_STATE_UNKNOWN');
  if (envelope.passportState === 'PARTIAL') unknowns.push('PASSPORT_STATE_PARTIAL');

  if (options.passportVerified === false) reasons.push('PASSPORT_VERIFICATION_FAILED');
  else if (options.passportVerified == null) unknowns.push('PASSPORT_VERIFICATION_NOT_ESTABLISHED');

  if (options.signatureVerified === false) reasons.push('SIGNATURE_VERIFICATION_FAILED');
  else if (options.signatureVerified == null) unknowns.push('SIGNATURE_VERIFICATION_NOT_ESTABLISHED');

  if (options.authorityVerified === false) reasons.push('AUTHORITY_VERIFICATION_FAILED');
  else if (options.authorityVerified == null) unknowns.push('AUTHORITY_VERIFICATION_NOT_ESTABLISHED');

  if (reasons.length) return result(reasons.includes('EXPIRED') ? 'EXPIRED' : 'DENIED', reasons.concat(unknowns), now, envelope);
  if (unknowns.length) {
    const decision: TrustDecision = envelope.passportState === 'PARTIAL' ? 'PARTIAL' : 'UNKNOWN';
    return result(decision, unknowns, now, envelope);
  }
  return result('VERIFIED', ['IDENTITY_AUTHORITY_AND_EVIDENCE_VERIFIED'], now, envelope);
}

function result(decision: TrustDecision, reasons: string[], evaluatedAt: string, envelope: TrustEnvelope): TrustEvaluation {
  return { decision, reasons, evaluatedAt, envelopeDigest: digestTrustEnvelope(envelope) };
}

export interface EvidenceReceipt {
  protocol: 'm2m-trust/1';
  envelopeDigest: string;
  actorMachineId: string;
  subjectMachineId: string;
  requestedAction: string;
  authorityDecision: 'AUTHORIZED' | 'NOT_AUTHORIZED' | 'UNKNOWN';
  executionOutcome: 'OBSERVED_SUCCEEDED' | 'OBSERVED_FAILED' | 'DENIED_NOT_EXECUTED' | 'UNKNOWN';
  evidenceDigest?: string | null;
  observedAt: string;
  receiptDigest: string;
}

export function sealEvidenceReceipt(input: Omit<EvidenceReceipt, 'receiptDigest'>): EvidenceReceipt {
  return { ...input, receiptDigest: createHash('sha256').update(canonical(input)).digest('hex') };
}
