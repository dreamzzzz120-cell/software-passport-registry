# Governance UI — Button-by-Button Action Map

Every interactive element in the Tier-1 Governance UI (`src/components/GovernanceView.tsx`
and `src/components/governance/*.tsx`), traced to its real backend contract.
Nothing in this table is a placeholder — each row was verified against the
actual route in `src/routes/governance.ts` and confirmed live against
production (see `docs/governance-ui-readiness.md`).

## Policies (`GovernancePoliciesTab.tsx`)

| UI action | Endpoint | Auth | DB mutation/read | Response | UI update | Audit event |
|---|---|---|---|---|---|---|
| Search box | (client-side filter over already-fetched real list) | n/a | none | n/a | filters visible rows | — |
| Status filter dropdown | (client-side filter) | n/a | none | n/a | filters visible rows | — |
| New (create) | `POST /api/governance/policies` | Owner/Admin | `INSERT INTO policies` | 201 + full row | list refreshed, new policy selected | `governance.policy.created` |
| Select a policy row | `GET /api/governance/policies` (already loaded) | Owner/Admin/Technician/Viewer | none | n/a | detail panel renders that row | — |
| Save changes | `PATCH /api/governance/policies/:id` | Owner/Admin | `UPDATE policies` (never touches approval fields) | 200 + full row | detail panel shows authoritative saved state | `governance.policy.updated` |
| Approve | `POST /api/governance/policies/:id/approve` | Owner/Admin | `UPDATE policies SET approval_status='APPROVED', approver_name, approved_at` | 200 + full row | approval badge updates | `governance.policy.approved` |
| Retire (confirm) | `PATCH /api/governance/policies/:id` `{status:'RETIRED'}` | Owner/Admin | `UPDATE policies` | 200 | status badge updates to RETIRED | `governance.policy.updated` |
| Related control chip | (navigation) | Owner/Admin/Technician/Viewer | none | n/a | switches to Controls tab and selects that real control once loaded | — |

## Controls (`GovernanceControlsTab.tsx`)

| UI action | Endpoint | Auth | DB mutation/read | Response | UI update | Audit event |
|---|---|---|---|---|---|---|
| Search / status filter | (client-side filter over real list) | n/a | none | n/a | filters visible rows | — |
| New (create) | `POST /api/governance/controls` | Owner/Admin | `INSERT INTO controls` | 201 | list refreshed, new control selected | `governance.control.created` |
| Save changes | `PATCH /api/governance/controls/:id` | Owner/Admin | `UPDATE controls` | 200 | detail panel shows saved state | `governance.control.updated` |
| Related policy chip | (navigation) | any non-Client role | none | n/a | switches to Policies tab, selects that real policy | — |
| Record test (submit) | `POST /api/governance/controls/:id/tests` | Owner/Admin/Technician | `INSERT INTO control_tests`; DB CHECK rejects `result='PASS'` with empty `evidence_ids` | 201, or 400 `PASS_REQUIRES_EVIDENCE` | test list prepended on success; real error message shown on rejection, form NOT cleared | `governance.control.tested` |
| Why? | `GET /api/governance/controls/:id/why` | any non-Client role | reads latest `control_tests` row + `evidence_ledger` rows it references | full chain or explicit missing-evidence list | modal renders real chain/missing reasons | — |

## Frameworks & requirements (`GovernanceFrameworksTab.tsx`)

| UI action | Endpoint | Auth | DB mutation/read | Response | UI update | Audit event |
|---|---|---|---|---|---|---|
| Select framework | `GET /api/governance/frameworks/:id/requirements` | any non-Client role | reads `compliance_requirements` LEFT JOIN `tenant_requirement_mappings` | list (may be empty) | requirement list renders, or explicit empty state | — |
| Add requirement | `POST /api/governance/frameworks/:id/requirements` | Owner/Admin | `INSERT INTO compliance_requirements`; DB CHECK rejects `VERIFIED_SOURCE` without a non-empty `authoritative_source` | 201, or 400 | list refreshed, or real validation error shown | `governance.requirement.added` |
| "Our status" dropdown | `PUT /api/governance/requirement-mappings/:requirementId` | Owner/Admin/Technician | upsert `tenant_requirement_mappings` | 200 | dropdown reflects saved value | — |

## Risks (`GovernanceRisksTab.tsx`)

| UI action | Endpoint | Auth | DB mutation/read | Response | UI update | Audit event |
|---|---|---|---|---|---|---|
| Search / status filter | (client-side filter over real list) | n/a | none | n/a | filters visible rows | — |
| New (create) | `POST /api/governance/risks` | Owner/Admin | `INSERT INTO risks` | 201 | list refreshed, new risk selected | `governance.risk.created` |
| Record risk decision (submit) | `POST /api/governance/risks/:id/accept` | Owner/Admin | `UPDATE risks`; DB CHECK requires acceptedBy+rationale+scope+reviewDate together when status is ACCEPTED | 200, or 400 (zod, before it even reaches the DB CHECK) | detail panel shows the authoritative recorded decision, or the real validation error inline | `governance.risk.acceptance_recorded` |

## Findings (`GovernanceFindingsTab.tsx`)

| UI action | Endpoint | Auth | DB mutation/read | Response | UI update | Audit event |
|---|---|---|---|---|---|---|
| Search box / status filter | `GET /api/governance/findings?q=&status=` | any non-Client role | real SQL `ILIKE`/`=` filter on `trust_findings` | filtered list | list re-renders from server response (debounced 300ms) | — |
| Select a finding | (already loaded) | any non-Client role | none | n/a | detail panel + dispositions loaded | — |
| Record disposition (submit) | `POST /api/governance/findings/:id/dispositions` | Owner/Admin/Technician | `INSERT INTO finding_dispositions`; DB CHECK requires non-empty rationale for ACCEPTED_RISK/FALSE_POSITIVE; never writes to `trust_findings.status` | 201, or 400 `RATIONALE_REQUIRED_FOR_THIS_DISPOSITION` | disposition list prepended, or real error shown | `governance.finding.disposition_recorded` |
| Why? | `GET /api/governance/why/finding/:id` | any non-Client role | reads the finding's real `evidence_ids` against `evidence_ledger` | full chain or explicit missing-evidence list | modal renders real chain/missing reasons | — |

## Audit trail (`GovernanceAuditTab.tsx`)

| UI action | Endpoint | Auth | DB mutation/read | Response | UI update | Audit event |
|---|---|---|---|---|---|---|
| Load older entries | `GET /api/auth/audit-chain?before=<id>` | any authenticated user | reads `audit_trail`, real cursor pagination, 50/page | up to 50 rows | rows appended | — |
| Search box / "Governance actions only" checkbox | (client-side filter over every page already fetched) | n/a | none | n/a | filters visible rows | — |

## Explicitly NOT implemented in this Tier-1 UI pass (not presented as active buttons)

- **Reports / exports for Governance objects** (Executive/Technical/Evidence governance reports, CSV/PDF export of policies/controls/risks) — no backend route exists for this yet. No such button appears in the UI; this is called out here and in the readiness doc rather than shipped as a disabled stub, since the whole feature is out of scope for this increment (Plain-English/ROI reporting already covers passport-level reports separately).
- **Editing/deleting a control test, risk, or finding disposition once recorded** — these are append-only by design (matching the immutable-ledger pattern used elsewhere in SPR, e.g. vendor audits, remediation notes), so no edit/delete UI is offered for them.
- **Legal document registry, client authorization, Security Center, privacy/incident/BC-DR/access-governance/training/exceptions/customer-evidence-request/auditor-mode systems** — none of this backend exists yet (see `docs/governance-compliance-inventory.md`); no UI for any of it is presented.
