# SPR Production Scale Hardening

## Required invariants

- Confidence/freshness decay is computed at read time or incrementally from evidence timestamps. Never run an application-wide decay UPDATE.
- Heavy SBOM and vulnerability processing runs asynchronously in workers, never on an API request thread.
- External advisory providers use bounded concurrency, provider-specific rate limits, exponential backoff with jitter, bounded retries, and caching.
- Trust-graph traversal is bounded by depth and node/edge budgets and uses indexed keys.
- Tenant-scoped graph/evidence data remains tenant isolated; global registry data is read-optimized and cacheable only where safe.
- Pipeline jobs are idempotent, observable, retryable, and resumable after worker termination.
- Queue depth, oldest-job age, retries, failures, and processing latency are observable.
- Production load tests cover multiple tenants, large SBOMs, concurrent scans, advisory throttling, worker restarts, and graph reads.

## Release gates

1. No synchronous SBOM parsing on API request paths.
2. No unbounded recursive graph query.
3. No unbounded retry loop.
4. No cross-tenant query without explicit tenant context.
5. No application-wide confidence-decay write loop.
6. Pipeline jobs have stable idempotency keys.
7. Worker failures are visible and actionable.
8. Queue backlog has actionable thresholds.
9. Graph traversal queries have supporting indexes.
10. Load tests demonstrate acceptable latency under expected MSP concurrency.
