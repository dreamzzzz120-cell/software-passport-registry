# Billing & Paywall — Repository Inventory (Phase 1)

Grounds the requested MSP subscription/entitlement system in what already
exists, per direct inspection of the code below. Nothing here is assumed.

**Labels:** `ALREADY IMPLEMENTED` · `PARTIALLY IMPLEMENTED` · `NEEDS ENGINEERING`
· `NEEDS CONFIGURATION` · `NEEDS EXTERNAL PROVIDER` · `NEEDS LEGAL REVIEW` · `UNKNOWN`

Last generated: 2026-08-29, against commit `71fd645`.

| Area | Status | Evidence |
|---|---|---|
| Stripe integration | `ALREADY IMPLEMENTED` | `src/routes/billing.ts` — real Checkout Session creation (`POST /checkout`), real Billing Portal session creation (`POST /portal`), real signature-verified + idempotent webhook handler (`stripeWebhookHandler`, keyed on `billing_webhook_events.id`). Not a stub. |
| Subscription storage | `ALREADY IMPLEMENTED` | `tenant_subscriptions` table (migration `0031_billing.sql`): `tenant_id` PK, `stripe_customer_id`, `stripe_subscription_id`, `plan` (CHECK: `starter`\|`growth`\|`enterprise`), `status` (CHECK: `incomplete`\|`trialing`\|`active`\|`past_due`\|`canceled`\|`unpaid`), `client_limit`, `current_period_end`. RLS enabled. |
| Plan/price mapping | `PARTIALLY IMPLEMENTED` | `PLAN_CLIENT_LIMITS` in `billing.ts` hard-codes 3 tiers (`starter:5, growth:25, enterprise:null`) — does not match this spec's 5-tier structure (Pilot/Starter/Professional/Growth/Enterprise) or the specified prices/limits. Price IDs are correctly never hard-coded — read from `STRIPE_PRICE_STARTER`/`STRIPE_PRICE_GROWTH`/`STRIPE_PRICE_ENTERPRISE` env vars only (`config.ts`), so a plan with no configured price ID is honestly reported as unavailable for checkout, never fabricated. |
| Centralized entitlement logic | `PARTIALLY IMPLEMENTED` | `checkClientLimit()` exists in `billing.ts` but its own comment states plainly: *"there is currently no backend route that creates a client at all, so nothing calls this yet."* Confirmed by grep: zero call sites. The one real, mutating, tenant-scoped resource-creation route that should be entitlement-gated (`POST /api/user/clients` in `auth.ts`) has **no plan-limit enforcement today** — a real, pre-existing gap, not a regression. |
| Webhook security | `ALREADY IMPLEMENTED` | Signature verification via `stripe.webhooks.constructEvent`, mounted with `express.raw()` before the JSON body parser (required for signature bytes to match), idempotent via `billing_webhook_events` insert-with-`ON CONFLICT DO NOTHING`. |
| Billing audit logging | `NEEDS ENGINEERING` | Zero `appendAuditEntry` call sites anywhere in `billing.ts` — checkout initiation, subscription activation, plan changes, and payment-failure transitions are **not** currently recorded in the tamper-evident `audit_trail`. |
| RBAC on billing routes | `ALREADY IMPLEMENTED` | `POST /checkout` → `Owner` only. `POST /portal` → `Owner`/`Admin`. `GET /` (status) → any authenticated user. Reuses the existing `requireRole` middleware — no second authorization model. |
| Tenant isolation on billing | `ALREADY IMPLEMENTED` | Every billing route reads `tenantId` from `req.user!.tenantId` (server-side authenticated context) — never from the request body or a client-supplied value. The webhook handler (no per-request tenant context, since it's a Stripe server callback) explicitly scopes every write by `tenant_id` from Stripe's own `metadata`/`client_reference_id`, or by `stripe_subscription_id`, matching the documented pattern used elsewhere for provider callbacks. |
| Billing dashboard UI | `ALREADY IMPLEMENTED` (for 3 tiers) | `src/components/BillingView.tsx` — real fetch of `GET /api/billing`, real Subscribe/Manage-billing actions, honest "billing not configured" empty state when no Stripe key is set. Needs updating for the 5-tier structure. |
| Pricing page | `ALREADY IMPLEMENTED` (for 3 tiers, no real prices) | `src/components/MspPricingView.tsx` — currently shows Starter/Growth/Enterprise all as "Contact for pricing" (deliberately honest, since no committed price existed before now). Needs updating with the real prices this spec specifies. |
| Usage tracking | `PARTIALLY IMPLEMENTED` | Client count is computed live via `COUNT(*) FROM clients WHERE tenant_id = ...` (real, not cached/estimated) but only surfaced in the billing status endpoint — not tracked for any other capability (Passports, reports, monitoring, API calls). |
| Concurrency-safe limit enforcement | `NEEDS ENGINEERING` | `checkClientLimit` is a plain check-then-act (`SELECT COUNT`, then `INSERT` in a separate statement) with no DB-level constraint or lock — two simultaneous requests could both pass the check before either commits. No existing enforcement to evaluate since nothing calls it yet. |
| Capability gating beyond Client count | `NOT IMPLEMENTED` | No existing code restricts Passport creation, monitoring, governance, privacy, reporting, or exports by plan. Confirmed by grep — no other capability has any limit concept today. |
| Free/trial experience | `PARTIALLY IMPLEMENTED` | Because `tenant_subscriptions` has no row for a tenant that has never checked out, and nothing currently enforces limits, every tenant today effectively has unrestricted access regardless of plan — this includes the one real production tenant. Any new enforcement must not silently lock out that account or any future tenant that predates a subscription record; see the design decision below. |
| Graceful degradation on cancellation | `PARTIALLY IMPLEMENTED` | The webhook correctly sets `status = 'canceled'` without deleting any data (separate, pre-existing full-tenant-deletion path is `POST /api/tenant/offboard`, entirely distinct and never triggered by billing state). No code currently *reads* `status = 'canceled'` to restrict anything, since nothing enforces plan limits yet. |
| Stripe production configuration | `NEEDS CONFIGURATION` | Whether `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`STRIPE_PRICE_*` are actually set in the live Railway environment is a deploy-time fact this repo cannot confirm on its own; `GET /api/billing`'s `billingConfigured` field is the honest live indicator. |
| Legal terms (refunds, cancellation, taxes) | `NEEDS LEGAL REVIEW` | No refund policy, proration rule, or tax-handling logic exists anywhere in code — Stripe's own configured billing behavior is authoritative for what actually happens, but the *commercial terms* customers are told (a Pilot Agreement, ToS, etc.) are tracked separately in `docs/legal-commercial-readiness-audit.md` and remain unwritten. |

## Design decision carried into this increment

**A tenant with no `tenant_subscriptions` row (or no `plan` set) is treated
as unrestricted, not as "no plan."** This is deliberate, not an oversight:
retroactively enforcing a limit on every existing tenant that predates this
system — including the one real production tenant, who never agreed to any
plan — would silently lock a real account out of its own data. Enforcement
in this increment applies only to a tenant that has an actual plan
recorded (i.e., has been through checkout, or been assigned one directly).
New-tenant signup defaulting to a real `pilot` row automatically is
`NEEDS ENGINEERING` for a later increment (there is no signup/onboarding
flow that creates that row today).

## Scope of this increment

Given the size of the full specification (32 phases spanning capability
gating across every SPR module, full concurrency testing, downgrade/
proration semantics, and a rebuilt commercial pricing page), this increment
implements the foundational, honestly-verifiable slice:

1. The 5-tier plan/price model (Pilot/Starter/Professional/Growth/Enterprise)
   with real, configuration-driven limits and Stripe price mapping.
2. A centralized entitlement module, replacing the unused `checkClientLimit`
   with a real `canCreateClient`/`getPlanLimits` pair.
3. Real backend enforcement wired into the one concrete, previously-
   unenforced mutation (`POST /api/user/clients`), including the DB-level,
   advisory-lock-serialized concurrency guard the spec requires.
4. Billing audit logging (checkout initiated, plan recorded, subscription
   activated/updated/canceled, payment failed, limit reached).
5. Updated Billing dashboard and pricing page reflecting the real 5 tiers.
6. Tests: RBAC, tenant isolation, the structured limit-reached response,
   and the concurrency guard.

**Explicitly deferred to later increments** (tracked here, not silently
dropped): capability gating for Passports/monitoring/governance/privacy/
reporting/exports; a real trial/Pilot auto-provisioning signup flow;
downgrade/proration semantics beyond what Stripe's own portal already
handles; full concurrent-load testing beyond the single DB-level guard;
Enterprise custom-contract tooling beyond marking the plan as
contact-only.
