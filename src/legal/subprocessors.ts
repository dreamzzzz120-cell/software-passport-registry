/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The third parties that process data on SPR's behalf. This one list feeds
 * the public /subprocessors/ page, the Data Processing Agreement annex and
 * the retention page, so the three can never disagree.
 *
 * Every entry is a provider the running system actually calls. `optional`
 * providers are only engaged when the corresponding credential is set on the
 * deployment; /api/public/subprocessors reports live which of those are
 * configured right now, and the page shows that rather than assuming.
 */

export interface Subprocessor {
  id: string;
  name: string;
  legalEntity: string;
  purpose: string;
  dataProcessed: string;
  location: string;
  /** true when the provider is only used if a credential is configured. */
  optional?: boolean;
  /** Environment variable that enables the provider (optional providers only). */
  enabledBy?: string;
}

export const SUBPROCESSORS: Subprocessor[] = [
  {
    id: 'vercel',
    name: 'Vercel',
    legalEntity: 'Vercel Inc.',
    purpose: 'Hosting and content delivery for the web application; routes API requests to the application server.',
    dataProcessed: 'Request metadata (IP address, user agent, requested URL) and the static application bundle. No customer evidence is stored at Vercel.',
    location: 'Global edge network; United States (headquarters).',
  },
  {
    id: 'railway',
    name: 'Railway',
    legalEntity: 'Railway Corp.',
    purpose: 'Runs the API server, the background scan worker, the PostgreSQL database and the Redis instance used for rate limiting.',
    dataProcessed: 'All workspace data: accounts, clients, passports, evidence, findings, scan artefacts, audit trail, notification queue.',
    location: 'United States (us-west2 region).',
  },
  {
    id: 'firebase',
    name: 'Firebase Authentication',
    legalEntity: 'Google LLC',
    purpose: 'Identity provider: email/password and Google sign-in, session tokens, multi-factor enrolment.',
    dataProcessed: 'Email address, password hash (held by Google, never by SPR), sign-in timestamps, MFA factors.',
    location: 'United States.',
  },
  {
    id: 'supabase',
    name: 'Supabase Storage',
    legalEntity: 'Supabase Inc.',
    purpose: 'Object storage for files uploaded through Universal Intake (documents, SBOMs, attestations).',
    dataProcessed: 'Uploaded intake files and their metadata.',
    location: 'Region selected for the SPR storage project (see the Supabase project settings).',
  },
  {
    id: 'stripe',
    name: 'Stripe',
    legalEntity: 'Stripe, Inc.',
    purpose: 'Subscription billing, one-time purchases, invoices and the customer billing portal.',
    dataProcessed: 'Billing contact, payment method (held by Stripe, never by SPR), invoices, subscription status.',
    location: 'United States.',
  },
  {
    id: 'resend',
    name: 'Resend',
    legalEntity: 'Resend, Inc.',
    purpose: 'Transactional email: verification and password-reset links, invitations, alerts, scheduled reports, contact-form forwarding.',
    dataProcessed: 'Recipient address, subject and message body of each email SPR sends.',
    location: 'United States.',
  },
  {
    id: 'sentry',
    name: 'Sentry',
    legalEntity: 'Functional Software, Inc.',
    purpose: 'Error monitoring for the API server and worker.',
    dataProcessed: 'Stack traces, request identifiers and error messages. Evidence bodies and credentials are not sent.',
    location: 'United States.',
    optional: true,
    enabledBy: 'SENTRY_DSN',
  },
  {
    id: 'github',
    name: 'GitHub',
    legalEntity: 'GitHub, Inc. (Microsoft)',
    purpose: 'Acquires repository contents for scanning (public repositories for Free Review; connected repositories for customers).',
    dataProcessed: 'Repository identifiers requested; access tokens supplied by the customer for private repositories are used to read, never stored in plain text.',
    location: 'United States.',
  },
  {
    id: 'osv',
    name: 'OSV.dev',
    legalEntity: 'Open Source Security Foundation / Google LLC',
    purpose: 'Vulnerability database queried for every SBOM component.',
    dataProcessed: 'Package ecosystem, name and version of scanned components. No customer identity is included in queries.',
    location: 'United States.',
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    legalEntity: 'Anthropic, PBC',
    purpose: 'AI evidence reasoning: executive summaries, Trust Council review and evidence Q&A. Output is validated against the supplied evidence before it is shown.',
    dataProcessed: 'A read-only snapshot of the passport evidence and findings being explained. Not used for model training under Anthropic\'s API terms.',
    location: 'United States.',
    optional: true,
    enabledBy: 'ANTHROPIC_API_KEY',
  },
  {
    id: 'gemini',
    name: 'Google Gemini API',
    legalEntity: 'Google LLC',
    purpose: 'Fallback AI evidence reasoning when Anthropic is not configured.',
    dataProcessed: 'A read-only snapshot of the passport evidence and findings being explained.',
    location: 'United States.',
    optional: true,
    enabledBy: 'GEMINI_API_KEY',
  },
];

export const SUBPROCESSORS_LAST_UPDATED = '2026-09-13';
