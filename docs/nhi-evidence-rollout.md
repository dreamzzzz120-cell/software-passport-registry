# NHI evidence foundation — staged rollout

Status: CODE ONLY / NOT INTEGRATED / NOT PRODUCTION VERIFIED.

This change introduces a passive evidence-validation contract and unit tests. It does not create an inventory, scan accounts, change permissions, connect to a provider, mount routes, or change live behavior.

## Authority boundary
- SPR observes attributable evidence and retains UNKNOWN when not observed.
- A public repository hint is not proof that an active identity exists in a customer's environment.
- An attestation is CLAIMED, not OBSERVED.
- Ownership metadata is not proof of identity, verification, authorization or safety.
- Constellation independently interprets evidence; SPR must never export portable trust scores, approved/safe/compliant flags, or execution authority.
- Never collect/store raw tokens, passwords, private keys or secret values.

## Next gates before production use
1. Inspect existing authenticated tenant middleware, schema migrations, RLS policies and evidence ledger; use established patterns.
2. Add additive tables with tenant-id isolation and compound uniqueness; link all observations to immutable, attributable source evidence. Ensure cross-tenant joins and record reads are denied in database tests.
3. Add an authenticated read-only collection endpoint behind a disabled-by-default flag, scope tenant only from server-verified session. No arbitrary URL fetches or SSRF exposure.
4. Use provider least-privilege consent; redact logs; apply quotas, retries, and input size constraints; preserve provenance and timestamps.
5. Add access-controlled inventory and client-ready UNKNOWN-aware reports; verify empty, stale, missing-owner and revoked-source cases.
6. Test code, migration/rollback, RLS, concurrent upserts, forgery, replay, secret leakage, and provider failures.
7. Pilot with a consenting tenant, verify actual evidence, export and monitoring end to end, then gradual rollout.

Definition of Done is a real production pilot with verified tenant isolation and evidence lineage, not passing tests alone.
