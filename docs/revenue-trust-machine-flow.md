# MSP revenue review and machine trust flow

## MSP user

1. Sign in to the MSP workspace and add a client and software passport.
2. Connect a supported source and run a scan. The review panel only surfaces an open high or critical finding that points to a recent evidence-ledger record with a verification method and digest.
3. Open **MSP Command → Revenue intelligence**. Inspect the finding, passport, affected client, and linked evidence. A candidate is a reason to investigate, not a quote or booked revenue. If nothing qualifies, the panel reports no candidate in its bounded view, not a clean estate.
4. Choose **Accept for review** or **Dismiss**. SPR records the actor, finding, action, evidence IDs, and audit entry. Neither action creates a PSA deal, sends a customer message, or changes a trust decision. A further explicit approval workflow is required before any external sales action.

## Machine client

Create an API key with `read` scope under the authenticated API-key management screen. Keep it secret. Query:

```http
GET /api/agent/v1/revenue/opportunities?clientId=<client-id>&limit=25
X-API-Key: <SPR API key>
```

`findingId` can select one candidate. The response includes finding and evidence IDs, observation time, suggested review, `estimatedValue: null`, `incomplete`, and `requiresHumanApproval`. Results are tenant-scoped and bounded. A `risk.created` event from the existing webhook pipeline can prompt the receiver to query this endpoint; a risk event does not guarantee a revenue candidate.

For a recorded human review, subscribe a webhook to `opportunity.reviewed`. The existing signed delivery worker retries and records failures. This payload contains the review ID, finding ID, and action; use a scoped API to retrieve permitted detail. Treat duplicate event IDs idempotently. The event is not permission for the receiving PSA or CRM to contact a customer.

Compare an artifact digest with a passport's registered digest:

```http
GET /api/agent/v1/passports/<passport-id>/registered-digest?digest=sha256:<64-hex>
X-API-Key: <SPR API key>
```

`REGISTERED_DIGEST_MATCH` and `REGISTERED_DIGEST_DIFFERENT` describe a comparison to a stored record. Both return `identityVerified: false` and `trustDecision: NOT_EVALUATED`. A verified IS/IS NOT assertion requires authenticated artifact provenance and is not implemented by this endpoint. Never treat a registration mismatch as proof of a counterfeit binary.

## Data and operational limits

- Current rule: open high/critical trust finding with a linked evidence record observed within 30 days, a nonempty verification method, and a SHA-256-shaped evidence digest. The read path does not independently rehash source evidence.
- No MSP rate card, client budget, project scope estimate, recurring revenue, or booked amount is inferred.
- The candidate query examines up to 50 findings and 5,000 evidence rows per request. `incomplete: true` signals a bounded result; pagination and persisted candidate lifecycle remain future work.
- A human review is persisted in `revenue_opportunity_reviews`. It does not dispatch a quote or CRM object.
- Supported webhook events are configured in SPR Connect. Existing subscriptions must add `opportunity.reviewed` explicitly.
