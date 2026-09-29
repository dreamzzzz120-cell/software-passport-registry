# MSP Lead Intelligence security invariants

These are release-blocking invariants for the MSP lead-generation capability.

1. **Tenant isolation** — every persisted lead object is tenant scoped and protected by forced PostgreSQL RLS.
2. **Cross-tenant integrity** — child records cannot reference a lead belonging to another tenant, including privileged database paths.
3. **Evidence before qualification** — a lead must not be presented as evidence-backed without persisted observations.
4. **Unknown stays unknown** — absence of evidence is never converted into a negative security/compliance assertion or buying-intent assertion.
5. **Append-only evidence** — persisted lead evidence cannot be edited or deleted in place. Corrections are new observations.
6. **Human outreach gate** — discovery/qualification cannot automatically authorize outreach. Approval identity and timestamp are required.
7. **Fresh evidence gate** — outreach cannot be queued without at least one current supporting observation.
8. **Suppression wins** — a tenant suppression record blocks new outreach events for the normalized target.
9. **Idempotency** — a tenant cannot create two outreach events with the same idempotency key.
10. **Fact/inference/estimate separation** — estimated commercial value is not a verified fact and must retain assumptions.
11. **No secret collection** — evidence payloads must not intentionally persist credentials, access tokens, session material or authentication secrets.
12. **Auditability** — state-changing API work must use SPR's authenticated tenant-scoped DB context and audit/event mechanisms.

## Required tests before production activation

- tenant A cannot read/write tenant B leads, evidence, reviews, suppressions, or outreach
- cross-tenant lead child insert is rejected
- evidence update/delete is rejected
- unapproved outreach is rejected
- approved lead with no current evidence is rejected
- suppressed target outreach is rejected
- duplicate idempotency key is rejected
- stale-only evidence cannot authorize outreach
- zero-evidence qualification fails closed
- estimate is never serialized as an observed fact
- malformed evidence digest is rejected
- client/read-only roles cannot mutate lead state
- transaction rollback leaves no partial review/outreach state

The feature must remain disabled from automated sending until these invariants are covered by executable integration tests and the API uses the existing authenticated tenant transaction context.
