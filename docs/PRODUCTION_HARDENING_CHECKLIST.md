# SPR Production Hardening Checklist

This document is the release gate for production hardening. It deliberately records verification requirements rather than claiming checks that cannot be performed from source control alone.

## Required release gates

- [ ] Production deployment is healthy after the release.
- [ ] Database migrations complete with zero errors.
- [ ] Application readiness reports database and tenant-isolation health.
- [ ] Unauthenticated protected APIs return `401`.
- [ ] Founder-only APIs require authenticated owner authorization and reject non-founders.
- [ ] Tenant-scoped APIs cannot read or mutate another tenant's resources.
- [ ] Free Review performs a real acquisition/scan/persistence path; no mocked evidence is accepted.
- [ ] Locked/premium evidence is enforced server-side and is not merely hidden in the UI.
- [ ] Stripe webhook signature verification is enabled in production.
- [ ] Email delivery configuration is present before claiming notification delivery is operational.
- [ ] Worker and web services both expose useful error telemetry.
- [ ] Production startup is resilient to transient database availability during bootstrap.
- [ ] Build, typecheck, and regression suites pass before promotion.

## Evidence standard

A source-code implementation is not sufficient evidence that a production behavior works. Each gate should be backed by a live response, deployment log, migration result, or automated test result. If a gate cannot be live-tested with the connected credentials, mark it **NOT VERIFIED** rather than **PASS**.

## Security rules

1. Never place founder allowlists, service credentials, webhook secrets, or database credentials in source control.
2. Founder authorization must be derived server-side from trusted identity claims and/or a server-side allowlist; client-provided founder flags are untrusted.
3. Every tenant resource query must remain tenant-scoped, including background jobs and administrative workflows.
4. Premium evidence must be filtered before serialization to unentitled clients.
5. Error responses must not disclose secrets, tokens, SQL, stack traces, or cross-tenant identifiers.
6. Migrations must be idempotent or safely tracked by the repository migration mechanism.

## Release discipline

- Changes should land on a dedicated hardening branch first.
- Run automated gates before merging.
- Promote only the exact reviewed commit.
- Re-check the deployed commit and readiness state after deployment.
- Record any unverifiable external dependency as an explicit operational blocker.
