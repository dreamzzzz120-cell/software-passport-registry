/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type ReconciliationDecision = 'KEEP_ACTIVE' | 'MARK_ABSENT';

export function reconcileMissingCustomer(input: {
  seenInCurrentRun: boolean;
  discoveryComplete: boolean;
}): ReconciliationDecision {
  // Absence is evidence only when the provider inventory was completely
  // exhausted. Partial/failed collections can never deactivate a customer.
  return !input.seenInCurrentRun && input.discoveryComplete ? 'MARK_ABSENT' : 'KEEP_ACTIVE';
}
