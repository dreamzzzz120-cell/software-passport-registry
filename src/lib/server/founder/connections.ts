/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Founder Command Center — connection health checks.
// Each function returns a uniform status shape and NEVER throws: an
// unreachable or unconfigured platform is reported as data, not a 500.
// This is Owner+founder-allowlist-only visibility (see requireFounder in
// src/middleware/security.ts) — it never touches tenant/customer data itself.

import { config } from '../../../config.ts';

export type ConnectionStatus = {
  name: string;
  status: 'ok' | 'error' | 'not_configured';
  detail: string;
  lastChecked: string;
};

function now() {
  return new Date().toISOString();
}

// --- Railway ----------------------------------------------------------------
export async function checkRailway(): Promise<ConnectionStatus> {
  const token = config.railway.apiToken;
  const projectId = config.railway.projectId;
  if (!token || !projectId) {
    return { name: 'Railway', status: 'not_configured', detail: 'RAILWAY_API_TOKEN or RAILWAY_PROJECT_ID not set', lastChecked: now() };
  }
  try {
    const query = `query ($projectId: String!) { project(id: $projectId) { services { edges { node { id name } } } } }`;
    const res = await fetch('https://backboard.railway.app/graphql/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query, variables: { projectId } }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json: any = await res.json();
    const count = json?.data?.project?.services?.edges?.length ?? 0;
    return { name: 'Railway', status: 'ok', detail: `${count} services reachable`, lastChecked: now() };
  } catch (err: any) {
    return { name: 'Railway', status: 'error', detail: err?.message ?? 'unknown error', lastChecked: now() };
  }
}

// --- Vercel -------------------------------------------------------------------
export async function checkVercel(): Promise<ConnectionStatus> {
  const token = config.vercel.apiToken;
  const projectId = config.vercel.projectId;
  if (!token || !projectId) {
    return { name: 'Vercel', status: 'not_configured', detail: 'VERCEL_API_TOKEN or VERCEL_PROJECT_ID not set', lastChecked: now() };
  }
  try {
    const res = await fetch(`https://api.vercel.com/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json: any = await res.json();
    const latest = json?.deployments?.[0];
    return {
      name: 'Vercel',
      status: latest?.readyState === 'READY' ? 'ok' : 'error',
      detail: latest ? `latest deploy: ${latest.readyState}` : 'no deployments found',
      lastChecked: now(),
    };
  } catch (err: any) {
    return { name: 'Vercel', status: 'error', detail: err?.message ?? 'unknown error', lastChecked: now() };
  }
}

// --- GitHub Actions (CI) --------------------------------------------------------
export async function checkGithubCi(): Promise<ConnectionStatus> {
  const { token, owner, repo } = config.githubCi;
  if (!token || !owner || !repo) {
    return { name: 'GitHub CI', status: 'not_configured', detail: 'GITHUB_TOKEN/GITHUB_OWNER/GITHUB_REPO not set', lastChecked: now() };
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=1`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json: any = await res.json();
    const run = json?.workflow_runs?.[0];
    return {
      name: 'GitHub CI',
      status: run?.conclusion === 'success' ? 'ok' : run ? 'error' : 'not_configured',
      detail: run ? `latest run: ${run.conclusion ?? run.status} (${run.head_branch})` : 'no runs found',
      lastChecked: now(),
    };
  } catch (err: any) {
    return { name: 'GitHub CI', status: 'error', detail: err?.message ?? 'unknown error', lastChecked: now() };
  }
}

// --- Stripe ---------------------------------------------------------------
// Mirrors the lazy-client pattern already used in src/routes/billing.ts —
// throws BILLING_NOT_CONFIGURED if STRIPE_SECRET_KEY is unset, caught here.
export async function checkStripeAndMrr(): Promise<{ connection: ConnectionStatus; customerCount: number; mrrCents: number }> {
  if (!config.stripe.secretKey) {
    return {
      connection: { name: 'Stripe', status: 'not_configured', detail: 'STRIPE_SECRET_KEY not set', lastChecked: now() },
      customerCount: 0,
      mrrCents: 0,
    };
  }
  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(config.stripe.secretKey);
    const [customers, subs] = await Promise.all([
      stripe.customers.list({ limit: 100 }),
      stripe.subscriptions.list({ status: 'active', limit: 100 }),
    ]);
    const mrrCents = subs.data.reduce((sum, sub) => {
      const itemTotal = sub.items.data.reduce((s, item) => {
        const amount = item.price?.unit_amount ?? 0;
        const interval = item.price?.recurring?.interval;
        const qty = item.quantity ?? 1;
        const monthly = interval === 'year' ? amount / 12 : amount;
        return s + monthly * qty;
      }, 0);
      return sum + itemTotal;
    }, 0);
    return {
      connection: { name: 'Stripe', status: 'ok', detail: `${customers.data.length} customers, ${subs.data.length} active subs`, lastChecked: now() },
      customerCount: customers.data.length,
      mrrCents,
    };
  } catch (err: any) {
    return {
      connection: { name: 'Stripe', status: 'error', detail: err?.message ?? 'unknown error', lastChecked: now() },
      customerCount: 0,
      mrrCents: 0,
    };
  }
}

// --- Firebase ---------------------------------------------------------------
export async function checkFirebase(): Promise<ConnectionStatus> {
  try {
    const { adminAuth } = await import('../../firebase-admin.ts');
    await adminAuth.listUsers(1);
    return { name: 'Firebase', status: 'ok', detail: 'Admin SDK reachable', lastChecked: now() };
  } catch (err: any) {
    return { name: 'Firebase', status: 'error', detail: err?.message ?? 'unknown error', lastChecked: now() };
  }
}
