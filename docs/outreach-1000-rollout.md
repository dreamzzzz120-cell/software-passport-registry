# PR #1084: governed outreach hardening and rollout

Prepared against PR head `dfb370a29b646b387b08751017c1e56a1a25e326`.
This is a local implementation and verification record. It does not establish
that these changes are merged, deployed, configured, or accepted in production.

## Implemented controls

- Renumber the cap migration to 0142 and add reservation migration 0143.
  Both have bounded lock/statement timeouts and run transactionally.
- Campaign API accepts integer caps 1–1000. Sends enforce the smaller of the
  stored campaign cap and the environment ceiling; the environment default
  stays 50. Missing campaign settings fail closed.
- Initials and follow-ups reserve capacity under the same campaign-row lock.
  The reservation commits before the provider call. The contact is locked and
  eligibility, campaign pause, basis, and sender verification are rechecked
  before dispatch. A concurrent unsubscribe cannot retract a dispatched email,
  but its committed state stops subsequent sends.
- A unique durable logical send key identifies an initial email or numbered
  follow-up. The same key is supplied to the provider. Follow-ups must have a
  recorded initial send, a due date, remaining allowance, and no response or
  conversion stage. Message receipt, contact update, attribution, and attempt
  settlement commit together.
- Unknown outcomes and abandoned reservations block automatic replay
  indefinitely. This is deliberately conservative beyond the provider's
  idempotency retention window. Definite HTTP 429 rejections may retry with the
  same key after at least 60 seconds. Other ambiguous provider/database errors
  require reconciliation. Reservations/unknowns consume capacity on every
  subsequent day until resolved; they are never silently expired.
- Provider requests time out after 15 seconds. A success without a provider ID
  is UNKNOWN. Daily accounting uses UTC and includes initial/follow-up messages
  plus unresolved reservations. Internal sender checks and transactional mail
  also consume provider quota, but are outside this outreach counter.
- Sender verification must match the configured outreach From/verification To
  pair and contain a provider acceptance ID. Provider acceptance still does
  not prove inbox delivery, reply routing, SPF/DKIM/DMARC, or current quota.
- Reservation pacing is shared across workers, defaults to at least one
  second, and is not proof of any account-specific provider rate allowance.
  Pauses, cap exhaustion, pacing, verification configuration, and rate-limit
  waits defer jobs without consuming their retry budget.
- Contact ingestion handles an insert race without reviving suppressed or
  unsubscribed records. The unsent sweep skips unresolved/blocked attempts.
- One PostgreSQL session advisory lease governs discovery sweeps across
  replicas. A lease is destroyed if unlocking fails. A seed-list sweep requests
  2000 candidates once; repeated sweeps skip known domains. Seeds are validated
  and deduped before truncation. Extra seeds retain existing provider precedence.

## Local verification and its limits

Tests cover the actual outreach entry points against embedded PostgreSQL SQL
and a controlled provider: sender matching, basis/consent gates, receipt storage,
unsubscribe persistence, follow-up attribution, and the API 1000/1001 boundary.
Reservation tests cover the 999-to-1000 boundary, concurrent callers, environment
versus campaign ceilings, duplicate jobs, accepted-send/receipt failure, timeout,
abandoned reservations past 24 hours, definite 429 cooldown, contact states,
follow-up claiming, and UTC accounting. Worker tests exercise a 2000-seed sweep,
repetition, concurrent sweep callers, and recorded origin metadata.

Embedded PostgreSQL supplies real SQL/constraints/transactions but one database
session. Test connection leases are serialized; discovery advisory locks are
modeled. These tests do **not** prove real multi-session or multi-process lock
behavior, live RLS privileges, provider delivery, or production throughput.
Those remain rollout acceptance checks, rather than claims of completion.

Validation: typecheck and production build passed. The full suite reported
2061 passed / 29 skipped, with no failures. After the final discovery lease
cleanup and runtime-privilege test, 20 focused tests passed and typecheck/build
passed again. The runtime here is Node 24; CI/production's declared Node 22
runtime still needs its own successful run.

## CONFIG_REQUIRED before enabling prospect outreach

1. Apply the reviewed migrations with a migration-capable role. Verify the live
   migration ledger, cap constraint, attempt table, RLS policies and runtime
   grants. Reserve migration numbers against the latest main before publishing.
2. Confirm matching deployment versions on every worker. Old workers must not
   remain able to send through the earlier unreserved path.
3. Verify `DISTRIBUTION_AUTONOMOUS_OUTREACH`, `RESEND_API_KEY`, `EMAIL_FROM`,
   `DISTRIBUTION_OUTREACH_FROM`, `DISTRIBUTION_OUTREACH_VERIFY_TO`, the unsubscribe
   signing secret, campaign pause/cap and `DISTRIBUTION_DAILY_SEND_LIMIT`.
   Choose the provider-appropriate `DISTRIBUTION_SEND_INTERVAL_MS`.
   Discovery holds a dedicated advisory-lease connection while queueing; set
   the worker pool to at least two connections (`SQL_POOL_MAX >= 2`).
4. Verify actual account daily/monthly quotas and request limits, with headroom
   for auth, invitation, sender-verification, and other transactional mail.
5. Receive the sender-check email and prove reply routing. Inspect domain
   authentication and delivery events. The new gate is acceptance-based; it
   does not replace this inbox test.
6. Prove bounce/complaint events update durable suppression. An active-status
   check alone does not establish that webhook processing is configured.
7. Confirm recipient permission/evidence and approved USA/Canada scope. A stored
   `legitimate_interest` label or a Free Review signup is not independent proof
   of permission for every marketing message. Do not fabricate attestations.

## Smallest rollout acceptance

1. Keep prospect outreach paused. Stop/drain old send workers and inspect
   queued/running jobs and historical provider/ledger discrepancies. Never
   replay a historical uncertain email merely because the ledger lacks a row.
2. Rehearse both migrations on a representative database copy, including a
   forced lock timeout and rollback. Verify existing records/defaults survive.
3. With real PostgreSQL and two worker processes, race initial/follow-up jobs at
   999/1000, attempt duplicate jobs and simultaneous discovery sweeps, and race
   pause/unsubscribe changes. Assert the external-call count and committed
   message IDs, not just queue statuses. Inject 429, timeout, provider acceptance
   followed by receipt/commit failure, and process restart. Assert unknown
   attempts remain blocked and suppressed contacts stay inactive.
4. Use an authorized internal recipient to prove sender, delivery, replies,
   unsubscribe, and provider-message/ledger reconciliation. Observe real
   suppression processing before sending a prospect canary.
5. Run a small authorized prospect canary at a low stored/environment cap.
   Increase only after reconciling attempts, provider IDs, deliveries, bounces,
   complaints, suppression, queue age, and database/worker health. The 1000
   ceiling is an allowance, not a throughput guarantee.

## Stop and recovery

Pause outreach on any duplicate provider send, cap overrun, suppression failure,
unresolved acceptance/receipt mismatch, or loss of sender/provider configuration.
Inspect `distribution_send_attempts` with status `reserved` or `unknown` and
reconcile against provider records. Do not reset these to retryable without
evidence that no message was accepted. Any reconciliation must account for the
contact state, follow-up sequence and existing message receipt atomically.

Keep the additive schema on application rollback. Pause outreach before rolling
back to an older worker, which lacks reservation enforcement. Lowering a cap or
pausing does not retract messages already dispatched. GitHub publication,
merging, migrations, deployment and any real-email canary need explicit approval
under the user's original restriction.
