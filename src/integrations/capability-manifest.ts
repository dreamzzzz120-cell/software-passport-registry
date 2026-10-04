import crypto from 'node:crypto';
import type { UniversalConnector } from './universal-fabric.ts';

export const SPR_ADAPTER_PROTOCOL_VERSION = 'spr.adapter.v1' as const;
export const SPR_EVIDENCE_ENVELOPE_VERSION = 'spr.evidence-envelope.v1' as const;
export const SPR_POLICY_PLUGIN_VERSION = 'spr.policy-plugin.v1' as const;
export const SPR_EVENT_VERSION = 'spr.event.v1' as const;

export type Capability =
  | 'identity' | 'inventory' | 'source' | 'builds' | 'deployments'
  | 'dependencies' | 'sbom' | 'vulnerabilities' | 'runtime' | 'logs'
  | 'alerts' | 'tickets' | 'documents' | 'users' | 'policies'
  | 'attestations' | 'provenance' | 'ai-agents';

export type CapabilitySupport = 'supported' | 'unsupported' | 'unknown';
export type EvidenceDisposition = 'observed' | 'verified' | 'rejected' | 'unknown' | 'unavailable';

export interface CapabilityDeclaration {
  capability: Capability;
  support: CapabilitySupport;
  evidenceTypes: readonly string[];
  freshnessSeconds: number | null;
  notes?: string;
}

export interface AdapterManifest {
  protocolVersion: typeof SPR_ADAPTER_PROTOCOL_VERSION;
  id: string;
  name: string;
  adapterVersion: string;
  provider: string;
  state: 'live' | 'planned' | 'disabled';
  auth: UniversalConnector['auth'];
  capabilities: readonly CapabilityDeclaration[];
  emits: typeof SPR_EVIDENCE_ENVELOPE_VERSION;
  unknownByDefault: true;
}

export interface VersionedEvidenceEnvelope<T = unknown> {
  schemaVersion: typeof SPR_EVIDENCE_ENVELOPE_VERSION;
  evidenceId: string;
  provider: string;
  adapterId: string;
  adapterVersion: string;
  capability: Capability;
  subject: {
    type: string;
    id: string;
    version?: string | null;
  };
  observedAt: string;
  ingestedAt: string;
  source: {
    uri: string | null;
    verificationMethod: string;
    responseHash: string | null;
  };
  disposition: EvidenceDisposition;
  confidence: number | null;
  payload: T;
  limitations: readonly string[];
}

export interface AdapterCollectionContext {
  tenantId: string;
  requestedCapabilities: readonly Capability[];
  now: () => Date;
}

export interface EvidenceAdapter<TCredentials = unknown> {
  manifest: AdapterManifest;
  collect(credentials: TCredentials, context: AdapterCollectionContext): Promise<readonly VersionedEvidenceEnvelope[]>;
}

export interface PolicyDecision {
  policyId: string;
  policyVersion: string;
  state: 'pass' | 'fail' | 'unknown' | 'not-applicable';
  evidenceIds: readonly string[];
  reasons: readonly string[];
}

export interface PolicyPlugin {
  protocolVersion: typeof SPR_POLICY_PLUGIN_VERSION;
  id: string;
  version: string;
  consumes: readonly Capability[];
  evaluate(evidence: readonly VersionedEvidenceEnvelope[]): Promise<readonly PolicyDecision[]> | readonly PolicyDecision[];
}

export interface SprEvent<T = unknown> {
  schemaVersion: typeof SPR_EVENT_VERSION;
  id: string;
  type: 'evidence.observed' | 'evidence.rejected' | 'software.changed' | 'risk.changed' | 'policy.evaluated' | 'integration.degraded';
  occurredAt: string;
  tenantId: string;
  subjectId: string;
  source: string;
  payload: T;
}

export class AdapterRegistry {
  private readonly adapters = new Map<string, EvidenceAdapter>();

  register(adapter: EvidenceAdapter): void {
    assertValidAdapterManifest(adapter.manifest);
    if (this.adapters.has(adapter.manifest.id)) throw new Error(`ADAPTER_ALREADY_REGISTERED:${adapter.manifest.id}`);
    this.adapters.set(adapter.manifest.id, adapter);
  }

  get(id: string): EvidenceAdapter | undefined { return this.adapters.get(id); }
  manifests(): AdapterManifest[] { return [...this.adapters.values()].map(a => a.manifest); }
}

export function manifestFromConnector(connector: UniversalConnector, adapterVersion = '1.0.0'): AdapterManifest {
  return {
    protocolVersion: SPR_ADAPTER_PROTOCOL_VERSION,
    id: `spr.connector.${connector.id}`,
    name: connector.name,
    adapterVersion,
    provider: connector.id,
    state: connector.state,
    auth: connector.auth,
    capabilities: connector.capabilities.map(capability => ({
      capability,
      support: connector.state === 'live' ? 'supported' : 'unknown',
      evidenceTypes: [],
      freshnessSeconds: null,
      ...(connector.state === 'live' ? {} : { notes: 'Adapter capability is declared but not production-observed yet.' }),
    })),
    emits: SPR_EVIDENCE_ENVELOPE_VERSION,
    unknownByDefault: true,
  };
}

export function assertValidAdapterManifest(manifest: AdapterManifest): void {
  if (manifest.protocolVersion !== SPR_ADAPTER_PROTOCOL_VERSION) throw new Error('ADAPTER_PROTOCOL_VERSION_UNSUPPORTED');
  if (!/^[a-z0-9][a-z0-9._-]{2,127}$/.test(manifest.id)) throw new Error('ADAPTER_ID_INVALID');
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.adapterVersion)) throw new Error('ADAPTER_VERSION_INVALID');
  if (manifest.unknownByDefault !== true) throw new Error('ADAPTER_MUST_PRESERVE_UNKNOWN');
  const capabilities = manifest.capabilities.map(c => c.capability);
  if (new Set(capabilities).size !== capabilities.length) throw new Error('ADAPTER_CAPABILITY_DUPLICATE');
}

export function createEvidenceEnvelope<T>(input: {
  provider: string;
  adapterId: string;
  adapterVersion: string;
  capability: Capability;
  subjectType: string;
  subjectId: string;
  subjectVersion?: string | null;
  observedAt: string;
  sourceUri?: string | null;
  verificationMethod: string;
  responseHash?: string | null;
  disposition?: EvidenceDisposition;
  confidence?: number | null;
  payload: T;
  limitations?: readonly string[];
  ingestedAt?: string;
  evidenceId?: string;
}): VersionedEvidenceEnvelope<T> {
  const observedMs = Date.parse(input.observedAt);
  if (!Number.isFinite(observedMs)) throw new Error('EVIDENCE_OBSERVED_AT_INVALID');
  const ingestedAt = input.ingestedAt ?? new Date().toISOString();
  const confidence = input.confidence ?? null;
  if (confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) throw new Error('EVIDENCE_CONFIDENCE_INVALID');

  const stableMaterial = JSON.stringify({
    provider: input.provider,
    adapterId: input.adapterId,
    adapterVersion: input.adapterVersion,
    capability: input.capability,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    subjectVersion: input.subjectVersion ?? null,
    observedAt: input.observedAt,
    sourceUri: input.sourceUri ?? null,
    responseHash: input.responseHash ?? null,
  });
  const evidenceId = input.evidenceId ?? `ev_${crypto.createHash('sha256').update(stableMaterial).digest('hex').slice(0, 32)}`;

  return {
    schemaVersion: SPR_EVIDENCE_ENVELOPE_VERSION,
    evidenceId,
    provider: input.provider,
    adapterId: input.adapterId,
    adapterVersion: input.adapterVersion,
    capability: input.capability,
    subject: { type: input.subjectType, id: input.subjectId, ...(input.subjectVersion !== undefined ? { version: input.subjectVersion } : {}) },
    observedAt: input.observedAt,
    ingestedAt,
    source: {
      uri: input.sourceUri ?? null,
      verificationMethod: input.verificationMethod,
      responseHash: input.responseHash ?? null,
    },
    disposition: input.disposition ?? 'observed',
    confidence,
    payload: input.payload,
    limitations: [...(input.limitations ?? [])],
  };
}

export function missingCapabilityEnvelope(input: {
  provider: string;
  adapterId: string;
  adapterVersion: string;
  capability: Capability;
  subjectType: string;
  subjectId: string;
  reason: string;
  observedAt?: string;
}): VersionedEvidenceEnvelope<null> {
  const observedAt = input.observedAt ?? new Date().toISOString();
  return createEvidenceEnvelope({
    ...input,
    observedAt,
    verificationMethod: 'capability-not-observed',
    disposition: 'unknown',
    confidence: null,
    payload: null,
    limitations: [input.reason],
  });
}
