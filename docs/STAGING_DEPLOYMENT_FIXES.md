# Staging deployment fixes: spr-app-staging / spr-worker-staging

This records two staging deployment failures and the exact Railway service
variable changes required to resolve them. Railway service variables are not
stored in this repository (and are intentionally hidden from automated
agents for security), so these changes must be applied directly in the
Railway dashboard for the `production` environment. This document exists so
the required values are not lost between the incident and the fix.

## Issue 1: spr-app-staging (deployment c61f7ff4) — pre-deploy failure

`npm run release` runs `scripts/migrate.ts` followed by
`scripts/provision-runtime-roles.ts` (see the `release` script in
`package.json` and the `preDeployCommand` in `railway.toml`).
`provision-runtime-roles.ts` requires `APP_DATABASE_URL` to be a real
`postgres://` or `postgresql://` connection string with a role password of
at least 16 characters (see `passwordFromUrl` in
`scripts/provision-runtime-roles.ts`). The variable was not a valid database
URL, so pre-deploy failed with:

```
APP_DATABASE_URL must be a valid database URL
```

**Required fix — set on the `spr-app-staging` service, `production`
environment:**

```
APP_DATABASE_URL=${{Postgres-Staging.DATABASE_URL}}
```

This binds `APP_DATABASE_URL` to the `DATABASE_URL` reference variable
exposed by the `Postgres-Staging` plugin/service, so it always resolves to a
valid Postgres connection string.

## Issue 2: spr-worker-staging (deployment 42002f61) — runtime validation error

`src/config.ts` validates `NODE_ENV` with
`z.enum(['development', 'production', 'test'])`. The worker crashed on
startup because `NODE_ENV` was set to a value outside that set, producing:

```
Invalid option: expected one of 'development'|'production'|'test'
```

**Required fix — set on the `spr-worker-staging` service, `production`
environment:**

```
NODE_ENV=production
```

## Applying these fixes

1. Open the Railway project dashboard.
2. Select the `spr-app-staging` service → Variables → set `APP_DATABASE_URL`
   to `${{Postgres-Staging.DATABASE_URL}}` in the `production` environment.
3. Select the `spr-worker-staging` service → Variables → set `NODE_ENV` to
   `production` in the `production` environment.
4. Redeploy both services.
