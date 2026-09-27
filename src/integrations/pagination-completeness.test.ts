/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { summarizePagination } from './pagination-completeness.ts';

describe('pagination completeness', () => {
  it('is complete only when exhaustion is positively proven', () => {
    expect(summarizePagination({ pagesFetched: 3, recordsFetched: 230, exhaustionProven: true })).toEqual({
      complete: true, pagesFetched: 3, recordsFetched: 230, reason: null,
    });
  });
  it('fails closed when the provider says more records exist', () => {
    expect(summarizePagination({ pagesFetched: 1, recordsFetched: 100, providerReportedMore: true, exhaustionProven: false }).reason).toBe('PROVIDER_REPORTED_MORE');
  });
  it('fails closed at the bounded page limit', () => {
    expect(summarizePagination({ pagesFetched: 20, recordsFetched: 2000, pageLimitReached: true }).reason).toBe('PAGE_LIMIT_REACHED');
  });
  it('fails closed when pagination metadata cannot prove exhaustion', () => {
    expect(summarizePagination({ pagesFetched: 1, recordsFetched: 100 }).reason).toBe('MISSING_PAGINATION_METADATA');
  });
});
