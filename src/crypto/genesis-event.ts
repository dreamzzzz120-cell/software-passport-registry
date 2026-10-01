import { canonicalJson } from './evidence-package.ts';
import { digestUtf8, requireActiveCryptoAlgorithm } from './algorithm-registry.ts';

export type CreatorType = 'human' | 'ai-agent' | 'autonomous-agent' | 'service' | 'system';

export interface GenesisEventInput {
  genesisId: string;
  tenantId: string;
  creatorIdentity: string;
  creatorType: CreatorType;
  parentIdentity?: string | null;
  authorityChain: readonly string[];
  creationTimestamp: string;
  sourceDigest?: string | null;
  artifactDigest: string;
  buildDigest?: string | null;
  sbomDigest?: string | null;
  buildEnvironment: Readonly<Record<string, unknown>>;
  policyVersion: string;
  evidenceReferences: readonly string[];
  signingKeyId: string;
  signatureAlgorithm: string;
  parentGenesisId?: string | null;
  childIdentity: string;
  creationReason: string;
  authorizationReference?: string | null;
}

export interface GenesisEvent extends GenesisEventInput {
  schemaVersion: 'spr-genesis/v1';
  eventDigestAlgorithm: string;
  eventDigest: string;
}

/**
 * Creation records identity and provenance only. It never implies authorization.
 * Missing source/build/SBOM observations remain explicit nulls.
 */
export function createGenesisEvent(input: GenesisEventInput, digestAlgorithmId = 'sha2-256'): GenesisEvent {
  requireActiveCryptoAlgorithm(digestAlgorithmId, 'hash');
  requireActiveCryptoAlgorithm(input.signatureAlgorithm, 'signature');
  if (!input.genesisId || !input.tenantId || !input.creatorIdentity || !input.childIdentity || !input.artifactDigest) {
    throw new Error('GENESIS_REQUIRED_FIELD_MISSING');
  }
  const createdAt = Date.parse(input.creationTimestamp);
  if (!Number.isFinite(createdAt)) throw new Error('GENESIS_INVALID_TIMESTAMP');
  if (input.creatorIdentity === input.childIdentity) throw new Error('GENESIS_SELF_TRUST_FORBIDDEN');
  if (input.parentIdentity && input.parentIdentity === input.childIdentity) throw new Error('GENESIS_SELF_PARENT_FORBIDDEN');
  if (!input.authorityChain.length) throw new Error('GENESIS_AUTHORITY_CHAIN_REQUIRED');

  const eventWithoutDigest = {
    schemaVersion: 'spr-genesis/v1' as const,
    ...input,
  };
  return {
    ...eventWithoutDigest,
    eventDigestAlgorithm: digestAlgorithmId,
    eventDigest: digestUtf8(digestAlgorithmId, canonicalJson(eventWithoutDigest)),
  };
}

export function assertArtifactBinding(expectedArtifactDigest: string, observedArtifactDigest: string): void {
  if (!expectedArtifactDigest || !observedArtifactDigest) throw new Error('ARTIFACT_BINDING_UNKNOWN');
  if (expectedArtifactDigest !== observedArtifactDigest) throw new Error('ARTIFACT_BINDING_MISMATCH');
}
