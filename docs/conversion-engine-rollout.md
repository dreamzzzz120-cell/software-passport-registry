# SPR conversion-engine rollout
Status: CODE PROPOSED; NOT INTEGRATED; NOT DEPLOYED; NOT PRODUCTION VERIFIED.

This initial module is intentionally pure: it recommends actions and never sends email, grants Stripe entitlements, or claims measured ROI. 
## Required acceptance gates
1. Wire server-authenticated scan/report/signup/checkout events with tenant-scoped identity. Do not trust user-submitted tenant IDs.
2. Provide only real terminal reports, with explicit UNKNOWN where evidence is absent.
3. Wire report UI to signup, upgrades, and honest plan pricing; keep free scans usable.
4. For follow-ups: validate documented lawful contact basis, suppression, unsubscribe and consent on enqueue AND send; enforce durable database uniqueness on dedupeKey, rate caps and verified sender; no unsolicited bulk sends.
5. Entitlements only via signature-verified Stripe webhooks and reconciliation against cancellations/refunds, never client checkout events.
6. Display time-savings only with recorded baseline and assumptions, never fabricated estimates.
7. Separate visitors, registrations, active users, Stripe customers, active subscriptions and successfully paid invoices on the founder dashboard.
8. Test tenant boundaries, forged events, concurrency/deduplication, consent withdrawals, retries, provider failures and billing reversals.
9. Run npm test, npm run typecheck, production browser acceptance and one true scan→report→signup→checkout→paid webhook→entitlement path before claiming PROVEN.
