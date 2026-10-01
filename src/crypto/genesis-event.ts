import { canonicalJson } from './evidence-package.ts';
import { digestUtf8, requireActiveCryptoAlgorithm } from './algorithm-registry.ts';
import type { SignatureSigner, SignatureVerifier } from './signature-provider.ts';

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
  signature: string;
  eventDigestAlgorithm: string;
  eventDigest: string;
}

function unsignedGenesis(input: GenesisEventInput) {
  return { schemaVersion: 'spr-genesis/v1' as const, ...input };
}

/**
 * Creation records identity and provenance only. It never implies authorization.
 * Missing source/build/SBOM observations remain explicit nulls.
 * The signature is produced here; callers may not inject an arbitrary signature.
 */
export function createGenesisEvent(
  input: GenesisEventInput,
  signer: SignatureSigner,
  digestAlgorithmId = 'sha2-256'
): GenesisEvent {
  requireActiveCryptoAlgorithm(digestAlgorithmId, 'hash');
  requireActiveCryptoAlgorithm(input.signatureAlgorithm, 'signature');
  if (signer.algorithmId !== input.signatureAlgorithm || signer.keyId !== input.signingKeyId) {
    throw new Error('GENESIS_SIGNING_KEY_MISMATCH');
  }
  if (!input.genesisId || !input.tenantId || !input.creatorIdentity || !input.childIdentity || !input.artifactDigest) {
    throw new Error('GENESIS_REQUIRED_FIELD_MISSING');
  }
  const createdAt = Date.parse(input.creationTimestamp);
  if (!Number.isFinite(createdAt)) throw new Error('GENESIS_INVALID_TIMESTAMP');
  if (input.creatorIdentity === input.childIdentity) throw new Error('GENESIS_SELF_TRUST_FORBIDDEN');
  if (input.parentIdentity && input.parentIdentity === input.childIdentity) throw new Error('GENESIS_SELF_PARENT_FORBIDDEN');
  if (!input.authorityChain.length) throw new Error('GENESIS_AUTHORITY_CHAIN_REQUIRED');

  const unsigned = unsignedGenesis(input);
  const canonical = canonicalJson(unsigned);
  const signature = signer.sign(Buffer.from(canonical, 'utf8'));
  const signed = { ...unsigned, signature };
  return {
    ...signed,
    eventDigestAlgorithm: digestAlgorithmId,
    eventDigest: digestUtf8(digestAlgorithmId, canonicalJson(signed)),
  };
}

export function verifyGenesisEvent(event: GenesisEvent, verifier: SignatureVerifier): boolean {
  try {
    requireActiveCryptoAlgorithm(event.eventDigestAlgorithm, 'hash');
    requireActiveCryptoAlgorithm(event.signatureAlgorithm, 'signature');
    if (verifier.algorithmId !== event.signatureAlgorithm || verifier.keyId !== event.signingKeyId) return false;
    const {
      schemaVersion,
      signature,
      eventDigestAlgorithm,
      eventDigest,
      ...input
    } = event;
    if (schemaVersion !== 'spr-genesis/v1') return false;
    const canonicalUnsigned = canonicalJson({ schemaVersion, ...input });
    const signatureValid = verifier.verify(Buffer.from(canonicalUnsigned, 'utf8'), signature);
    if (!signatureValid) return false;
    const canonicalSigned = canonicalJson({ schemaVersion, ...input, signature });
    return digestUtf8(eventDigestAlgorithm, canonicalSigned) === eventDigest;
  } catch {
    return false;
  }
}

export function assertArtifactBinding(expectedArtifactDigest: string, observedArtifactDigest: string): void {
  if (!expectedArtifactDigest || !observedArtifactDigest) throw new Error('ARTIFACT_BINDING_UNKNOWN');
  if (expectedArtifactDigest !== observedArtifactDigest) throw new Error('ARTIFACT_BINDING_MISMATCH');
}
