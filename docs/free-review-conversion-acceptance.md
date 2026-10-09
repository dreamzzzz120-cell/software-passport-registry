# Free Review to paid conversion — acceptance gates

State labels: PROVEN / FAILED / CONFIG_REQUIRED / UNKNOWN. Never infer a completed payment from a coupon, test event, or checkout page view.

1. Anonymous visitor opens `/free-review`, submits a valid public repository, receives a completed or explicitly failed scan, and can reopen its tokenized result link.
2. The result renders evidence, observations, unknowns, and accurate PDF/download status without claiming an unverified feature.
3. Clicking Claim routes to signup and preserves the completed result URL through signup/login and account provisioning. Verify separately with a real browser.
4. Pricing displays the live `/api/billing/catalog` catalog; unavailable checkout is communicated rather than silently succeeding.
5. A real (non-test, non-coupon) paid checkout redirects from billing to Stripe and returns a confirmed event/webhook; verify signature, idempotency, paid invoice and entitlement. Never make a charge only to satisfy this test.
6. Funnel metrics separately report Free Review starts, accepted scans, completed scans, result views, signup completions, checkout starts, successful paid invoices, and active paid entitlements. Deduplicate; mark bot/human classification UNKNOWN unless verified.
7. Check cancellation/failed payment, tenant boundaries, expired tokens, and the inability of the public result to leak a private tenant's evidence.

This is a checklist, NOT production verification. Existing UI buttons and redirects are not proof of end-to-end conversion.
