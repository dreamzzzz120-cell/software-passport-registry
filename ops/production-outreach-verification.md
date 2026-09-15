# Production Outreach Verification Runbook

## Green criteria

1. Crawler discovers at least one real public repository prospect.
2. Discovery is persisted in `registry_ingestion_items`.
3. Qualification produces an outreach-eligible prospect.
4. Outreach creates a queued/sending ledger entry.
5. Provider accepts the message.
6. Delivery/outcome is recorded.
7. No mass outbound is enabled by this verification artifact alone.

## Required production evidence

Capture worker logs and database records for one controlled test prospect. Do not use a real third-party recipient for the first production verification. Use the configured verification recipient and a synthetic/test prospect where supported.

## Failure interpretation

- Discovery zero: crawler disabled, GitHub search/rate limit, or worker not running.
- Discovery present but no qualification: distribution qualification gate/configuration issue.
- Qualified but no queue entry: campaign/outreach gate issue.
- Queue entry but no provider acceptance: sender/provider configuration issue.
- Provider accepted but no outcome: webhook/delivery tracking issue.

## Safety

Autonomous mass outbound must remain disabled until the controlled end-to-end verification passes and production outbound settings are deliberately approved.
