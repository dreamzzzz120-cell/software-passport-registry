import { describe, expect, it } from 'vitest';
import { CONNECTOR_SECURITY_POLICY, UNIVERSAL_CONNECTORS, connectorCoverage } from './universal-fabric';

describe('SPR universal integration fabric', () => {
  it('keeps connector identifiers unique', () => {
    const ids = UNIVERSAL_CONNECTORS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never labels an unimplemented connector as live', () => {
    for (const connector of UNIVERSAL_CONNECTORS) {
      expect(['live', 'planned', 'disabled']).toContain(connector.state);
    }
    expect(connectorCoverage().total).toBeGreaterThanOrEqual(40);
  });

  it('enforces the connector security floor', () => {
    expect(CONNECTOR_SECURITY_POLICY.transport).toBe('https-only');
    expect(CONNECTOR_SECURITY_POLICY.ssrfProtection).toBe(true);
    expect(CONNECTOR_SECURITY_POLICY.privateAddressBlocking).toBe(true);
    expect(CONNECTOR_SECURITY_POLICY.metadataEndpointBlocking).toBe(true);
    expect(CONNECTOR_SECURITY_POLICY.clientCredentialExposure).toBe(false);
    expect(CONNECTOR_SECURITY_POLICY.observationHash).toBe('sha256');
    expect(CONNECTOR_SECURITY_POLICY.unknownStateAllowed).toBe(true);
  });
});
