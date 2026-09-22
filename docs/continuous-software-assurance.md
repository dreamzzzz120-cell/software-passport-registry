# SPR Continuous Software Assurance

## Purpose

Continuous Software Assurance (CSA) is an MSP-facing recurring service built on SPR's existing registry, evidence, verification, monitoring, passport, and reporting capabilities.

CSA does **not** claim that a client is secure or hack-proof. It continuously establishes what software SPR can observe, identify, verify, and report about.

## Service loop

`DISCOVER -> IDENTIFY -> COLLECT EVIDENCE -> VERIFY -> DETECT CHANGE -> REPORT -> REVERIFY`

Every observation should preserve:

- tenant/client scope
- software identity
- evidence source
- observation timestamp
- freshness
- verification policy/version
- result and status
- limitations/unknowns
- change history

## Continuous coverage

### Software inventory
- discover software and services
- normalize names and providers
- maintain stable software identities
- detect new, removed, renamed, or changed software

### Security and lifecycle
- monitor available vulnerability/advisory evidence
- identify stale or unsupported software when evidence supports the claim
- surface unknown or unverifiable states instead of guessing

### Evidence and verification
- preserve provenance for every observation
- recompute canonical verification when evidence changes
- keep historical results
- distinguish OBSERVED, VERIFIED, UNKNOWN, STALE, FAILED, and INACCESSIBLE states

### MSP delivery
- client-specific software assurance workspace
- client portal
- recurring alerts
- scheduled reports
- evidence exports
- public/private passport sharing where authorized
- white-label presentation for MSP customers

## Control-plane architecture

CSA is a product service, not a second scanner.

```
Sources / Sensors
       |
       v
Evidence Ingestion
       |
       v
Normalization + Software Identity
       |
       v
Evidence Graph
       |
       v
Canonical Verification
       |
       v
Policy / Entitlement
       |
       +----> Alerts
       +----> Client Portal
       +----> MSP Reports
       +----> Passport
       +----> Audit Evidence
```

LOM remains a security-monitoring component underneath this architecture. It should not become the product's only monitoring mechanism.

## Enforcement safety

Automated actions must use:

`DETECT -> VERIFY -> CLASSIFY -> POLICY DECISION -> ACTION -> REVERIFY`

No automated action should invent evidence, upgrade trust because of payment, or silently alter production state.

## Commercial packaging

Initial packaging is intentionally configuration-only until exact billing terms are approved.

Suggested tiers to validate commercially:

- Free Software Review — $0
- Software Passport — $49
- Evidence Report — $99
- Assessment — $199+
- Due Diligence — $799+
- Continuous Software Assurance — recurring
- MSP White-label — recurring
- API / Registry access — recurring

These are planning values, not activated prices.

## Definition of done

CSA is commercially ready only when all of the following are true:

1. A real client/tenant can be enrolled.
2. Software observations are persisted with provenance.
3. Changes generate durable events.
4. Verification is recalculated from observed evidence.
5. MSP users can see client status and history.
6. Authorized clients can access their portal.
7. Reports can be generated from real evidence.
8. Entitlements enforce paid capabilities.
9. RLS/authorization prevents cross-tenant access.
10. Monitoring failures are visible rather than silently treated as healthy.
11. The complete flow is tested against deployed infrastructure.
12. Billing is enabled only after the exact commercial configuration is approved.

## Product principle

**SPR sells continuously maintained evidence and verification about software—not a promise that software is safe.**
