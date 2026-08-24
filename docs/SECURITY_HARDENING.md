# SPR Security Hardening Baseline

This document defines the production security baseline for SPR.

## Runtime

- Node.js 22.x only.
- Production runs the compiled server, never a development runner.
- Containers must run as non-root users.
- Secrets must come only from the deployment secret store/environment; never commit credentials.
- Health checks must expose only minimal operational status.

## HTTP security

- Helmet security headers enabled.
- CORS must use an explicit production allowlist; never `*` when credentials are enabled.
- Request bodies must be schema validated at trust boundaries.
- Rate limiting is required on authentication, public scanning, report creation, and other abuse-prone endpoints.
- Authentication failures must not reveal whether an account exists.
- Authorization must be enforced server-side for every protected resource; never trust client roles or IDs.
- Error responses must not expose stack traces, secrets, SQL, provider credentials, or internal filesystem paths.

## Data and database

- Database credentials are deployment secrets.
- Database access uses parameterized ORM/query APIs.
- Migrations run before production startup/deployment and must fail closed on migration errors.
- Sensitive records require ownership/tenant authorization before read, update, or delete.
- Public Passport tokens must be treated as bearer identifiers and must not expose private evidence.

## Supply chain

- Lockfile is committed and dependency versions are reviewed.
- Production dependency changes require tests and type checking.
- Known vulnerable packages must be patched or explicitly risk-accepted before release.

## CI release gates

Production release requires:

1. `npm run typecheck`
2. `npm test`
3. production build
4. database migration check
5. security/attack tests
6. successful container startup
7. successful `/health` check

A release is not considered production-ready when any gate is unknown or failing.
