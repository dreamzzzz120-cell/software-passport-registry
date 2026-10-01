# Datasphere Architecture

## Purpose
Datasphere is hidden shared infrastructure beneath SPR and Constellation. M3M remains embedded inside those products. Datasphere is the durable memory of authorized observations produced by both products.

## Product boundaries
- SPR owns software passports, software evidence, trust evaluation, monitoring and customer-facing software state.
- Constellation owns AI observation, accountability, policy boundaries, timelines and customer-facing AI state.
- M3M verifies machine interactions inside SPR and Constellation.
- Datasphere collects, preserves, links and retrieves historical observations. It does not decide SPR or Constellation business outcomes.

## Non-negotiable rules
1. If a source could not observe something, Datasphere must not convert absence into a positive claim.
2. Every event is tenant-scoped.
3. Source records are append-only. Corrections are new events.
4. Every event retains source system, source event ID, observed time, evidence hash and payload hash.
5. Duplicate delivery is idempotent.
6. Datasphere failure must not corrupt source-system state.
7. Source systems retain their current operational state during migration.
8. Secrets used to write to Datasphere stay server-side.
9. Cross-tenant queries are forbidden by default.
10. Derived correlations are evidence-linked derived events, never rewrites of source history.

## Initial topology
SPR -> authenticated event emitter -> Datasphere ingest API -> append-only Postgres
Constellation -> authenticated event emitter -> Datasphere ingest API -> append-only Postgres

## Rollout
### Gate 1: Foundation
Deploy isolated Datasphere service and database. Apply append-only migration. Verify health/ready, auth rejection, invalid-event rejection, idempotency and mutation rejection.

### Gate 2: Dual write
Add transactional outboxes in SPR and Constellation. Source transactions commit locally first; workers deliver durable events to Datasphere with retries. No direct synchronous dependency in critical user requests.

### Gate 3: Parity
For selected event families, compare source counts/hashes with Datasphere. Any mismatch is UNKNOWN/DEGRADED, never silently accepted.

### Gate 4: Historical reads
Move only historical timeline, reconstruction, lineage and cross-product analytics reads behind Datasphere. Keep operational/current-state reads local.

### Gate 5: Storage specialization
Add object storage for large immutable evidence, graph projections for relationships, and analytical storage only after event volume requires them. Postgres remains the canonical event ledger unless a migration is explicitly verified.

## First event families
SPR: passport issuance, evidence observation, evidence invalidation, trust snapshot, monitoring observation, vendor/dependency change, M3M verification receipt.
Constellation: AI action, tool/API interaction, human correction, policy boundary event, cost/rework event, entity/relationship/event observations, M3M verification receipt.

## Definition of done
Datasphere is not considered production-ready until tenant-isolation attacks, duplicate/concurrent ingest, database failure, invalid hash/schema, replay, out-of-order delivery, retention, backup/restore and hash-chain verification tests pass.
