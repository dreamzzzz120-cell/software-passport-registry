/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Founder Command Center — connection health checks.
// Never return secrets or upstream error bodies. External checks are bounded
// by a timeout so one provider cannot hold the Founder page open indefinitely.

import { config } from '../../../config.ts';
import type { ConnectionKey } from './connection-guides.ts';

export type ConnectionStatus = {
  key: ConnectionKey;
  name: string;
  status: 'ok' | 'error' | 'not_configured';
  detail: string;
  lastChecked: string;
};

const CHECK_TIMEOUT_MS = 8_000;

function now() { return new Date().toISOString(); }

function safeErrorDetail(err: unknown): string {
  if (err instanceof DOMException && err.name === 'AbortError') return 'health check timed out';
  if (err instanceof Error && err.name === 'AbortError') return 'health check timed out';
  return 'health check failed';
}

async function fetchWithTimeout(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// --- Railway ----------------------------------------------------------------
export async function checkRailway(): Promise<ConnectionStatus> {
  const token = config.railway.apiToken;
  const projectId = config.railway.projectId;
  if (!token || !projectId) return { key: 'railway', name: 'Railway', status: 'not_configured', detail: 'Railway connection is not configured', lastChecked: now() };
  try {
    const query = `query ($projectId: String!) { project(id: $projectId) { services { edges { node { id name } } } } }`;
    const res = await fetchWithTimeout('https://backboard.railway.app/graphql/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query, variables: { projectId } }),
    });
    if (!res.ok) return { key: 'railway', name: 'Railway', status: 'error', detail: `provider returned HTTP ${res.status}`, lastChecked: now() };
    const json: any = await res.json();
    if (json?.errors?.length || !json?.data?.project) return { key: 'railway', name: 'Railway', status: 'error', detail: 'provider health check was unsuccessful', lastChecked: now() };
    const count = Array.isArray(json.data.project.services?.edges) ? json.data.project.services.edges.length : 0;
    return { key: 'railway', name: 'Railway', status: 'ok', detail: `${count} services reachable`, lastChecked: now() };
  } catch (err) {
    return { key: 'railway', name: 'Railway', status: 'error', detail: safeErrorDetail(err), lastChecked: now() };
  }
}

// --- Vercel -------------------------------------------------------------------
export async function checkVercel(): Promise<ConnectionStatus> {
  const token = config.vercel.apiToken;
  const projectId = config.vercel.projectId;
  if (!token || !projectId) return { key: 'vercel', name: 'Vercel', status: 'not_configured', detail: 'Vercel connection is not configured', lastChecked: now() };
  try {
    // A team-owned project is only visible when teamId accompanies the request.
    const teamParam = config.vercel.teamId ? `&teamId=${encodeURIComponent(config.vercel.teamId)}` : '';
    const res = await fetchWithTimeout(`https://api.vercel.com/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=1${teamParam}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return { key: 'vercel', name: 'Vercel', status: 'error', detail: `provider returned HTTP ${res.status}`, lastChecked: now() };
    const json: any = await res.json();
    const latest = json?.deployments?.[0];
    return { key: 'vercel', name: 'Vercel', status: latest?.readyState === 'READY' ? 'ok' : 'error', detail: latest ? `latest deploy: ${String(latest.readyState).slice(0, 64)}` : 'no deployments found', lastChecked: now() };
  } catch (err) {
    return { key: 'vercel', name: 'Vercel', status: 'error', detail: safeErrorDetail(err), lastChecked: now() };
  }
}

// --- GitHub Actions (CI) --------------------------------------------------------
export async function checkGithubCi(): Promise<ConnectionStatus> {
  const { token, owner, repo } = config.githubCi;
  if (!token || !owner || !repo) return { key: 'github_ci', name: 'GitHub CI', status: 'not_configured', detail: 'GitHub CI connection is not configured', lastChecked: now() };
  try {
    const safeOwner = encodeURIComponent(owner);
    const safeRepo = encodeURIComponent(repo);
    const res = await fetchWithTimeout(`https://api.github.com/repos/${safeOwner}/${safeRepo}/actions/runs?per_page=1`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
    if (!res.ok) return { key: 'github_ci', name: 'GitHub CI', status: 'error', detail: `provider returned HTTP ${res.status}`, lastChecked: now() };
    const json: any = await res.json();
    const run = json?.workflow_runs?.[0];
    return { key: 'github_ci', name: 'GitHub CI', status: run?.conclusion === 'success' ? 'ok' : run ? 'error' : 'not_configured', detail: run ? `latest run: ${String(run.conclusion ?? run.status).slice(0, 64)}` : 'no workflow runs found', lastChecked: now() };
  } catch (err) {
    return { key: 'github_ci', name: 'GitHub CI', status: 'error', detail: safeErrorDetail(err), lastChecked: now() };
  }
}

// --- Stripe -------------------------------------------------------------------
// Exact counts are paged rather than silently capped at Stripe's first 100
// records. MRR is normalized to a monthly value and discounts are applied.
// Failed/unavailable checks return null values so the Founder UI cannot turn a
// provider failure into a false zero.
export async function checkStripeAndMrr(): Promise<{ connection: ConnectionStatus; customerCount: number | null; mrrCents: number | null; activeSubscriptionCount: number | null; successfulPaymentCount30d: number | null; successfulPaymentAmount30dCents: number | null }> {
  if (!config.stripe.secretKey) return { connection: { key: 'stripe', name: 'Stripe', status: 'not_configured', detail: 'Stripe connection is not configured', lastChecked: now() }, customerCount: null, mrrCents: null, activeSubscriptionCount: null, successfulPaymentCount30d: null, successfulPaymentAmount30dCents: null };
  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(config.stripe.secretKey);
    let customerCount = 0;
    for await (const _customer of stripe.customers.list({ limit: 100 })) customerCount += 1;

    const applyDiscounts = (cents: number, discounts: unknown[]): number => {
      let value = cents;
      for (const d of discounts) {
        const coupon = (d as any)?.coupon ?? (d as any)?.source?.coupon;
        if (!coupon) continue;
        if (typeof coupon.percent_off === 'number') value -= value * (coupon.percent_off / 100);
        else if (typeof coupon.amount_off === 'number') value -= coupon.amount_off;
      }
      return Math.max(0, Math.round(value));
    };

    let mrrCents = 0;
    let activeSubscriptions = 0;
    for await (const sub of stripe.subscriptions.list({ status: 'active', limit: 100, expand: ['data.discounts'] })) {
      activeSubscriptions += 1;
      const itemTotal = sub.items.data.reduce((sum, item) => {
        const amount = item.price?.unit_amount ?? 0;
        const interval = item.price?.recurring?.interval;
        const intervalCount = item.price?.recurring?.interval_count ?? 1;
        const qty = item.quantity ?? 1;
        const monthly = interval === 'year' ? amount / (12 * intervalCount) : interval === 'week' ? amount * 52 / (12 * intervalCount) : interval === 'day' ? amount * 365 / (12 * intervalCount) : amount / intervalCount;
        return sum + monthly * qty;
      }, 0);
      const discounts = ((sub as any).discounts ?? []).filter((d: unknown) => d && typeof d === 'object');
      mrrCents += applyDiscounts(itemTotal, discounts);
    }

    const createdAfter = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
    let successfulPaymentCount30d = 0;
    let successfulPaymentAmount30dCents = 0;
    for await (const intent of stripe.paymentIntents.list({ limit: 100, created: { gte: createdAfter } })) {
      if (intent.status !== 'succeeded') continue;
      successfulPaymentCount30d += 1;
      successfulPaymentAmount30dCents += intent.amount_received ?? intent.amount ?? 0;
    }

    return {
      connection: { key: 'stripe', name: 'Stripe', status: 'ok', detail: customerCount + ' customers, ' + activeSubscriptions + ' active subs, ' + successfulPaymentCount30d + ' successful payments in 30d', lastChecked: now() },
      customerCount,
      mrrCents: Math.max(0, Math.round(mrrCents)),
      activeSubscriptionCount: activeSubscriptions,
      successfulPaymentCount30d,
      successfulPaymentAmount30dCents,
    };
  } catch (err) {
    return { connection: { key: 'stripe', name: 'Stripe', status: 'error', detail: safeErrorDetail(err), lastChecked: now() }, customerCount: null, mrrCents: null, activeSubscriptionCount: null, successfulPaymentCount30d: null, successfulPaymentAmount30dCents: null };
  }
}

// --- Supabase Auth ------------------------------------------------------------
// Authentication moved from Firebase to Supabase; ../../firebase-admin.ts is the
// Supabase adapter kept under its historical module name. This card was still
// labelled "Firebase — Admin SDK reachable", which reported a product that is
// no longer part of the system. The probe is a real admin-API call
// (auth.admin.listUsers, service-role key), so the label now says what it
// actually reached.
export async function checkSupabaseAuth(): Promise<ConnectionStatus> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { key: 'supabase_auth', name: 'Supabase Auth', status: 'not_configured', detail: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set', lastChecked: now() };
  }
  try {
    const { adminAuth } = await import('../../firebase-admin.ts');
    await Promise.race([
      adminAuth.listUsers(1),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS)),
    ]);
    return { key: 'supabase_auth', name: 'Supabase Auth', status: 'ok', detail: 'auth admin API reachable (service role)', lastChecked: now() };
  } catch (err) {
    return { key: 'supabase_auth', name: 'Supabase Auth', status: 'error', detail: safeErrorDetail(err), lastChecked: now() };
  }
}
