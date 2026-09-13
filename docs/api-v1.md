# Software Passport Registry API v1

Evidence-first integration API for MSPs, vendors, CI/CD systems, procurement workflows, and continuous verification.

Base path: `/api/agent/v1`

API keys are created by authenticated Owner/Admin users, stored only as SHA-256 hashes, and scoped to `read`, `write`, or `webhooks`. Passport registration requires `write`; verification, evidence, freshness, and vendor-risk reads require `read`.

A newly registered passport is `UNKNOWN` until evidence is observed. The API never manufactures trust, provenance, compliance, or safety claims.

## Endpoints

- `POST /api-keys` — create a key; secret is returned once.
- `GET /api-keys` — list key metadata without secrets or hashes.
- `DELETE /api-keys/:keyId` — revoke a key within the authenticated tenant.
- `GET /openapi.json` — API discovery.
- `POST /passports` — register an observed software identity.
- `POST /passports/verify` — return evidence-backed verification state.
- `GET /passports/:passportId` — verification snapshot.
- `GET /passports/:passportId/evidence` — observed evidence.
- `GET /passports/:passportId/freshness` — observation freshness.
- Existing Experience Agent endpoints remain available, including `/command`, `/verify-software`, `/verify-passport`, `/passport/:passportId`, and `/vendor-risk`.

## CI/CD pattern

Build the release, compute its SHA-256 and SBOM, register the observed identity, feed evidence through the normal SPR evidence pipeline, then verify the passport and retain the passport ID plus observation hash in the deployment record.
