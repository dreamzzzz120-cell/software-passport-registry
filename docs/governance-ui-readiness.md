# Governance Tier-1 UI — Readiness Report

Scope: the customer-facing UI over the Governance & Compliance Tier-1
backend (Policy Registry, Control Library, Framework/Requirement engine,
Risk Register, Control Testing, and the read-only Findings/Audit views),
built on top of commit `9afc537` and shipped in commits `db896a2` and
`89b85c9`. This report covers only this UI increment — the much larger
remaining scope (legal documents, Security Center, privacy/incident/
BC-DR/access-governance/training/exceptions/customer-evidence-request/
auditor-mode systems) is out of scope here and tracked separately in
`docs/governance-compliance-inventory.md`.

## Methodology, and an honest limitation

Every button was traced to a real backend contract (see
`docs/governance-ui-action-map.md`) and that contract was exercised
against the live production API using a real Firebase-authenticated
session for the real Owner account, following this session's established
verification pattern (mint a custom token, exchange it for a real ID
token, call the real production HTTPS API).

**What this does not include**: this repository has no browser-automation
tooling (no Playwright, Cypress, or React Testing Library configured
anywhere in `package.json`), and none was available to add and validate
within this pass without introducing a large, untested new dependency.
So while every button's *backend contract* was proven end-to-end against
real production data, no literal rendered-browser click-through was
performed. The zero-dead-control audit (empty handlers, TODO/FIXME,
`alert()`, mock data) was done by source inspection instead, backed by
20 automated contract tests (`tests/governance-ui-contract.test.ts`) that
pin the absence of those patterns and the presence of the real API calls.
This is a real gap between "verified against the real API" and "verified
by literally clicking the rendered page" — stated plainly rather than
implied away.

## What the live workflow verification actually did

Executed against production, in order, using the real Owner account:
Create Policy → Edit → Submit for Review → Approve → Create Control →
attempt a control test with `PASS` and no evidence (expect rejection) →
attempt again with evidence attached (expect success) → open the WHY
provenance view → Create Risk → attempt risk acceptance with missing
required fields (expect rejection) → complete risk acceptance with all
required fields → verify the audit trail recorded every mutation → list
real findings. Every step matched its expected real-backend result.

**A real production defect was found and fixed during this pass**: the
first WHY-endpoint call returned `500`, not the honest chain-status
response it should have. Root cause: `id = ANY(${arr})` does not bind a
JS array as a single Postgres array parameter under Drizzle's `sql`
tagged template — it spreads the array into a parenthesized placeholder
list, so Postgres received a scalar where it expected an array and
rejected the query with "malformed array literal." This was reproduced
directly against production before any fix was written, and the same
pattern was found — independently of this UI work — pre-existing in
`verifyRemediation()` (`src/trust/trust-loop.ts`, backing the real `POST
/api/trust-loop/verify` endpoint), meaning **remediation verification
against real evidence has likely never completed successfully in
production**, in any session, until this fix (commit `89b85c9`). Both
were corrected (`id IN ${arr}`), covered by 3 new regression tests, and
re-verified live: the WHY endpoint now returns `200` with an honest
`chainComplete: false` and a specific missing-evidence explanation for
the test data used (which deliberately referenced a non-existent
evidence ID, proving the honesty logic works, not just the happy path).
The `verifyRemediation` fix was verified at the database-query level
(the exact failing query now succeeds) rather than through a full live
HTTP call, since exercising it end-to-end would have required fabricating
real trust-loop state (a finding, matching evidence, and observations)
that doesn't safely exist as disposable test data.

All test fixtures created during this verification (1 policy, 1 control,
1 control test, 1 risk) were deleted via direct, tenant-scoped DB
deletes, with a follow-up query confirming zero residue.

## Classification

### WIRED AND PRODUCTION VERIFIED
- Policies: create, edit, approve (as a distinct action from ordinary
  editing), retire (via lifecycle status change), search, filter,
  related-control navigation, save/error states.
- Controls: create, edit, search, filter, related-policy navigation,
  control testing (including the live-confirmed PASS-requires-evidence
  rejection and successful PASS-with-evidence path), WHY provenance view.
- Frameworks: list, per-framework requirement list (correctly empty until
  an admin adds one), add-requirement flow that enforces a real
  authoritative source before a requirement can be marked verified,
  tenant "our status" mapping.
- Risks: create, edit, view, search, filter, risk-decision recording with
  the full authorized-person/date/scope/rationale requirement enforced
  by both zod and a DB CHECK constraint, live-confirmed rejection of an
  incomplete request.
- Findings: real server-side search/filter against `trust_findings`,
  governance disposition recording (with the evidence-derived status
  rendered read-only, never editable here), WHY provenance view.
- Audit trail: real cursor-paginated read of the tamper-evident
  `audit_trail`, with governance mutations from this session's testing
  confirmed present in it.
- Cross-tab "related control/policy" navigation resolves to the actual
  record, not just a bare tab switch.

### IMPLEMENTED BUT NOT UI-ENABLED
None currently — every route added for this tier has a corresponding,
wired UI control.

### NOT IMPLEMENTED
- Governance-specific report generation/export (Executive/Technical/
  Evidence reports over policies/controls/risks, CSV/PDF export) — no
  backend route exists; no button is presented for it (see the action
  map's explicit "not implemented" list rather than a disabled stub).
- Editing or deleting a recorded control test, risk-acceptance record, or
  finding disposition — these are intentionally append-only, matching the
  immutable-ledger pattern used elsewhere in SPR (vendor audits,
  remediation notes).
- A literal rendered-browser click-through automated test (see
  "Methodology" above) — the closest available equivalent (a full-API
  live workflow script covering the same sequence) was run instead.
- Everything outside Tier 1's scope: legal documents, Security Center,
  Privacy Management, Incident/Breach Management, BC/DR, Access
  Governance, Training, Exceptions, Customer Evidence Requests,
  Auditor/Reviewer Mode, and SPR's own internal self-assessment passport.

### LEGAL REVIEW REQUIRED
None specific to this UI increment — the underlying legal-accuracy
findings (RLS default-off, AI subprocessor disclosure, incomplete tenant
deletion, no certifications held) are tracked in
`docs/legal-commercial-readiness-audit.md`, not introduced or changed by
this UI work.

### EXTERNAL ASSURANCE REQUIRED
None specific to this UI increment. Framework/requirement content
entered through the "Add requirement" flow still requires the entering
admin to have actually sourced it correctly — the UI enforces that a
citation is present before a requirement can be marked `VERIFIED_SOURCE`,
but cannot itself verify the citation's accuracy.
