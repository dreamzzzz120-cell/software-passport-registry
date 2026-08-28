# SPR Legal & Commercial Readiness — Repository Audit

**Purpose:** Ground every legal document, Security Center claim, and subprocessor
entry SPR shows a real MSP customer in what the code actually does today — not
in what a typical SaaS "should" have. Every line below is either a direct
citation of a file/config in this repository, or is explicitly labeled
`UNKNOWN` / `NOT IMPLEMENTED`. Nothing here is a guess, an assumption about a
"typical" provider, or a claim of a certification/standard the repo does not
demonstrate.

**Labels used:**
- `VERIFIED` — directly confirmed by reading the running code/config.
- `IMPLEMENTED` — the code path exists and functions as described.
- `CONFIGURED` — depends on an environment variable/operator action; whether
  it's actually turned on in the live production environment is a deploy-time
  fact, not something this repo alone proves.
- `CUSTOMER-PROVIDED` — the real value depends entirely on business/legal
  information only the company can supply.
- `UNKNOWN` — genuinely not determinable from this repository.
- `NOT IMPLEMENTED` — searched for and confirmed absent.
- `REQUIRES LEGAL REVIEW` — an engineering fact that has legal consequences a
  non-lawyer must not resolve unilaterally.

Last generated: 2026-08-28, against commit `b15976b`.

---

## 1. Legal company/business entity name — `NOT IMPLEMENTED` / `CUSTOMER-PROVIDED`
No legal entity name (LLC, Inc., Ltd, Corp) appears anywhere in the repository.
There is no `LICENSE` file, no `author` field in `package.json`, and no
copyright notice anywhere in source. Every email address found in `src/` is
either a test fixture or fictional demo data in `PilotProgramView.tsx`. **Any
legal document referencing "the Company" must use a placeholder until the
actual registered entity name is supplied.**

## 2. Product name — `VERIFIED`, with an internal inconsistency
Confirmed as "Software Passport Registry" (`package.json`, `README.md`), short
form "SPR." `index.html`'s `<title>` and meta description separately say "SPR
Trust OS" — this name appears nowhere else in the codebase. Legal documents
should standardize on "Software Passport Registry (SPR)" and this
inconsistency should be resolved in the product itself, not papered over in
legal text.

## 3. Public website / production domains — `VERIFIED`
- Frontend: `https://software-passport-registry-vercel.vercel.app` (hardcoded
  in `src/config.ts`'s CORS allowlist).
- Backend: `https://spr-app-production-28f5.up.railway.app` (`vercel.json`
  rewrites).
- Preview deploys under `*-sprteam.vercel.app` are also trusted.
- These are **not** a custom/vanity domain — legal documents should not
  imply a stable branded domain exists unless one is purchased.

## 4. Terms/Privacy pages — `NOT IMPLEMENTED`
No `/terms`, `/privacy`, or `/legal` route or component exists anywhere in
the frontend. This is a genuine gap, not an oversight in this audit.

## 5. Authentication system — `VERIFIED`
Firebase Authentication (`src/lib/firebase-admin.ts`, `src/lib/firebase.ts`),
backed by Firebase project `spr4-c2c65`. Separately, SPR issues its own
API keys (`spr_live_...`, SHA-256 hashed at rest) for machine-to-machine
access (`src/routes/connect.ts`), and signs outbound webhooks with HMAC
(`src/security/webhook-signing.ts`).

## 6. Tenant model — `VERIFIED`, with a material caveat — `REQUIRES LEGAL REVIEW`
Every tenant-scoped table carries `tenant_id`, enforced at the application
layer on every query. **Database-level Row-Level Security is opt-in, not
default**: `.env.example` states plainly that leaving `APP_DATABASE_URL`/
`WORKER_DATABASE_URL` unset keeps the app running as the database owner role
(RLS bypassed), which is the current default. Any claim in a Security Center
or DPA that "the database enforces tenant isolation" must be qualified: it is
true only if the operator has provisioned the restricted runtime roles
(`migrations/0020_row_level_security.sql`) in the actual production database.
**This is a legal-accuracy risk if overstated** — verify current production
configuration before writing any such claim.

## 7. Client model — `VERIFIED`
`clients` table, MSP-to-client assignment via `client_assignments`
(`src/routes/msp.ts`).

## 8. Data categories stored — `VERIFIED`
Real table categories (from `migrations/*.sql`): identity/user records,
client records, software passports, evidence ledger, trust
findings/observations, monitoring configurations, vendor risk data and
audits, questionnaire records, remediation work items and notes, billing/
subscription records, integration credentials (encrypted), AI system
observations, login/session history, audit trail, and MSP pilot/sales
pipeline data. This list is the accurate basis for any "what data do you
store" question in a DPA or Privacy Policy — nothing here is inferred.

## 9. Database provider — `VERIFIED` (generic) / `UNKNOWN` (specific vendor guarantees)
Plain PostgreSQL, no vendor-specific extensions (`pgcrypto`, `uuid-ossp`, etc.
— confirmed absent via search). Runs on Railway's managed Postgres image.
Any claim about the underlying cloud region, physical location, or Railway's
own subprocessor relationships is `UNKNOWN` from this repo — that information
must come from Railway's own documentation/DPA, not be asserted by SPR.

## 10. Hosting providers — `VERIFIED`
Railway (API + worker, via `railway.toml` / `railway.worker.toml`) and Vercel
(frontend, via `vercel.json`). No file/blob storage provider (S3 or
equivalent) exists anywhere in the codebase — confirmed absent.

## 11. Subprocessors — `VERIFIED` (which ones) / `CUSTOMER-PROVIDED` (their own legal terms)
Real third-party services that receive tenant data at runtime, confirmed by
reading the actual call sites, not just `package.json`:
- **Google (Firebase Authentication)** — identity/auth data.
- **Google (Gemini, via `@google/genai`)** — receives real evidence content
  and findings for AI-generated passport summaries (`src/utils/scanner.ts`).
- **OpenAI, via Vercel AI Gateway** — receives real trust observations,
  findings, and evidence ledger rows (including source URLs and values) for
  AI-generated plain-English explanations (`src/routes/ai-trust.ts`).
- **Stripe** — billing (customer email, tenant ID, plan).
- **Sentry** — error/exception data and 10% of production traces, only when
  `SENTRY_DSN` is configured. The background worker does **not** send
  anything to Sentry.
- **Redis** — rate-limiting keys only (IP/credential hashes), not customer
  content; the specific hosting vendor is whatever `REDIS_URL` points to and
  is not determinable from this repo.
- No email or SMS provider exists in the codebase (`NOT IMPLEMENTED`).
- The 16 MSP/DevOps integrations (GitHub, ConnectWise, NinjaOne, etc.) only
  receive data the tenant explicitly configures credentials for — they are
  not blanket subprocessors of all customer data, and should be listed
  separately in the subprocessor register as "customer-directed" rather than
  "SPR's own."

## 12. AI providers — `VERIFIED` — `REQUIRES LEGAL REVIEW`
Two real, distinct paths send tenant evidence data to third-party AI models:
Gemini (passport summary generation) and OpenAI-via-Vercel-AI-Gateway
(plain-English explanation generation). Both are feature-gated on an API key
being present, but when enabled, **real evidence content, including source
URLs and raw values, is transmitted to these providers.** A DPA/Privacy
Policy must disclose this plainly; do not describe AI processing as
"on-device" or "private" — it is not.

## 13. Payment provider — `VERIFIED` (code) / `UNKNOWN` (production activation)
Stripe integration (`src/routes/billing.ts`) is real, functioning code —
Checkout, Billing Portal, and signature-verified webhooks are implemented,
not stubbed. Whether Stripe is actually turned on in the live production
environment depends on env var configuration this repo cannot itself confirm.

## 14. Logging/monitoring — `VERIFIED` / `CONFIGURED`
Sentry initializes only if `SENTRY_DSN` is set, captures errors and a 10%
trace sample in production. No explicit request-body capture code exists.
The worker process has no Sentry integration at all.

## 15. Backup configuration — `UNKNOWN`
Not present anywhere in this repository. Railway's backup policy for the
production database is a platform/dashboard setting outside version control.
**Any Security Center statement about backups must be sourced from actual
Railway account configuration, not asserted from this repo.**

## 16. Data retention behavior — `NOT IMPLEMENTED`
No TTL/expiry/auto-deletion logic exists for any tenant data category
(evidence, findings, audit log, login history, etc.). API keys and public
passport-verification tokens do expire, but that is credential expiry, not
data retention policy.

## 17. Deletion behavior — `IMPLEMENTED`, with two real gaps — `REQUIRES LEGAL REVIEW`
`POST /api/tenant/offboard` (Owner-only) performs a genuine, transactional,
full-tenant delete across every table with a `tenant_id` column
(`src/db/sync.ts`'s `offboardTenantData`). Two gaps found:
1. This deletion is **not** recorded in the tamper-evident audit trail.
2. It deletes Postgres rows only — it does **not** remove the corresponding
   Firebase Auth user account(s), so an identity record can outlive the
   "deleted" tenant's data. **Any Data Retention/Deletion policy document
   must describe this accurately, not claim complete account erasure.**

## 18. Export functionality — `IMPLEMENTED` (partial, client-side only)
CSV export exists in the Audit Log, Clients, and Reports views, but only
operates on data already loaded into the browser — there is no authoritative
server-side bulk export endpoint covering all of a tenant's/client's data
categories.

## 19. Integrations — `VERIFIED`
16 live, customer-configured integrations (GitHub, GitLab, Bitbucket, Azure
DevOps, Jira, Confluence, Slack, Microsoft 365, AWS, Azure, Google Cloud,
ConnectWise, Autotask, NinjaOne, Hudu) — see `src/integrations/catalog.ts`.

## 20. Security controls — `VERIFIED`
Row-level security (opt-in, see #6), role-based access control, AES-256-GCM
credential encryption at rest, SSRF-guarded outbound requests (DNS-pinned),
and Redis-backed rate limiting.

## 21. Role model — `VERIFIED` — internal inconsistency found, `NEEDS ENGINEERING`
The database's own CHECK constraint permits exactly five roles a real user
can hold: **Owner, Admin, Technician, Viewer, Client**. Two other role names
(`Operator`, `Auditor`) appear in validation code and route guards but **can
never actually be assigned to a real user** — they are dead/unreachable
conditions, not a real privilege tier. This should be cleaned up in the
product before it's described in any legal or Security Center document, to
avoid describing access controls that don't actually correspond to an
assignable role.

## 22. Report types — `VERIFIED`
`executive`, `technical`, `msp`, `customer`, `compliance`, `vendor`,
`auditor`, `evidence-ledger` (`src/routes/trust-loop.ts`'s `reportTypes`
enum). A `'sbom'` branch exists in report-extras code but is unreachable
dead code, since it's outside the enforced enum.

## 23. Public Passport behavior — `VERIFIED`
Signed, time-limited, unauthenticated public links expose: passport identity
fields, a derived status, evidence/finding counts and completeness
percentage, and **full finding rows including titles** (up to 50) and
evidence source metadata (provider, timestamp, verification method, hash) —
but not raw evidence values or subjects. Any Privacy Policy/Security Center
description of "what's public" must include finding titles, not just
aggregate counts.

## 24. API security — `VERIFIED`
HTTPS redirect enforcement in production, Helmet with an explicit CSP (no
wildcard script sources), an explicit CORS allowlist (no wildcard origin),
per-route rate limiting, and a request body size cap.

## 25. Audit logging — `VERIFIED` — real gap found, `NEEDS ENGINEERING`
Exactly 14 real call sites append to the tamper-evident audit trail today —
covering profile/branding/team changes and AI-system management. **Several
legally significant actions are not currently audited**: full tenant
offboarding/deletion, all Stripe billing events, integration credential
create/update/delete, and API key/webhook management. A Security Center page
claiming "all administrative actions are audited" would currently be
inaccurate.

## 26. Incident-response capabilities — `NOT IMPLEMENTED`
No runbook, status page, or human-alerting/paging mechanism exists in code.
Sentry logs to its own dashboard only; nothing pages, emails, or texts a
human on a critical error. Any Security Center "Incident Response" section
must describe the actual (manual, undocumented-in-code) process the company
follows today, or state plainly that a formal documented process does not
yet exist — not describe an automated capability that isn't there.

---

## Summary of items requiring action before any legal document ships

| Area | Status | Action needed |
|---|---|---|
| Legal entity name | `CUSTOMER-PROVIDED` | Business must supply the real registered name/address before any MSA/DPA/ToS can be finalized. |
| RLS default-off | `REQUIRES LEGAL REVIEW` | Confirm actual production DB role configuration before claiming DB-enforced tenant isolation. |
| AI subprocessors | `REQUIRES LEGAL REVIEW` | Must be disclosed plainly in Privacy Policy/DPA — real evidence data leaves SPR's infrastructure. |
| Deletion completeness | `REQUIRES LEGAL REVIEW` | Firebase Auth accounts and backups are not covered by today's "offboard" action — do not claim complete erasure. |
| Backups | `UNKNOWN` | Must be sourced from actual Railway configuration, not assumed. |
| Certifications | `NOT IMPLEMENTED` | No third-party certification exists anywhere in this repo or its configuration. Any Security Center page must state this explicitly rather than omit the topic. |
