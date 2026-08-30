# SPR Verification Policy

**Policy version: 1.0.0**

This document defines what SPR means by **VERIFIED**. It is the plain-English
counterpart to `src/lib/verification/verificationPolicy.ts`, and the two must
not contradict each other (`tests/verification-engine.test.ts` guards this).

## What VERIFIED means

A claim is VERIFIED when, and only when, evidence exists that:

1. is of the **required type** for that claim,
2. comes from a **source the policy accepts** for that claim,
3. includes **provenance** — a content hash, a source identity and an
   observation timestamp,
4. is bound to a **pinned target identity** (a 40-character commit SHA), where
   the claim requires one,
5. is **fresh** enough for that claim, and
6. meets the required number of **distinct sources**, including at least one
   **third-party** source.

## What VERIFIED does not mean

It does **not** mean the software is safe, secure, compliant, certified, or
free of vulnerabilities. It means a specific, named claim met a specific,
published evidentiary bar. Any claim SPR has not verified stays UNKNOWN.

## The claims

SPR never asserts "this software is verified" as a single blanket statement.
It evaluates five claims independently:

| Claim | Accepted sources | Max age | Pinned commit | Required for passport |
|---|---|---|---|---|
| `REPOSITORY_IDENTITY` | github.com | 90 days | yes | yes |
| `DEPENDENCY_INVENTORY` | syft, github.com | 30 days | yes | yes |
| `DEPENDENCY_VULNERABILITY_STATE` | api.osv.dev | 7 days | no | yes |
| `SECRET_EXPOSURE_STATE` | spr-scanner | 30 days | yes | no |
| `BUILD_PROVENANCE` | publisher-attestation | 365 days | yes | yes |

## Source independence

Independence is judged on **source identity**, never on record ids, job ids,
timestamps, or response hashes. Two OSV responses a week apart are still
**one source** (`api.osv.dev`). Five hundred of them are still one source.

Sources are further split by party:

- **Third-party**: `github.com`, `api.osv.dev`, `publisher-attestation`
- **First-party**: `syft`, `spr-scanner`, `unknown` — tools SPR itself runs

Every claim requires at least one third-party source. **SPR asserting its own
scan output can never verify a claim**, because SPR vouching for SPR is not
corroboration.

## Consequence for today's production data

Under policy 1.0.0, a repository scan alone reaches **PARTIAL at best, never
VERIFIED**, because `BUILD_PROVENANCE` requires a publisher attestation that
SPR did not generate. The existing production passport is expected to remain
UNKNOWN or PARTIAL. **That is the correct result, not a defect** — the policy
was not weakened to make the dashboard look better.

## The states

- **VERIFIED** — the predicate is satisfied.
- **PARTIAL** — some claims verified, required ones not yet.
- **INVESTIGATE** — adverse observations (open findings) need human review.
  This is a separate dimension from verification: findings are not a
  verification failure, and zero findings is not verification.
- **UNKNOWN** — insufficient evidence to make the claim. **Unknown is a
  successful result**, not a failure, and never implies the software is unsafe.
- **AVOID** — reserved; not produced automatically by policy 1.0.0.

## Reason codes

`POLICY_SATISFIED`, `NO_EVIDENCE`, `REQUIRED_EVIDENCE_MISSING`,
`INSUFFICIENT_INDEPENDENT_SOURCES`, `STALE_EVIDENCE`, `MISSING_PROVENANCE`,
`IDENTITY_UNVERIFIED`, `IDENTITY_MISMATCH`, `UNPINNED_TARGET`,
`CONFLICTING_EVIDENCE`, `ADVERSE_FINDINGS_PRESENT`.

## Determinism and versioning

The evaluator is a pure function. It performs no database, network, or clock
access — the evaluation instant is supplied by the caller. Identical evidence
plus identical policy version always yields an identical decision.

Every decision records `policyVersion`. When the policy changes, the version
changes, and historical decisions remain attributable to the policy under
which they were made. Historical decisions are never silently reinterpreted.

## Evidence is never mutated

Verification is a **conclusion about** evidence, not a change **to** it.
Observations keep their original `OBSERVED` / `UNKNOWN` status, timestamps,
hashes and provenance forever. Nothing in this engine rewrites, deduplicates,
merges, or relabels historical evidence.
