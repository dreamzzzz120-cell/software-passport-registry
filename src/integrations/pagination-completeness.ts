/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type PaginationCompleteness = {
  complete: boolean;
  pagesFetched: number;
  recordsFetched: number;
  reason: null | 'PAGE_LIMIT_REACHED' | 'PROVIDER_REPORTED_MORE' | 'MISSING_PAGINATION_METADATA';
};

/**
 * Fail-closed pagination summary for provider inventory/discovery collectors.
 * A collector must positively establish exhaustion before it may call a
 * multi-page result complete.
 */
export function summarizePagination(input: {
  pagesFetched: number;
  recordsFetched: number;
  pageLimitReached?: boolean;
  providerReportedMore?: boolean;
  exhaustionProven?: boolean;
}): PaginationCompleteness {
  if (input.pageLimitReached) return { complete: false, pagesFetched: input.pagesFetched, recordsFetched: input.recordsFetched, reason: 'PAGE_LIMIT_REACHED' };
  if (input.providerReportedMore) return { complete: false, pagesFetched: input.pagesFetched, recordsFetched: input.recordsFetched, reason: 'PROVIDER_REPORTED_MORE' };
  if (!input.exhaustionProven) return { complete: false, pagesFetched: input.pagesFetched, recordsFetched: input.recordsFetched, reason: 'MISSING_PAGINATION_METADATA' };
  return { complete: true, pagesFetched: input.pagesFetched, recordsFetched: input.recordsFetched, reason: null };
}
