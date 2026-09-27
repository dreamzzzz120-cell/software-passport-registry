/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { collectProviderSoftwareInventory } from './provider-software-inventory.ts';

describe('provider software inventory capability', () => {
  it('fails closed instead of treating authenticated providers as software inventory capable', async () => {
    const result = await collectProviderSoftwareInventory('ninjaone', { accessToken: 'test' }, 'customer-1');
    expect(result.status).toBe('UNSUPPORTED');
    expect(result.complete).toBe(false);
    expect(result.limitationCode).toBe('COLLECTOR_NOT_VERIFIED');
    expect(result.observations).toEqual([]);
    expect(result.limitation).toMatch(/No verified device-software API collector/);
  });
});
