# SPR MSP Readiness -- Phase 1 (static/source verification) + corrections

This document started as a static-verification-only pass from a sandbox
with no live database, no running worker/queue, no Firebase Admin
credentials to mint synthetic users, and no Stripe test-mode webhook
signing. That limitation is still real for most of the spec. It was
**not**, however, a limitation on section 4 (live tenant isolation) --
see the correction below. Read the PASS table for what's actually true.

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
| **Tenant isolation (live)** -- correction, see below | Real two-tenant test: ephemeral Postgres 16 + real Firebase Auth emulator in CI, two genuinely separate signed-in tenant identities, real cross-tenant fetch attempts against the live running app, real migrations applied first. This is section 4 of the spec, already implemented and already running as a required check (`route-security`) on every PR merged this session. | `.github/workflows/security-route-tests.yml`, `tests/security/route-authz.test.ts` (7 live assertions) |

**Correction to an earlier version of this document:** it originally listed
section 4 (live tenant isolation) under BLOCKED, on the assumption that
verifying it required a persistent staging deployment this sandbox
couldn't reach. That was wrong -- the isolation test already exists,
already runs live (real DB, real auth, real HTTP requests), and needs no
persistent staging environment at all: CI provisions Postgres and a
Firebase emulator fresh on every run via `services:` in the workflow and
tears them down after. It has been passing, unnoticed as such, as one of
the 8 required checks on every PR in this session. Leaving a wrong
BLOCKED claim in a document meant to be trustworthy would be exactly the
kind of overclaim this whole audit has been about eliminating, so it's
fixed here rather than left standing.

## FAIL -- real, currently-true gaps

| Area | Gap | Why it matters |
|---|---|---|
| Audit logging (scan/evidence/passport) | Zero `appendAuditEntry` calls exist anywhere for scan execution, evidence creation, or Passport publication | Section 20 explicitly requires these; someone asking "who ran this scan and when" or "when was this Passport published" has no audit answer today, even though the hash-chained ledger these would write to already exists and works for every other event type |

## BLOCKED -- cannot be executed from this sandbox, not a judgment that they don't matter

| Section | What's required | Why it's blocked here |
|---|---|---|
| 5-14 (full synthetic MSP + golden path) | Real Firebase test users, a running app instance, real client/asset creation through the live API | No Firebase Admin credentials to mint test users; no running instance to call |
| 6, 9, 10 (passport pipeline, decision ledger, change detection) | Running the real scan pipeline end-to-end against live assets | No worker/queue execution environment here |
| 12 (worker/queue) | Real job submission, retry, concurrency behavior | Same -- no running worker |
| 16-17 (live billing/webhook flows) | Real Stripe test-mode checkout sessions and signed webhook deliveries | No Stripe test-mode credentials or network path from this sandbox to receive them |
| 22 (observability) | Real Sentry-captured errors from a live deployment | No running instance to generate them from |

## PARTIALLY COVERED, not blocked -- just needs a target

| Section | What already exists | What's still missing |
|---|---|---|
| 23 (scale/load) | A real, dispatchable k6 load-testing workflow (`production-load.yml`) already exists: constant-arrival-rate public + authenticated traffic, real latency/error-rate thresholds (`p95<750ms`, `p99<1500ms`, error rate `<1%`), runs against any `base_url` including staging. Not something this sandbox invented -- it was already checked into the repo. | It has never been run against anything but production (per its own input description, "staging by default" implies a staging URL that doesn't exist yet). Needs: (1) a staging deployment to target, (2) confirmation `SPR_LOAD_TEST_ID_TOKEN` is a live secret, (3) the spec's "10+ synthetic clients, 100+ software assets" data volume seeded first so load actually exercises realistic query shapes, not an empty database. |

## What Phase 2 needs

A staging environment (staging Postgres, a running app instance, Firebase
Admin credentials scoped to test users, Stripe test-mode keys) that a CI
job or a person can drive to actually execute sections 5-17 and 22 live,
plus a data-volume seed for section 23's scale test to run against
something realistic. Section 4 needs nothing further -- it's done. That
remaining work is infrastructure and credentials, not something this
sandbox can bootstrap on its own.

## FINAL STATUS

**NOT READY FOR PILOT -- BLOCKERS REMAIN, FEWER THAN FIRST REPORTED.**

Section 4 (live tenant isolation) is done, not blocked -- that was this
document's own error, now corrected. What's still genuinely missing is a
live synthetic MSP walked through the full golden path (sections 5-14),
live billing/webhook execution (16-17), and a realistic-volume scale run
(23) -- all of which need a staging deployment and test credentials this
sandbox does not have. Phase 1 is real, honest progress; it is not the
finish line.
