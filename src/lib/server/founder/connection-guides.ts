/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Founder Command Center — what each platform connection is, what its observed
// status means, which settings it needs and where they are configured.
//
// Everything here is descriptive. The only live facts are the `set` flags,
// which report whether a variable is present on THIS process (names only,
// never values), and the status/detail produced by the health probes in
// connections.ts. Nothing in a guide may claim a connection works.

import { config } from '../../../config.ts';

export type ConnectionKey = 'railway' | 'vercel' | 'github_ci' | 'stripe' | 'supabase_auth';

export type ConnectionSetting = {
  name: string;
  secret: boolean;
  set: boolean;
  purpose: string;
  whereToGet: string;
};

export type ConnectionGuide = {
  key: ConnectionKey;
  name: string;
  purpose: string;
  probe: string;
  statusMeaning: Record<'ok' | 'error' | 'not_configured', string>;
  configuredAt: string;
  steps: string[];
  settings: ConnectionSetting[];
};

// Railway injects RAILWAY_PROJECT_ID into every service, so a Railway-hosted
// deployment always has it; only the token has to be provided by a person.
const RAILWAY_SERVICE = 'Railway → project "software-passport-registry" → environment "production" → service "spr-app-staging" → Variables';

function present(value: string | undefined): boolean { return typeof value === 'string' && value.trim().length > 0; }

export function connectionGuides(): Record<ConnectionKey, ConnectionGuide> {
  return {
    railway: {
      key: 'railway',
      name: 'Railway',
      purpose: 'Railway hosts the SPR API server, the scan worker, Postgres and Redis. This connection lets the Founder page read the Railway project (services, deployments) so platform health can be shown here instead of in the Railway dashboard.',
      probe: 'A GraphQL query to backboard.railway.app asking for the services of RAILWAY_PROJECT_ID, authenticated with RAILWAY_API_TOKEN. Nothing is written.',
      statusMeaning: {
        ok: 'Railway answered the query and listed the project\'s services.',
        error: 'Both settings are present but Railway rejected or failed the query. HTTP 401/403 means the token is invalid, expired, or not allowed to see this project; a timeout means Railway did not answer within 8 seconds.',
        not_configured: 'RAILWAY_PROJECT_ID is unavailable, so the API cannot prove which Railway project it is running in. When the injected project identity exists, SPR reports Railway as runtime-verified even if the optional management API token is absent.',
      },
      configuredAt: RAILWAY_SERVICE,
      steps: [
        'Open railway.com, click your avatar (top right) → Account Settings → Tokens → Create Token. Give it a name such as "spr-founder-page". If Railway asks for a scope, choose the workspace that owns software-passport-registry. Copy the token once; Railway will not show it again.',
        `Go to ${RAILWAY_SERVICE} and add RAILWAY_API_TOKEN with that value.`,
        'RAILWAY_PROJECT_ID is injected by Railway automatically and is sufficient to prove the running SPR service is on Railway.',
        'RAILWAY_API_TOKEN is optional deeper telemetry. Without it the Founder page reports runtime verification; with it, Refresh also lists the Railway project services.',
      ],
      settings: [
        { name: 'RAILWAY_API_TOKEN', secret: true, set: present(config.railway.apiToken), purpose: 'Authenticates the Founder page to the Railway API (read).', whereToGet: 'railway.com → avatar → Account Settings → Tokens → Create Token' },
        { name: 'RAILWAY_PROJECT_ID', secret: false, set: present(config.railway.projectId), purpose: 'Identifies the SPR project to query.', whereToGet: 'Injected by Railway on every service; also shown at Railway → project → Settings → General.' },
      ],
    },
    vercel: {
      key: 'vercel',
      name: 'Vercel',
      purpose: 'Vercel serves the SPR web app (softwarepassportregistry.com) and rewrites /api to Railway. This connection lets the Founder page see whether the latest production deployment is READY.',
      probe: 'GET https://api.vercel.com/v6/deployments for VERCEL_PROJECT_ID (with VERCEL_TEAM_ID, because the project belongs to a team) authenticated with VERCEL_API_TOKEN, limit 1. Nothing is written.',
      statusMeaning: {
        ok: 'Vercel answered and the newest production deployment is READY.',
        error: 'Vercel answered but the newest deployment is not READY (building, errored, cancelled), or Vercel rejected the request. HTTP 403/404 usually means the token cannot see the team, or VERCEL_TEAM_ID is missing.',
        not_configured: 'VERCEL_PROJECT_ID is missing, or neither VERCEL_API_TOKEN nor VERCEL_PUBLIC_URL is available for a live verification check.',
      },
      configuredAt: RAILWAY_SERVICE,
      steps: [
        'Open vercel.com, click your avatar → Account Settings → Tokens → Create. Name it "spr-founder-page", scope it to the team "sprteam", choose an expiry you are comfortable with, and copy the token once.',
        `Go to ${RAILWAY_SERVICE} and add VERCEL_API_TOKEN with that value if you want management-API deployment telemetry.`,
        'VERCEL_PROJECT_ID and VERCEL_TEAM_ID identify the Vercel project. VERCEL_PUBLIC_URL provides a safe reachability fallback when no management token is configured.',
        'After redeploy, Refresh here. With a token the card reports the latest deployment state; without one it reports whether the production Vercel deployment is publicly reachable.',
      ],
      settings: [
        { name: 'VERCEL_API_TOKEN', secret: true, set: present(config.vercel.apiToken), purpose: 'Authenticates the Founder page to the Vercel API (read).', whereToGet: 'vercel.com → avatar → Account Settings → Tokens → Create (scope: team sprteam)' },
        { name: 'VERCEL_PROJECT_ID', secret: false, set: present(config.vercel.projectId), purpose: 'The Vercel project to inspect.', whereToGet: 'Vercel → project software-passport-registry-vercel → Settings → General → Project ID' },
        { name: 'VERCEL_TEAM_ID', secret: false, set: present(config.vercel.teamId), purpose: 'The team that owns the project; required for management API telemetry.', whereToGet: 'Vercel → team sprteam → Settings → General → Team ID' },
        { name: 'VERCEL_PUBLIC_URL', secret: false, set: present(config.vercel.publicUrl), purpose: 'Public production URL used to prove the frontend is reachable when no Vercel API token is configured.', whereToGet: 'A production alias such as https://softwarepassportregistry.com or the project vercel.app URL.' },
      ],
    },
    github_ci: {
      key: 'github_ci',
      name: 'GitHub CI',
      purpose: 'GitHub Actions runs SPR\'s test, security and hardening gates on every push and pull request. This connection shows the conclusion of the most recent workflow run so a red CI is visible here.',
      probe: 'GET https://api.github.com/repos/GITHUB_OWNER/GITHUB_REPO/actions/runs?per_page=1 authenticated with GITHUB_TOKEN. Nothing is written.',
      statusMeaning: {
        ok: 'The most recent workflow run concluded "success".',
        error: 'Either the most recent run did not succeed (failure, cancelled, startup_failure — for example when GitHub Actions is blocked by a billing problem), or GitHub rejected the request (HTTP 401/403: token invalid or lacking Actions read access to the repository).',
        not_configured: 'GITHUB_OWNER and/or GITHUB_REPO is not set, or the repository has no workflow runs. Public repositories are checked without a token; GITHUB_TOKEN is optional for higher rate limits or private repositories.',
      },
      configuredAt: RAILWAY_SERVICE,
      steps: [
        'GITHUB_OWNER (dreamzzzz120-cell) and GITHUB_REPO (software-passport-registry) are already set on the service.',
        'Because software-passport-registry is public, the Founder page can read its latest Actions run without GITHUB_TOKEN. A token is optional for higher API rate limits or if the repository later becomes private.',
        'If the status is "error" with "latest run: failure/startup_failure", CI itself is failing — open github.com → repository → Actions and read the newest run. A run that "was not started because recent account payments have failed" is fixed at github.com → Settings → Billing and plans.',
      ],
      settings: [
        { name: 'GITHUB_TOKEN', secret: true, set: present(config.githubCi.token), purpose: 'Authenticates to the GitHub API (read Actions runs).', whereToGet: 'github.com → Settings → Developer settings → Personal access tokens (fine-grained), repository software-passport-registry, Actions: Read-only' },
        { name: 'GITHUB_OWNER', secret: false, set: present(config.githubCi.owner), purpose: 'Repository owner.', whereToGet: 'The GitHub account or organisation name: dreamzzzz120-cell' },
        { name: 'GITHUB_REPO', secret: false, set: present(config.githubCi.repo), purpose: 'Repository name.', whereToGet: 'software-passport-registry' },
      ],
    },
    stripe: {
      key: 'stripe',
      name: 'Stripe',
      purpose: 'Stripe holds SPR\'s customers, prices and subscriptions and is the only source for MRR. This connection counts customers and active subscriptions and computes MRR from live subscription items.',
      probe: 'Lists all customers and all active subscriptions with STRIPE_SECRET_KEY (paged, so counts are exact). Nothing is written.',
      statusMeaning: {
        ok: 'Stripe answered; the customer and active-subscription counts shown are exact totals from the live account.',
        error: 'STRIPE_SECRET_KEY is present but Stripe rejected it or did not answer within 8 seconds. MRR and counts are then shown as "Not verified", never as zero.',
        not_configured: 'STRIPE_SECRET_KEY is not set on the API service, so billing cannot be read.',
      },
      configuredAt: RAILWAY_SERVICE,
      steps: [
        'Open dashboard.stripe.com → Developers → API keys. Use the live-mode secret key (starts with sk_live_) for production.',
        `Set it as STRIPE_SECRET_KEY at ${RAILWAY_SERVICE}.`,
        'For payments to be recorded, Developers → Webhooks must have an endpoint pointing at the API\'s Stripe webhook route; its signing secret (whsec_…) goes in STRIPE_WEBHOOK_SECRET on the same service.',
      ],
      settings: [
        { name: 'STRIPE_SECRET_KEY', secret: true, set: present(config.stripe.secretKey), purpose: 'Reads customers, subscriptions and prices; creates checkout sessions.', whereToGet: 'dashboard.stripe.com → Developers → API keys → Secret key (live mode)' },
        { name: 'STRIPE_WEBHOOK_SECRET', secret: true, set: present(config.stripe.webhookSecret), purpose: 'Verifies that webhook events really come from Stripe.', whereToGet: 'dashboard.stripe.com → Developers → Webhooks → your endpoint → Signing secret' },
      ],
    },
    supabase_auth: {
      key: 'supabase_auth',
      name: 'Supabase Auth',
      purpose: 'Supabase Auth is SPR\'s identity provider: sign-up, sign-in, password reset and email confirmation. The API verifies user access tokens with the publishable key and performs admin operations (list users, ban, reset links) with the service-role key.',
      probe: 'Calls auth.admin.listUsers(1) against SUPABASE_URL with SUPABASE_SERVICE_ROLE_KEY. Nothing is written.',
      statusMeaning: {
        ok: 'The Supabase auth admin API answered with the service-role key.',
        error: 'The key or URL is present but Supabase rejected the call or did not answer within 8 seconds.',
        not_configured: 'SUPABASE_URL is not set on the API service. Normal customer authentication can be verified from the public Auth health endpoint; the service-role/secret key is optional founder admin telemetry.',
      },
      configuredAt: RAILWAY_SERVICE,
      steps: [
        'Open supabase.com/dashboard → project gezmtnleoyrudxztegoj → Project Settings → API keys. SUPABASE_URL is the Project URL and the publishable key is under "Publishable keys". Those two are enough for normal customer authentication.',
        `Set the optional service-role/secret key at ${RAILWAY_SERVICE} only if founder-only admin-user telemetry is needed. It must never be placed in Vercel or in the browser bundle.`,
        'Sign-up email delivery is a separate Supabase setting: Authentication → Emails → SMTP Settings. Without a custom SMTP server Supabase only delivers auth emails to addresses on the project\'s own team and only a few per hour, so real customers cannot complete sign-up.',
      ],
      settings: [
        { name: 'SUPABASE_URL', secret: false, set: present(process.env.SUPABASE_URL), purpose: 'The Supabase project URL.', whereToGet: 'Supabase → Project Settings → API keys → Project URL' },
        { name: 'SUPABASE_SERVICE_ROLE_KEY', secret: true, set: present(process.env.SUPABASE_SERVICE_ROLE_KEY) || present(process.env.SUPABASE_SECRET_KEY), purpose: 'Admin operations on users (server only). SUPABASE_SECRET_KEY (new-style sb_secret_ key) is accepted instead.', whereToGet: 'Supabase → Project Settings → API keys → Secret keys' },
        { name: 'SUPABASE_PUBLISHABLE_KEY', secret: false, set: present(process.env.SUPABASE_PUBLISHABLE_KEY) || present(process.env.SUPABASE_ANON_KEY), purpose: 'Verifies user access tokens on API requests.', whereToGet: 'Supabase → Project Settings → API keys → Publishable keys' },
      ],
    },
  };
}
