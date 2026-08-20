# SPR Universal Trust Product Specification

## Product promise
SPR is an evidence-first trust platform. It must never present an unsupported claim as verified. Every material claim must be traceable to observations, source, timestamp, collection method, freshness, confidence, and evidence integrity.

## Canonical lifecycle
Source -> Authenticate -> Collect -> Validate -> Normalize -> Timestamp -> Hash -> Persist -> Analyze -> Correlate -> Risk -> Remediate -> Recollect -> Verify -> Report/Passport.

## Personas
- MSP operator
- MSP technician/security analyst
- MSP customer/business owner
- Enterprise security/CISO
- Software vendor/developer
- Procurement/vendor-risk team
- Compliance/audit team
- Investor/diligence reviewer
- Public software buyer

## Core objects
Organization, Tenant, User, Role, Asset, Software, Vendor, Integration, CredentialReference, Observation, Evidence, Finding, Risk, Control, Remediation, Verification, Passport, Report, Snapshot, Alert, Incident, Job, AuditEvent.

## Integration contract
Every provider adapter must implement authenticated connection testing, scoped collection, provider-specific normalization, tenant binding, rate-limit handling, retries, idempotency, evidence creation, provenance, freshness, revocation, and truthful failure states. An integration may be labeled LIVE only after a real provider call produces persisted evidence in an automated integration test.

## Evidence states
OBSERVED = directly retrieved and validated.
DERIVED = deterministically calculated from observations.
REPORTED = supplied by an external/person source and not independently verified.
INFERRED = analytical inference, never equivalent to direct evidence.
UNVERIFIED = claim exists but cannot currently be substantiated.
UNKNOWN = insufficient evidence.
STALE = evidence exists but is outside its freshness policy.

## Trust rules
1. AI cannot create evidence.
2. A successful OAuth/API connection does not prove a security control.
3. Missing evidence must not silently become a passing result.
4. Stale evidence must visibly reduce confidence or become UNKNOWN according to policy.
5. Scores must expose their inputs and limitations.
6. Customer/tenant boundaries are mandatory at every read and write path.
7. Remediation is not complete until the underlying condition is re-collected and independently verified.

## Analysis domains
Identity, Security, Vulnerability, Supply Chain, Cloud, Endpoint, Exposure, Reliability, Resilience, Privacy, Compliance, Vendor Risk, Operational Risk, AI Governance.

## Vulnerability correlation
The platform should correlate OSV, NVD, GitHub Advisory Database, CISA KEV, EPSS, and relevant vendor advisories where legally and technically available. A vulnerability finding must distinguish presence, affected version, exposure, exploitability, fix availability, and remediation state.

## Reporting standard
Every report should contain executive summary, material changes, prioritized risks, affected assets, remediation plan, independently verified fixes, evidence coverage/freshness, limitations, source inventory, assessment/ruleset version, snapshot identifier, generation time, and evidence hashes. Technical findings must drill down to their supporting observations.

## Universal passport
A passport is a signed/versioned presentation of a trust snapshot for a software product, vendor, organization, or asset. It must show what is verified, what is derived, what is reported, what is unknown, evidence freshness, material findings, remediation status, and provenance.

## MSP workflows
Customer onboarding, asset discovery, integration connection, continuous collection, risk triage, PSA ticket creation, SLA tracking, remediation, re-verification, monthly reporting, customer portal, and white-label reporting.

## Software workflows
Repository acquisition, commit identity, SBOM, dependency graph, advisory correlation, code/security analysis, secrets detection, CI/CD posture, provenance, release integrity, remediation, and public buyer passport.

## Enterprise workflows
Internal asset inventory, third-party/vendor risk, cloud/identity posture, control mapping, evidence collection, remediation ownership, executive reporting, and audit packages.

## Buyer/auditor workflows
Public passport lookup, evidence-backed vendor comparison, limitations disclosure, point-in-time snapshots, and auditor evidence export.

## Reliability requirements
Durable jobs, idempotency, retry/backoff, dead-letter handling, provider outage states, rate-limit handling, observability, backup/restore testing, migration safety, and health/readiness checks.

## Security requirements
Encrypted provider credentials, key rotation, tenant isolation, RBAC, secure sessions, SSRF/DNS-rebinding defenses, webhook signature and replay protection, rate limiting, safe logging, secure uploads, dependency/SAST/DAST coverage, audit trails, incident response, backups, and disaster recovery.

## Definition of done
A capability is DONE only when its real data path works in production-like conditions, has automated tests, has truthful failure/unknown states, persists evidence with provenance, is tenant-safe, is observable, and is exposed in the appropriate UI/API/report. UI presence alone is never completion.
