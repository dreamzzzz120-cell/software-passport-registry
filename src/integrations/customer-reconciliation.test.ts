/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { reconcileMissingCustomer } from './customer-reconciliation.ts';

describe('customer reconciliation', () => {
  it('never marks a missing customer absent after a partial collection', () => {
    expect(reconcileMissingCustomer({ seenInCurrentRun: false, discoveryComplete: false })).toBe('KEEP_ACTIVE');
  });
  it('marks a missing customer absent only after complete provider exhaustion', () => {
    expect(reconcileMissingCustomer({ seenInCurrentRun: false, discoveryComplete: true })).toBe('MARK_ABSENT');
  });
  it('keeps a seen customer active', () => {
    expect(reconcileMissingCustomer({ seenInCurrentRun: true, discoveryComplete: true })).toBe('KEEP_ACTIVE');
  });
});
