# Software Passport Registry API v1

SPR's developer API is an evidence-first integration layer for MSPs, vendors, CI/CD systems, procurement workflows, and continuous verification.

## Base URL

Production routes are currently exposed under `/api/agent/v1`.

## Authentication

Create an API key from an authenticated Owner/Admin session:

```http
POST /api/agent/v1/api-keys
Authorization: Bearer <firebase-id-token>
Content-Type: application/json
```

```json
{"name":"CI production","scopes":["read","write"]}
```

The secret is returned once. SPR stores only its SHA-256 hash. Send it on developer API calls as:

```http
X-API-Key: spr_live_...
```

Available scopes: `read`, `write`, `webhooks`.

## Mint a passport

```http
POST /api/agent/v1/passports
X-API-Key: spr_live_...
Content-Type: application/json
```

```json
{
  "name": "EnterpriseLogisticsApp",
  "version": "4.2.1",
  "publisher": "Example Vendor",
  "checksum": "<64-character SHA-256 hex digest>",
  "category": "software",
  "licenseType": "UNKNOWN"
}
```

Minting registers an observed software identity. It does **not** manufacture a trust score or mark the software safe. A newly minted passport therefore returns `trustStatus: UNKNOWN` until evidence is observed and evaluated.

## Verify

```http
POST /api/agent/v1/passports/verify
X-API-Key: spr_live_...
Content-Type: application/json
```

```json
{"passportId":"pass_..."}
```

The response contains an evidence-backed status (`VERIFIED`, `INVESTIGATE`, `AVOID`, or `UNKNOWN`), observed evidence counts, freshness/observation information, findings, source metadata, and explicit limitations.

## Evidence and freshness

```http
GET /api/agent/v1/passports/{passportId}/evidence
GET /api/agent/v1/passports/{passportId}/freshness?staleAfterDays=30
GET /api/agent/v1/passports/{passportId}
```

## CI/CD pattern

1. Build software.
2. Generate the release SHA-256 and SBOM in the customer's pipeline.
3. Call `POST /passports` with the observed release identity.
4. Feed collected evidence into the normal SPR evidence pipeline.
5. Call `POST /passports/verify` to retrieve the current evidence-backed state.
6. Store the returned passport ID and observation hash in the deployment record.

## Trust rule

SPR does not infer facts it cannot observe. `UNKNOWN` is a valid result, not a failure to be hidden. API responses deliberately avoid claims such as “safe to deploy” or regulatory compliance unless the underlying evidence and authoritative evaluator establish them.

## Rate limiting and tenant isolation

The API uses the existing production rate-limiting layer and tenant-scoped database access. API-key lookups are hash-only and tenant data is filtered through the same scoped database path used by the authenticated application.
