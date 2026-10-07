import type { Request } from 'express';
import { expect, it } from 'vitest';
import { capabilityForPath } from '../src/security/entitlements';

it('preserves the paid capability when the Agent moves to its dedicated namespace', () => {
  for (const operation of ['/command', '/verify-software', '/receipts/confirmation', '/vendor-risk', '/revenue-opportunities']) {
    const oldRequest = { baseUrl: '/api/agent/v1', path: operation } as Request;
    const newRequest = { baseUrl: '/api/experience-agent/v1', path: operation } as Request;
    expect(capabilityForPath(newRequest)).toBe(capabilityForPath(oldRequest));
    expect(capabilityForPath(newRequest)).toBe('api');
  }
});
