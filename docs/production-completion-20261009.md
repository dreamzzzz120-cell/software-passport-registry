# SPR customer-flow completion, 2026-10-09

## Integrated release
Combines report explanations and evidence-gap plans (#1109), founder page-view accuracy (#1091), Free Review PDF unknown values (#1093), universal intake mounting (#1087), signup-intent tracking (#1104), and workspace analytics coverage (#1094). Main already contains header-based status polling (#1106). Adds redirect rejection to prevent forwarding signed status headers and no-store/no-referrer headers on all Free Review scan responses. Vercel analytics suppresses credential-bearing result-page events.

No migrations. No new external outreach, billing transaction or entitlement changes. No automatic trust, compliance or safety conclusions.

## Evidence observed this session
- Actual production Railway project: 91a6cee9-ad96-4f12-98d3-9c963849cb24, production environment 8d15156c-5b1f-49d9-ae94-71db15051777. The older project has no services.
- API /ready returned ready with database, tenant RLS and least-privilege spr_app_runtime checks passing.
- Five production service deployments were SUCCESS at initial inspection. A subsequent main release was BUILDING; a queued deployment is not a completed deployment.
- Worker logs recorded 359 completed repository scans and healthy database, queue, scan terminality and registry freshness checks. These counts do not represent unique customers.
- A browser verification scan of expressjs/express completed. Observed commit cf6722bf89a86905281d9160b6482e08166b5ef0, 58 SBOM components, 15 evidence items, one elevated finding, and three unobserved trust areas. This session is a test, not an acquired user.
- API variable names include artifact broker URL/token and Stripe settings; names alone do not prove working storage or payments.
- Typecheck, production build and 81 targeted tests passed. Broader local suite: 2110 passed, 29 skipped before the final HTTP security test was added. Local default runtime was Node 24; Node 22 checks recorded separately in the PR.

## Remaining acceptance gates
- Observe CI and deployment on the final integrated head; repeat production readiness and browser acceptance.
- Free Review polls must be POST to a token-free endpoint; HTTP proxy paths must contain no status credential. Legacy GET compatibility remains, so retirement is a follow-up gate. Public result links still contain short-lived signed credentials by design.
- Verify one authorized tenant report and its actual PDF visually, including selected snapshot, null score, unknown coverage, limitations, source references, pagination and glossary.
- Reconcile an identified browser test event with the production ingestion database and founder response. Anonymous sessions are not human users.
- Prove configured upload broker, scanner, evidence creation and tenant isolation in production; router reachability alone is insufficient.
- Outside paid customers, human totals, pilot onboarding and measured time savings remain UNKNOWN unless recorded production evidence is retrieved. Do not count the owner's coupon purchase.
