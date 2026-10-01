# Datasphere

Datasphere is hidden infrastructure shared by SPR and Constellation. It is not a customer-facing product and does not own SPR or Constellation business logic.

## Contract
Datasphere collects authorized observations, preserves append-only history, links events through stable identifiers, hashes and correlations, and returns preserved records to authorized callers.

It never upgrades missing evidence into a positive claim. UNKNOWN stays UNKNOWN.

## Safety invariants
- tenant_id is mandatory on every event
- source_system is explicit: SPR or CONSTELLATION
- source_event_id is idempotent per tenant/source
- payload and evidence hashes are persisted
- events form a per-tenant hash chain
- UPDATE and DELETE are rejected at the database layer
- ingestion is authenticated
- raw source payload is preserved
- derived intelligence is stored as a new event, never by mutating source history

## Deployment
Run as an independent Railway service with its own Postgres database.

Required environment:
- DATABASE_URL
- DATASPHERE_INGEST_TOKEN (32+ characters)
- PORT (optional)

Run migrations/001_init.sql before starting.

Do not move current operational state out of SPR or Constellation during first rollout. Dual-write selected durable events, verify parity, then move historical and analytical reads behind Datasphere.
