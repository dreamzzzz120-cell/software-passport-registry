# SPR Scale Readiness

## Target

Engineer for 1,000,000 registered users with horizontal application scaling, distributed abuse controls, durable background work, and strict tenant isolation.

This target is **not** a claim that one million concurrent users have been measured.

## Release gates

- Typecheck passes.
- Full automated test suite passes.
- Production build passes.
- Dependency/security scans pass.
- Health/readiness checks pass after deployment.
- Load test has <1% request failure rate and p95 <500ms / p99 <1s for the tested health workload.
- Database connection usage remains below configured capacity during load.
- Redis/queue backlog remains bounded.
- No cross-tenant authorization failures occur under concurrent load.
- No crash loop, OOM, or runaway retry behavior occurs.

## Load progression

Run controlled tests at 10, 50, 100, 250, 500, and 1000+ virtual users first. Increase only after each stage meets the SLOs. Capacity claims for larger populations must be based on measured traffic profiles, not registered-user count alone.

## Operational requirements

- Stateless API instances.
- Shared Redis for distributed rate limits and queues.
- PostgreSQL pooling and query timeouts.
- Durable/idempotent jobs and webhook processing.
- Graceful shutdown and health/readiness checks.
- Centralized error/latency metrics and alerts.
- Automated rollback for failed deployments.
- Tested backups and restore procedure.
