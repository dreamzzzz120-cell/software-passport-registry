import { describe, expect, it } from 'vitest';
import { UNIVERSAL_CONNECTORS } from '../src/integrations/universal-fabric.ts';
import {
  AdapterRegistry,
  SPR_ADAPTER_PROTOCOL_VERSION,
  SPR_EVIDENCE_ENVELOPE_VERSION,
  createEvidenceEnvelope,
  manifestFromConnector,
  missingCapabilityEnvelope,
} from '../src/integrations/capability-manifest.ts';

describe('future-proof integration kernel', () => {
  it('converts every connector into a versioned machine-readable manifest', () => {
    const manifests = UNIVERSAL_CONNECTORS.map(connector => manifestFromConnector(connector));
    expect(manifests).toHaveLength(UNIVERSAL_CONNECTORS.length);
    expect(new Set(manifests.map(m => m.id)).size).toBe(manifests.length);
    for (const manifest of manifests) {
      expect(manifest.protocolVersion).toBe(SPR_ADAPTER_PROTOCOL_VERSION);
      expect(manifest.emits).toBe(SPR_EVIDENCE_ENVELOPE_VERSION);
      expect(manifest.unknownByDefault).toBe(true);
    }
  });

  it('never upgrades planned capabilities into supported capabilities', () => {
    const planned = UNIVERSAL_CONNECTORS.filter(c => c.state === 'planned').map(connector => manifestFromConnector(connector));
    expect(planned.length).toBeGreaterThan(0);
    for (const manifest of planned) {
      expect(manifest.capabilities.every(capability => capability.support === 'unknown')).toBe(true);
    }
  });

  it('marks live connector declarations supported without claiming evidence exists', () => {
    const live = UNIVERSAL_CONNECTORS.filter(c => c.state === 'live').map(connector => manifestFromConnector(connector));
    for (const manifest of live) {
      expect(manifest.capabilities.every(capability => capability.support === 'supported')).toBe(true);
      expect(manifest.capabilities.every(capability => capability.evidenceTypes.length === 0)).toBe(true);
    }
  });

  it('creates deterministic evidence identities from provenance, not payload prose', () => {
    const common = {
      provider: 'github',
      adapterId: 'spr.connector.github',
      adapterVersion: '1.0.0',
      capability: 'provenance' as const,
      subjectType: 'repository',
      subjectId: 'owner/repo',
      observedAt: '2026-10-04T20:00:00.000Z',
      sourceUri: 'https://github.com/owner/repo',
      verificationMethod: 'GitHub API',
      responseHash: 'sha256:abc',
      ingestedAt: '2026-10-04T20:00:01.000Z',
    };
    const first = createEvidenceEnvelope({ ...common, payload: { branch: 'main' } });
    const second = createEvidenceEnvelope({ ...common, payload: { branch: 'renamed' } });
    expect(first.evidenceId).toBe(second.evidenceId);
    expect(first.schemaVersion).toBe(SPR_EVIDENCE_ENVELOPE_VERSION);
  });

  it('represents unavailable observations as UNKNOWN instead of a fabricated pass/fail', () => {
    const evidence = missingCapabilityEnvelope({
      provider: 'future-provider',
      adapterId: 'spr.connector.future-provider',
      adapterVersion: '1.0.0',
      capability: 'runtime',
      subjectType: 'software',
      subjectId: 'future-app',
      reason: 'Provider API does not expose runtime telemetry.',
      observedAt: '2026-10-04T20:00:00.000Z',
    });
    expect(evidence.disposition).toBe('unknown');
    expect(evidence.confidence).toBeNull();
    expect(evidence.payload).toBeNull();
    expect(evidence.limitations).toEqual(['Provider API does not expose runtime telemetry.']);
  });

  it('refuses duplicate adapters and adapters that do not preserve UNKNOWN', () => {
    const connector = UNIVERSAL_CONNECTORS[0];
    const manifest = manifestFromConnector(connector);
    const registry = new AdapterRegistry();
    const adapter = { manifest, collect: async () => [] };
    registry.register(adapter);
    expect(() => registry.register(adapter)).toThrow('ADAPTER_ALREADY_REGISTERED');

    expect(() => registry.register({
      manifest: { ...manifest, id: 'spr.bad.adapter', unknownByDefault: false as true },
      collect: async () => [],
    })).toThrow('ADAPTER_MUST_PRESERVE_UNKNOWN');
  });
});
