# SPR MSP Readiness -- Phase 1 (static/source verification)

This is the first phase of the MSP acceptance program requested in full. It
covers what can be genuinely verified **from a stateless code sandbox with
no live database, no running worker/queue, no Firebase Admin credentials to
mint synthetic users, and no Stripe test-mode webhook signing.** That is a
real, mechanical limitation of this environment, not a decision about scope.

Every test in `tests/msp/` follows this repo's existing, already-trusted
methodology (see `tests/tenant-rls-coverage-contract.test.ts` and the ~100
other `*-contract.test.ts` files): static verification against real source
files, never mocks standing in for real behavior. A `.todo` entry in these
files means a real, currently-true gap, documented rather than hidden --
never a placeholder for something that was skipped to make a number look
better.

## PASS -- genuinely verified this pass

| Area | What was verified | Where |
|---|---|---|
| Tenant isolation (routes) | Every route file either queries through `req.db` (RLS-scoped) / explicit `tenant_id`, or is on a hand-verified exemption list with a real reason | `msp-tenancy.test.ts` |
| RBAC | `TeamView.tsx`'s `PERMISSION_MATRIX` genuinely matches the `requireRole(...)` gates on the real routes it claims to describe; `Client` role never appears in an admin-route gate | `msp-rbac.test.ts` |
| Billing (no-subscription != app-wide 402) | Denial is capability-scoped via `capabilityForPath` + `evaluateCapability`, never a blanket lockout; a real named exempt-path list exists | `msp-billing.test.ts` |
| Stripe webhooks | Signature verified before any event is processed; duplicate events rejected via a real DB-level idempotency guard (`ON CONFLICT ... WHERE processed_at IS NULL`); the add-on-vs-plan subscription confusion bug stays fixed | `msp-webhooks.test.ts` |
| Health/readiness | `/ready` ANDs three real checks (DB reachable, RLS live-verified via `spr_assert_tenant_rls()`, runtime role genuinely least-privilege) and fails closed (503) if any one fails -- also independently confirmed by this session's own `npm test` runs, which printed a real `/ready will report the database as unavailable` message from an actual failed connection attempt in this sandbox | `msp-health.test.ts` |
| Audit logging (partial) | Login (via `user_sessions`), workspace/account creation, role changes, client creation, billing events, and administrative actions (retention, branding, tenant deletion requests) all write real, hash-chained `audit_trail` entries | `msp-audit.test.ts` |
| Cross-tenant leak found & fixed this pass | `GET /api/traffic/summary` was gated by `requireRole(['Owner','Admin'])` only -- since Owner/Admin are per-tenant roles, any paying customer could see platform-wide traffic across every tenant. Not called from any frontend view (confirmed dead in the UI, pure oversight). Fixed to also require `requireFounder`. | `src/routes/traffic.ts` |

## FAIL -- real, currently-true gaps

| Area | Gap | Why it matters |
|---|---|---|
| Audit logging (scan/evidence/passport) | Zero `appendAuditEntry` calls exist anywhere for scan execution, evidence creation, or Passport publication | Section 20 explicitly requires these; someone asking "who ran this scan and when" or "when was this Passport published" has no audit answer today, even though the hash-chained ledger these would write to already exists and works for every other event type |

## BLOCKED -- cannot be executed from this sandbox, not a judgment that they don't matter

| Section | What's required | Why it's blocked here |
|---|---|---|
| 4 (live isolation) | Two real tenants, real login sessions, cross-tenant fetch attempts against a live Postgres+RLS instance | No database connection reachable from this sandbox |
| 5-14 (full synthetic MSP + golden path) | Real Firebase test users, a running app instance, real client/asset creation through the live API | No Firebase Admin credentials to mint test users; no running instance to call |
| 6, 9, 10 (passport pipeline, decision ledger, change detection) | Running the real scan pipeline end-to-end against live assets | No worker/queue execution environment here |
| 12 (worker/queue) | Real job submission, retry, concurrency behavior | Same -- no running worker |
| 16-17 (live billing/webhook flows) | Real Stripe test-mode checkout sessions and signed webhook deliveries | No Stripe test-mode credentials or network path from this sandbox to receive them |
| 22-23 (observability, scale) | Real Sentry-captured errors, 10+ synthetic tenants under real concurrent load | No running instance; scale testing needs real infrastructure, not source review |

## What Phase 2 needs

A staging environment (staging Postgres with RLS, a running app instance,
Firebase Admin credentials scoped to test users, Stripe test-mode keys)
that a CI job or a person can drive to actually execute sections 4-23
live, plus real integration/E2E tests (not more static contracts) against
it. That is infrastructure and credentials work, not something this
sandbox can bootstrap on its own.

## FINAL STATUS

**NOT READY FOR PILOT -- BLOCKERS REMAIN.**

Not because anything found here is broken (most of what was checked is
genuinely solid), but because "MSP ready" is a live-system claim and most
of the spec's required verification cannot be executed from a sandbox with
no database, no worker, and no test credentials. Phase 1 is real, honest
progress; it is not the finish line.
