# SPR Governance & Compliance System — Repository Inventory (Phase 1)

Grounds the proposed Governance & Compliance System (Policy Registry, Control
Library, Compliance Framework Engine, Evidence Registry, Risk Register,
Privacy Management, Incident Management, etc.) in what actually exists in
this repository today, so nothing gets duplicated and nothing gets invented.

**Labels:** `ALREADY IMPLEMENTED` · `PARTIALLY IMPLEMENTED` · `NEEDS ENGINEERING`
· `NEEDS BUSINESS INPUT` · `NEEDS LEGAL REVIEW` · `NEEDS INDEPENDENT ASSURANCE`
· `UNKNOWN`

Last generated: 2026-08-28, against commit `b15976b`. Findings below reuse the
verified facts in `docs/legal-commercial-readiness-audit.md` — see that file
for file-level citations on overlapping topics (auth, tenants, subprocessors,
retention, deletion, exports, public passport behavior, audit logging gaps).

---

## Foundations

| Area | Status | Notes |
|---|---|---|
| Authentication | `ALREADY IMPLEMENTED` | Firebase Auth + SPR API keys + HMAC webhook signing. |
| Authorization (RBAC) | `ALREADY IMPLEMENTED`, with a defect | `requireRole()` is a real exact allowlist. The role model itself has dead code (`Operator`/`Auditor` referenced in guards/enums but not a legal DB value) — `NEEDS ENGINEERING` to clean up before Access Governance (Phase 16) can honestly enumerate "roles." |
| Tenants | `ALREADY IMPLEMENTED`, with a caveat | Application-layer `tenant_id` scoping is universal; DB-level RLS is opt-in/not-default in the current config — `NEEDS LEGAL REVIEW` before claiming DB-enforced isolation as a control. |
| Clients | `ALREADY IMPLEMENTED` | `clients` table, MSP-to-client assignment. |
| Users/Roles | `ALREADY IMPLEMENTED` | See RBAC above. |
| Evidence | `ALREADY IMPLEMENTED` | `evidence_ledger` (canonical, provenance-rich: provider, control_id, source_url, verification_method, hash) plus the legacy `evidence_items` table still written by some routes. This is a strong foundation for Phase 6's Evidence Registry — it already has almost every field that phase asks for (source, collection date, related control, hash, status). Missing: an explicit confidence/expiration/review-date field and an explicit "evidence type" taxonomy (configuration/API result/scan/document/etc.) — `NEEDS ENGINEERING` to extend, not rebuild. |
| Findings | `ALREADY IMPLEMENTED` | `trust_findings` (fingerprint-deduped, PASS/FAIL/UNKNOWN-derived OPEN/RESOLVED/UNKNOWN status). Does not yet carry severity-to-business-impact text, an explicit owner/due-date, or the finding statuses the new spec wants (`MITIGATED`, `ACCEPTED_RISK`, `FALSE_POSITIVE`) — `NEEDS ENGINEERING` to extend the status enum and add owner/due-date columns, reusing the same table rather than creating a parallel one. |
| Remediation | `ALREADY IMPLEMENTED` | `trust_remediation_work_items` + `remediation_notes`, with a real evidence-verification step (`verifyRemediation`) that already enforces "resolution requires evidence, not just a note" — this is exactly Phase 10's requirement and already exists. |
| Reports | `ALREADY IMPLEMENTED` | 8 report types (`executive/technical/msp/customer/compliance/vendor/auditor/evidence-ledger`), plus the Plain-English layer (`src/trust/plain-english-report.ts`) that already implements most of Phase 26's "what was verified / what is unknown / what requires review" structure. `compliance` and `auditor` report types exist in the enum but are **not yet distinctly implemented** beyond sharing the same generator — `PARTIALLY IMPLEMENTED`. |
| Vendor Risk | `ALREADY IMPLEMENTED` | `vendors`/`vendor_audits`, reputation scoring, immutable audit ledger. Does not yet carry DPA status, subprocessor status, geographic-processing field, or renewal date — `NEEDS ENGINEERING` to extend for Phase 13, reusing this table. |
| Monitoring | `ALREADY IMPLEMENTED` | Scheduled collector framework, change detection, alerting. |
| Audit logs | `PARTIALLY IMPLEMENTED` | Real, tamper-evident, hash-chained (`audit_trail`). Only 14 call sites exist today; tenant offboarding, billing events, credential management, and API key/webhook management are **not currently audited** — `NEEDS ENGINEERING`, direct prerequisite for Phase 33. |
| Data retention | `NOT IMPLEMENTED` (confirmed absent) | No TTL/expiry logic anywhere. `NEEDS ENGINEERING` + `NEEDS BUSINESS INPUT` (actual retention periods are a business/legal decision, not an engineering one). |
| Data deletion | `ALREADY IMPLEMENTED`, incompletely | Real transactional full-tenant purge exists (`offboardTenantData`) but doesn't touch Firebase Auth accounts and isn't audited. `NEEDS ENGINEERING` to close both gaps before Phase 20 can be called done. |
| Exports | `PARTIALLY IMPLEMENTED` | Client-side CSV only, on already-loaded data, in 3 views. No authoritative server-side bulk export. `NEEDS ENGINEERING` for Phase 20's export requirement. |
| Questionnaires | `ALREADY IMPLEMENTED` | Trust Response module — evidence-matched draft answers, explicit `UNKNOWN` when no evidence supports an answer (this is exactly the anti-fabrication discipline Phase 31 asks for, already proven in a different module). |
| Legal pages | `NOT IMPLEMENTED` | No `/terms`, `/privacy`, `/legal` route exists at all. |
| Privacy functionality | `NOT IMPLEMENTED` | No personal-information inventory, purpose/retention/disposal tracking, or DSAR (access/correction request) tracking exists anywhere. This is entirely net-new (Phase 12). |
| Security functionality | `ALREADY IMPLEMENTED` | RLS (opt-in), RBAC, AES-256-GCM credential encryption, SSRF-guarded fetch, rate limiting — see audit doc for citations. |
| Configuration | `ALREADY IMPLEMENTED` | Single zod-validated `src/config.ts`; note `SPR_INTEGRATION_MASTER_KEY`/`SPR_CREDENTIAL_ENCRYPTION_KEY` are read ad hoc outside this schema (pre-existing, noted in a prior session pass, not fixed here). |
| Database/migrations | `ALREADY IMPLEMENTED` | 40 sequential SQL migrations, plain Postgres, no vendor extensions. |
| Background jobs | `ALREADY IMPLEMENTED` | Postgres-native `collector_jobs` queue (`FOR UPDATE SKIP LOCKED`), 4 supervised worker loops. |
| AI | `ALREADY IMPLEMENTED`, real subprocessor exposure | Gemini + OpenAI-via-Vercel-AI-Gateway both receive real evidence data. Anti-fabrication discipline already exists in some paths (questionnaire matcher's explicit `UNKNOWN` fallback) but has **not been audited across every AI call site** — `NEEDS ENGINEERING` (Phase 31 requires this explicitly). |
| External providers | `ALREADY IMPLEMENTED` (which ones) / `NEEDS BUSINESS INPUT` (their contractual terms) | See subprocessor list in the legal audit doc. |

---

## Net-new systems the 36-phase spec asks for (none of these exist today)

These are genuinely absent — not a gap in an existing system, a whole new
subsystem each:

| Phase | System | Status |
|---|---|---|
| 2 | Policy Registry (24 policy templates, versioned, approval workflow) | `NEEDS ENGINEERING` (content) + `NEEDS LEGAL REVIEW` (every policy's actual substance) |
| 3 | Control Library (control ID/objective/testing method/status) | `NEEDS ENGINEERING` |
| 4 | Compliance Framework Engine (NIST CSF, CIS, SOC 2, ISO 27001, PCI DSS, HIPAA) | `NEEDS ENGINEERING` (schema/UI) + `NEEDS INDEPENDENT ASSURANCE` (the frameworks' own requirement text must come from each framework's authoritative published source, not be reconstructed from memory — doing otherwise would itself violate this spec's own "never invent requirements" rule) |
| 5 | Requirement Registry with authoritative sourcing | `NEEDS ENGINEERING` + `NEEDS INDEPENDENT ASSURANCE` for sourcing |
| 7 | Evidence provenance "Why?" view | `NEEDS ENGINEERING` (data already exists in evidence_ledger; this is a new read-only UI over it) |
| 8 | Formal control-testing workflow (test ID/methodology/PASS-FAIL-PARTIAL) | `NEEDS ENGINEERING` |
| 11 | Enterprise Risk Register (likelihood/impact/residual risk/acceptance) | `NEEDS ENGINEERING` |
| 12 | Privacy Management System (PI inventory, DSAR tracking, PIA workflow) | `NEEDS ENGINEERING` + `NEEDS LEGAL REVIEW` |
| 14 | Incident & Breach Management workflow | `NEEDS ENGINEERING` — and note: no incident-response process exists in any form today, code or documented runbook (confirmed `NOT IMPLEMENTED` in the legal audit) |
| 15 | Business Continuity / Disaster Recovery records | `NEEDS ENGINEERING` + `NEEDS BUSINESS INPUT` (recovery objectives are a business decision) — and per the spec's own rule, RTO/RPO must never be claimed "achieved" without an actual test, which has never been run |
| 16 | Access Governance / periodic access reviews | `NEEDS ENGINEERING` |
| 17 | Security/privacy Training records | `NEEDS ENGINEERING` + `NEEDS BUSINESS INPUT` (there is no evidence any formal training program exists today to record) |
| 18 | Exception management | `NEEDS ENGINEERING` |
| 19 | Customer Evidence Request workflow | `NEEDS ENGINEERING` |
| 21–22 | Legal Document Registry + Acceptance tracking | `NEEDS ENGINEERING` (schema is straightforward; document substance is `NEEDS LEGAL REVIEW`) |
| 23 | Explicit Client authorization state machine | `NEEDS ENGINEERING` — today, creating a Client record implies nothing about authorization to process it; this is a real, meaningful gap the spec correctly identifies |
| 24 | Customer-facing Security Center | `NEEDS ENGINEERING` (content must be drawn only from verified facts in the audit doc above) |
| 25 | SPR's own internal self-assessment ("SPR Internal Passport") | `NEEDS ENGINEERING` — conceptually straightforward (SPR already has a self-passport, `passport_spr_self`, from earlier live-evidence-collection work this session) but extending it to governance/policy/risk tracking is net-new |
| 29 | Auditor/Reviewer navigation mode | `NEEDS ENGINEERING` (mostly a new read path over existing framework/control/evidence/finding data, once that data model exists) |
| 30 | Hard-coded certification-claim guardrails | `NEEDS ENGINEERING` — straightforward and high-value: a small set of string/UI checks preventing "SOC 2 certified" etc. from ever rendering without an explicit admin-recorded certification record |

---

## Assessment

The spec's own Phase 1 instruction is "reuse existing architecture wherever
possible" — and the honest finding is that **the evidence/findings/
remediation/reporting spine this Governance & Compliance System wants already
exists** (evidence_ledger, trust_findings, trust_remediation_work_items,
report generation, the plain-English translation layer). What's genuinely
missing is everything *above* that spine: policies, controls-as-a-catalog,
framework/requirement mapping, risk register, privacy management, incident
management, access governance, training, exceptions, and the legal/
commercial layer (legal docs, acceptance, client authorization, security
center, subprocessor register).

That remaining scope is, realistically, several distinct systems, each with
its own schema, RBAC, RLS, routes, UI, and test suite — comparable in size to
Vendor Risk or Trust Response individually. Building all 36 phases in one
uninterrupted pass, to the standard this spec itself demands (adversarially
tested, live-verified, zero fabrication), is not something that can be done
honestly in a single continuous implementation without either taking
shortcuts on testing/verification or taking materially longer than a normal
increment this session has shipped so far.
