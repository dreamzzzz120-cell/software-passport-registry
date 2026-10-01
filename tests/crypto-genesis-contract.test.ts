import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CRYPTO_ALGORITHMS, digestUtf8, getCryptoAlgorithm } from '../src/crypto/algorithm-registry.ts';
import { createEvidencePackage, verifyEvidencePackage } from '../src/crypto/evidence-package.ts';
import { assertArtifactBinding, createGenesisEvent } from '../src/crypto/genesis-event.ts';

describe('SPR cryptographic agility and genesis contract', () => {
  it('registers PQ and hybrid algorithms as planned, not falsely active', () => {
    expect(getCryptoAlgorithm('ml-kem-768').implementationState).toBe('planned');
    expect(getCryptoAlgorithm('ml-dsa-65').implementationState).toBe('planned');
    expect(getCryptoAlgorithm('slh-dsa-sha2-128s').implementationState).toBe('planned');
    expect(getCryptoAlgorithm('hybrid-ed25519-ml-dsa-65').implementationState).toBe('planned');
    expect(Object.values(CRYPTO_ALGORITHMS).filter(a => a.family !== 'classical').every(a => a.implementationState !== 'active')).toBe(true);
  });

  it('supports versioned classical digest algorithms without a global SHA-256 assumption', () => {
    expect(digestUtf8('sha2-256', 'x')).toHaveLength(64);
    expect(digestUtf8('sha2-512', 'x')).toHaveLength(128);
  });

  it('rejects portable trust conclusions in signed evidence packages', () => {
    const { privateKey } = crypto.generateKeyPairSync('ed25519');
    expect(() => createEvidencePackage({
      packageId: 'pkg-1',
      issuer: 'spr',
      tenantId: 'tenant-a',
      subject: 'artifact-a',
      createdAt: new Date().toISOString(),
      observations: [{ safe: true }],
      evidence: [],
    }, {
      algorithmId: 'ed25519',
      keyId: 'key-1',
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    })).toThrow(/PORTABLE_CONCLUSION_FORBIDDEN/);
  });

  it('signs and verifies an evidence package, then fails closed after payload tampering', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const pkg = createEvidencePackage({
      packageId: 'pkg-2',
      issuer: 'spr',
      tenantId: 'tenant-a',
      subject: 'artifact-a',
      createdAt: new Date().toISOString(),
      observations: [{ kind: 'artifact', digest: 'sha2-256:abc' }],
      evidence: [{ evidenceId: 'ev-1', state: 'UNVERIFIED', artifactDigest: 'sha2-256:abc' }],
    }, {
      algorithmId: 'ed25519',
      keyId: 'key-1',
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    });
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect(verifyEvidencePackage(pkg, publicPem)).toBe('VERIFIED');
    expect(verifyEvidencePackage({ ...pkg, subject: 'artifact-b' }, publicPem)).toBe('FAILED');
  });

  it('rejects self-created trust in Genesis Events', () => {
    expect(() => createGenesisEvent({
      genesisId: 'gen-1',
      tenantId: 'tenant-a',
      creatorIdentity: 'agent-a',
      creatorType: 'ai-agent',
      parentIdentity: null,
      authorityChain: ['authority-1'],
      creationTimestamp: new Date().toISOString(),
      artifactDigest: 'sha2-256:abc',
      buildEnvironment: {},
      policyVersion: 'v1',
      evidenceReferences: [],
      signingKeyId: 'key-1',
      signatureAlgorithm: 'ed25519',
      signature: 'submitted-signature',
      childIdentity: 'agent-a',
      creationReason: 'spawn',
      authorizationReference: null,
    })).toThrow('GENESIS_SELF_TRUST_FORBIDDEN');
  });

  it('fails exact artifact binding when evidence belongs to a different artifact', () => {
    expect(() => assertArtifactBinding('sha2-256:aaa', 'sha2-256:bbb')).toThrow('ARTIFACT_BINDING_MISMATCH');
    expect(() => assertArtifactBinding('', 'sha2-256:bbb')).toThrow('ARTIFACT_BINDING_UNKNOWN');
  });
});
