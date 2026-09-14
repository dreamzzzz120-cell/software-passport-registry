# SPR Public API v1

Public API v1 is an additive machine-readable interface mounted at `/api/agent/v1`.

## Authentication

Create and manage tenant API keys through the authenticated `/api/agent/v1/api-keys` endpoints. API consumers send the returned secret as `X-API-Key`. SPR stores only a SHA-256 hash and returns the raw secret once at creation.

Keys are tenant-scoped and require explicit `read` or `write` scopes. `write` is required to register passports; `read` is required to verify, inspect evidence, and check freshness.

## Evidence semantics

The API reports what SPR can observe. Missing evidence is represented as `UNKNOWN`; the public API does not manufacture a positive trust decision, provenance, SLSA level, or payment-derived score.

## Endpoints

- `POST /api/agent/v1/passports` — register a software identity (write)
- `POST /api/agent/v1/passports/verify` — retrieve evidence-backed verification data (read)
- `GET /api/agent/v1/passports/:passportId` — retrieve verification data (read)
- `GET /api/agent/v1/passports/:passportId/evidence` — retrieve ledger evidence (read)
- `GET /api/agent/v1/passports/:passportId/freshness` — inspect observation freshness (read)
- `POST /api/agent/v1/verify-software` — resolve software to an observed passport (read)
- `POST /api/agent/v1/vendor-risk` — retrieve tenant-scoped vendor-risk evidence (read)
- `GET /api/agent/v1/openapi.json` — machine-readable endpoint description
