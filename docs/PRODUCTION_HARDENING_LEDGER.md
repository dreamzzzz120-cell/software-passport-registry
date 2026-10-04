# SPR Master Production Hardening Ledger

Updated: 2026-10-04  
Canonical repository: `dreamzzzz120-cell/software-passport-registry`  
Production branch: `main`  
Production commit observed: `1f41058129c7598f5114cb39d496975aa57afaa4`

Status vocabulary:
- 🟢 PROVEN PASS — observed runtime/test evidence exists.
- 🔴 FAIL — observed failure exists.
- 🟡 UNPROVEN — not enough evidence yet.
- 🟠 BLOCKED — external dependency prevents proof.

| ID | AREA | REQUIREMENT | STATUS | TEST | RESULT | EVIDENCE | FIX | RETEST |
|---|---|---|---|---|---|---|---|---|
| SRC-001 | Source of truth | Canonical production repo/branch identified | 🟢 PROVEN PASS | Compare Railway/Vercel Git sources | Both point to `dreamzzzz120-cell/software-passport-registry:main` | Railway service source + Vercel linked project | n/a | n/a |
| DEP-001 | Frontend deployment | Current production commit deployed | 🟢 PROVEN PASS | Match Vercel production deployment SHA | Vercel production READY on `5c8c03d` | Vercel deployment metadata | n/a | n/a |
| DEP-002 | API deployment | Current production commit deployed and health-gated | 🟢 PROVEN PASS | Match Railway deployment SHA and healthcheck | `spr-app-production` SUCCESS; healthcheck path `/ready` | Railway deployment/config | n/a | n/a |
| DEP-003 | Worker deployment | Current production commit deployed and health-gated | 🟢 PROVEN PASS | Match Railway deployment SHA and healthcheck | `spr-worker-production` SUCCESS; healthcheck path `/health` | Railway deployment/config | n/a | n/a |
| DB-001 | Database | Production Postgres online and persistent | 🟢 PROVEN PASS | Inspect production environment | Postgres live; persistent volume mounted | Railway environment | n/a | n/a |
| CACHE-001 | Redis | Production Redis online and persistent | 🟢 PROVEN PASS | Inspect production environment | Redis live; password-protected start command; persistent volume mounted | Railway environment/config | n/a | n/a |
| DB-002 | Migrations | Production migration runner completes successfully | 🟢 PROVEN PASS | Inspect release logs | Migration result reported `"success": true` | Railway pre-deploy logs | n/a | n/a |
| DB-003 | Schema drift | Runtime schema fingerprint generated; no drift error observed | 🟢 PROVEN PASS | Inspect release logs | Fingerprint emitted for 173 objects; no `SCHEMA DRIFT` log | Railway pre-deploy logs | n/a | n/a |
| RLS-001 | Runtime role | API uses least-privileged runtime identity and RLS assertion passes | 🟢 PROVEN PASS | External `/ready` plus release-role provisioning | External probe observed `runtimeRole.role=spr_app_runtime`, `leastPrivilege=true`, `tenantRls.ok=true`, `database.ok=true` | Production Runtime Smoke run 2 + Railway release logs | n/a | External rerun passed |
| RLS-002 | Worker role | Worker runtime identity provisioned | 🟢 PROVEN PASS | Inspect worker release logs | `spr_worker_runtime` credentials synchronized | Railway worker logs | n/a | n/a |
| WORK-001 | Worker loops | Required worker loops start after deploy | 🟢 PROVEN PASS | Inspect runtime logs | OSV, distribution, security, intake, trust-monitoring, webhook, notifications, retention, report-schedules, registry crawler/lineage all started | Railway worker runtime logs | n/a | n/a |
| BUILD-001 | Build baseline | Typecheck, test, production build execute in production image build | 🟢 PROVEN PASS | Inspect Docker build step | `npm run typecheck && npm test && npm run build` completed in successful deployment | Railway build logs | n/a | n/a |
| SEC-001 | Security CI | Security route tests pass on production commit | 🟢 PROVEN PASS | GitHub workflow | Completed success | Security Route Tests run 928 | n/a | n/a |
| SEC-002 | Security CI | Security gate passes on production commit | 🟢 PROVEN PASS | GitHub workflow | Completed success | Security Gate run 2707 | n/a | n/a |
| OBS-001 | Observability | App distributed tracing enabled | 🟢 PROVEN PASS | Inspect/update Railway tracing state | tracing + auto-instrumentation enabled and active | Railway tracing state | Enabled tracing + OBI | Confirmed active |
| OBS-002 | Observability | Worker distributed tracing enabled | 🟢 PROVEN PASS | Inspect/update Railway tracing state | tracing + auto-instrumentation enabled and active | Railway tracing state | Enabled tracing + OBI | Confirmed active |
| STORE-001 | Artifact storage | Artifact/intake storage configuration present | 🟢 PROVEN PASS | Inspect production variable names | Supabase URL, intake/artifact buckets and artifact broker variables present on app/worker | Railway service configuration | n/a | Runtime upload proof still separate |
| SCAN-001 | Repository scanner | Scanner toolchain present in production image | 🟢 PROVEN PASS | Inspect image build | Syft 1.49.0 installed and version-checked; git/unzip/tar available | Railway build logs | n/a | n/a |
| SCAN-002 | Real repository scan | Successful public-repo scan through current production commit | 🟡 UNPROVEN | Execute live public repo scan and verify persisted evidence | Not re-proven during this hardening run | — | — | REQUIRED |
| UPLOAD-001 | Upload pipeline | Real upload → quarantine → scan → persist path | 🟡 UNPROVEN | Adversarial runtime upload tests | Not yet executed in this hardening run | — | — | REQUIRED |
| AUTH-001 | Authentication | Anonymous and malformed bearer requests rejected on protected API | 🟢 PROVEN PASS | External GitHub runner called `/api/vendors` anonymously and with malformed bearer | Both rejected with 401/403; anonymous POST also rejected | Production Runtime Smoke run 2 | n/a | External rerun passed |
| AUTH-002 | Authentication | Expiry/revocation/disabled-user/session matrix | 🟡 UNPROVEN | Direct production-safe tests with controlled identities | Not yet executed | — | — | REQUIRED |
| AUTHZ-001 | Authorization | Role × action / IDOR/BOLA matrix | 🟡 UNPROVEN | Direct API attacks across roles | Not yet executed | — | — | REQUIRED |
| TENANT-001 | Tenant isolation | Cross-tenant read/update/delete/forged-insert at the RLS boundary | 🟢 PROVEN PASS | Real Postgres security suite with Tenant A/B and `spr_app_runtime` | Tenant A row invisible to Tenant B; cross-tenant UPDATE/DELETE affect zero rows; forged INSERT rejected by RLS | `tests/security/rls-tenant-isolation.test.ts` in release/security CI | n/a | Required workflows passed before ledger merge |
| TENANT-002 | Tenant isolation | Pooled connection tenant context does not leak | 🟢 PROVEN PASS | Single-connection pool reuses physical connection across tenant transactions | transaction-local `app.tenant_id` cleared after COMMIT/ROLLBACK; Tenant B receives its own context | `tests/security/rls-tenant-isolation.test.ts` | n/a | Required workflows passed |
| TENANT-003 | Tenant isolation | Full production route-level cross-tenant IDOR/BOLA using two real tenant identities | 🟠 BLOCKED | Production-safe two-tenant API attack | No disposable second production tenant identity is available; creating fake production customers would violate the no-fake-data rule | External dependency: controlled disposable production tenant/users or approved staging environment with production-equivalent config | Complete DB/RLS and anonymous API attacks remain proven | Resume with cross-tenant route matrix once controlled identities exist |
| RATE-001 | Rate limiting | External production IP limit returns 429 with retry/policy headers | 🟡 UNPROVEN | Controlled anonymous burst from external GitHub runner | Test added; awaiting workflow result | Production Runtime Smoke | Added bounded 110-request probe against protected route | REQUIRED |
| RATE-002 | Rate limiting | Distributed/multi-instance/credential-rotation bypass resistance | 🟡 UNPROVEN | Multi-source concurrent abuse test | Single production replica currently observed; distributed bypass not yet proven | — | — | REQUIRED when scaled beyond one replica |
| BILL-001 | Billing | Checkout/webhook/idempotency/entitlement end-to-end | 🟡 UNPROVEN | Real Stripe test/production-safe flow | Not executed in this hardening pass | — | — | REQUIRED if billing is launch-critical |
| WEBHOOK-001 | Webhooks | Signature/replay/idempotency/crash recovery | 🟡 UNPROVEN | Adversarial webhook suite | Worker webhook loop starts, but behavior not runtime-proven here | — | — | REQUIRED |
| CONC-001 | Concurrency | Critical race conditions tested | 🟡 UNPROVEN | Concurrent signup/evidence/billing/job tests | Not yet executed | — | — | REQUIRED |
| FAIL-001 | Failure injection | DB/Redis/scanner/storage/provider failure safe | 🟡 UNPROVEN | Controlled dependency failure tests | Not yet executed | — | — | REQUIRED |
| BACKUP-001 | Disaster recovery | Backup restore actually exercised | 🟡 UNPROVEN | Restore into isolated target and verify data/schema | No restore exercise observed | — | — | REQUIRED |
| PERF-001 | Performance | Defined thresholds with p50/p95/p99 proof | 🟡 UNPROVEN | Production-like load test | No current measured acceptance run | — | — | REQUIRED |
| UI-001 | Frontend/backend consistency | New authenticated SPA route resolves to production shell | 🟢 PROVEN PASS | External fetch of `/vendor-evidence-exchange` | HTTP 200 HTML shell returned | Production Runtime Smoke run 2 | n/a | Passed |
| UI-002 | Frontend/backend consistency | Full authenticated browser interaction/button/form/error-state review | 🟡 UNPROVEN | Browser interaction suite | Route shell proven, interactive behavior not fully exercised | — | — | REQUIRED |
| PUBLIC-001 | Public surface | Public frontend reachable externally | 🟢 PROVEN PASS | External GitHub runner fetched `https://softwarepassportregistry.com/` | HTTP 200 with non-empty HTML | Production Runtime Smoke run 2 | n/a | Passed |
| PUBLIC-002 | Public surface | Baseline API security headers and hostile-origin CORS behavior | 🟢 PROVEN PASS | External GitHub runner inspected `/health` headers and hostile Origin response | CSP present, X-Content-Type-Options nosniff, X-Frame-Options DENY, hostile origin not reflected | Production Runtime Smoke run 2 | n/a | Passed |
| PUBLIC-003 | Public surface | Full DNS/TLS/HSTS/cache/source-map/debug exposure review | 🟡 UNPROVEN | Dedicated TLS/header/exposure audit | Only baseline HTTP security/header behavior proven so far | — | — | REQUIRED |
| SECRET-001 | Secrets | No secret leakage in repo/image/bundles/logs/history | 🟡 UNPROVEN | Secret scan repo/history/build artifacts/logs | Image build rejects common secret-file patterns, but full history/bundle scan not rerun | — | — | REQUIRED |
| DR-001 | Rollback | Failed production deployment rollback exercised | 🟡 UNPROVEN | Controlled rollback exercise | Railway reports rollback-capable deployments; actual rollback not exercised | — | — | REQUIRED |
| M2M-001 | M2M authority | Envelope/replay/receipt/authority boundary | 🟡 UNPROVEN | Full governed-execution adversarial suite | Not executed for SPR production in this pass | — | — | REQUIRED only for SPR M2M launch scope |

## Current classification

### NOT PRODUCTION READY

Reason: several release-critical requirements remain unproven under the Master Production Hardening Directive, including full authentication session/revocation behavior, production route-level authorization/IDOR attacks with controlled identities, upload/scanner adversarial proof, backup restore, concurrency/failure injection, performance thresholds, and full browser interaction consistency.

This classification is intentionally stricter than “deployed and healthy.” A healthy deployment is evidence for deployment/health gates only; it does not prove every production-security property.
