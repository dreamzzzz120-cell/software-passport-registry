# SPR first-cash conversion repair — production acceptance

Date: 2026-10-08 (Pacific). This plan is **not** a claim that implementation, production release or customer conversion has occurred.

## Observed evidence (connected live Stripe account)
- 8 Checkout Sessions: 6 expired unpaid, 1 open unpaid, 1 completed with a 100% coupon (zero collected).
- One failed charge for $149 USD was blocked by Stripe Radar as highest risk. Do not lower fraud controls.
- These sessions may include founder tests. Customer identity and genuine abandonment remain UNKNOWN.
- API Railway logs show 202 responses for traffic events; 202 is not database persistence.

## Phase 1 — Trace one real conversion end to end
- Identify the production API/worker project and its DB; do not substitute an unrelated staging or Supabase database.
- Establish reliable definitions for `report_viewed`, `pricing_viewed`, `checkout_started`, `checkout_completed`, `payment_succeeded`, and `entitlement_active`. Prefer existing canonical event and billing names where available; do not create duplicate sources of truth.
- For each event, record generated correlation_id, timestamp, source, tenant/user scope if authenticated, and privacy-safe anonymous session ID if consent allows. Do not collect card details, raw IPs or unnecessary personal data.
- Mark founder/test events separately. Do not call anonymous sessions unique human users; UNKNOWN stays UNKNOWN. Dedupe retries.
- For checkout_started, store the Stripe session ID only in a tenant-scoped backend record; redact it in public interfaces. On webhook, validate signatures, idempotency, livemode/account and the tenant mapping before updating entitlements.
- Use one consenting tester to validate frontend action -> successful event ingestion -> DB row -> founder funnel aggregation. A successful 202 alone is insufficient.
- Build an Owner-only founder funnel showing distinct *eligible sessions*, raw event counts, completed non-discounted payments and a time window. Missing telemetry must show UNKNOWN with last-event timestamp, never zero.

## Phase 2 — Customer-facing offer and report
- Show a concise outcome-based offer: reusable, evidence-backed client software reviews with verified sources and explicit unknowns. Avoid guarantees of revenue, compliance or time saved.
- Confirm Free Review report opens, glossary explains jargon, null scores read Not measured, PDF actually renders and paginates, and share link is accessible with safe authorization.
- Put one direct next action after a completed report: request MSP pilot / view MSP plan. Do not gate already promised free results.
- Verify prices/currencies and tax disclosures on the page exactly match Stripe Checkout. Do not silently change prices.
- Acceptance: external tester can complete public repository scan -> read report -> open/download PDF -> open share link -> reach the disclosed checkout, with no console or server errors.

## Phase 3 — Real MSP pilots
- Identify three MSP business decision-makers in Canada with verified organization and public business contact route; no scraped personal emails or assumed consent.
- Send individually reviewed, compliant, truthful outreach, with sender identity, mailing address and unsubscribe where applicable (CASL/US CAN-SPAM as relevant). Record consent/legal basis, suppression and delivery receipt.
- Give each an actual public-repo pilot. Measure baseline manual preparation time and assisted time using the same output standard; distinguish self-report from stopwatch measurements.
- Record interested / booked / tested / declined only from real evidence. Target 3 pilot users; do not fabricate them.

## Phase 4 — First paid customer
- Do not run an actual live card charge without an authorized willing customer. For test behavior use Stripe test mode, not live card simulations.
- Verify non-discounted checkout with displayed currency/amount, genuine successful payment, paid invoice with amount_paid > 0, webhook receipt, correct tenant entitlement, and cancellation/failed-payment handling.
- Distinguish Stripe blocked-card event from payment integration failure. Keep Radar protections.
- Report paid-conversion numerator only when verified; never treat $0 paid invoice as cash revenue.

## Release gates
1. Typecheck, build, existing regression and new focused funnel tests pass.
2. Security review: tenant scope, RLS, privacy, consent, spoofed events, webhook signature/idempotency, double entitlements, discount loopholes and test/live separation.
3. Preview browser verification and real PDF visual test pass.
4. Explicit production deployment approval and migrations if needed, then monitor for regressions.
5. Production read-only reconciliation of source event, DB ingestion, founder funnel and Stripe, with receipt IDs and timestamps.
6. Mark each state PROVEN / FAILED / CONFIG_REQUIRED / UNKNOWN; do not claim completed until all required gates have recorded evidence.

## Immediate owner decisions
- Existing production checkout pricing stays unchanged pending pricing experiment evidence.
- No mass mail, fraud-rule weakening, fake users, artificial payments, or fictitious time savings.
