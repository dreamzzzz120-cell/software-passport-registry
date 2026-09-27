/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ProviderCredentials } from './adapters.ts';
import type { ProviderSoftwareObservation } from './provider-software-lineage.ts';

export type SoftwareInventoryCoverage = {
  provider: string;
  observations: ProviderSoftwareObservation[];
  complete: boolean;
  status: 'COMPLETE' | 'PARTIAL' | 'UNSUPPORTED';
  limitationCode: string | null;
  limitation: string | null;
};

/**
 * Device software inventory collection is deliberately capability-specific.
 * A provider being authenticated/live does not imply this capability exists.
 * Add a provider only after its authoritative API endpoint, pagination and
 * customer/device scoping have been verified and tested.
 */
export async function collectProviderSoftwareInventory(
  provider: string,
  _credentials: ProviderCredentials,
  _providerCustomerId: string,
): Promise<SoftwareInventoryCoverage> {
  return {
    provider,
    observations: [],
    complete: false,
    status: 'UNSUPPORTED',
    limitationCode: 'COLLECTOR_NOT_VERIFIED',
    limitation: 'No verified device-software API collector is implemented for this provider.',
  };
}
