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
  if (!projectId) return { key: 'railway', name: 'Railway', status: 'not_configured', detail: 'RAILWAY_PROJECT_ID is unavailable, so this process cannot prove which Railway project it belongs to.', lastChecked: now() };
  // Railway injects RAILWAY_PROJECT_ID into running services. That is direct
  // runtime evidence that SPR is deployed on Railway even when the optional
  // management API token is not present. Do not call a live deployment
  // "not configured" merely because deeper service-list telemetry is disabled.
  if (!token) return { key: 'railway', name: 'Railway', status: 'ok', detail: 'Railway runtime verified from injected project identity; management API telemetry token is not configured.', lastChecked: now() };
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
  if (!projectId) return { key: 'vercel', name: 'Vercel', status: 'not_configured', detail: 'VERCEL_PROJECT_ID is not configured.', lastChecked: now() };
  try {
    if (!token) {
      const publicUrl = config.vercel.publicUrl;
      if (!publicUrl) return { key: 'vercel', name: 'Vercel', status: 'not_configured', detail: 'Vercel project identity is configured, but neither VERCEL_API_TOKEN nor VERCEL_PUBLIC_URL is available for a live check.', lastChecked: now() };
      const res = await fetchWithTimeout(publicUrl, { method: 'HEAD', redirect: 'follow' });
      if (!res.ok) return { key: 'vercel', name: 'Vercel', status: 'error', detail: `public Vercel deployment returned HTTP ${res.status}`, lastChecked: now() };
      return { key: 'vercel', name: 'Vercel', status: 'ok', detail: 'Production Vercel deployment is publicly reachable; management API telemetry token is not configured.', lastChecked: now() };
    }

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
  if (!owner || !repo) return { key: 'github_ci', name: 'GitHub CI', status: 'not_configured', detail: 'GITHUB_OWNER and/or GITHUB_REPO is not configured.', lastChecked: now() };
  try {
    const safeOwner = encodeURIComponent(owner);
    const safeRepo = encodeURIComponent(repo);
    // Public repositories do not require a token for this read-only Actions
    // endpoint. Use a token when supplied (higher rate limit/private repos),
    // but do not falsely mark public CI as disconnected without one.
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'software-passport-registry' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetchWithTimeout(`https://api.github.com/repos/${safeOwner}/${safeRepo}/actions/runs?per_page=1`, { headers });
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
      connection: {
        key: 'stripe',
        name: 'Stripe',
        status: config.isProduction && /_(?:test)_/.test(config.stripe.secretKey) ? 'error' : 'ok',
        detail: (config.isProduction && /_(?:test)_/.test(config.stripe.secretKey) ? 'TEST MODE key is configured in production; ' : 'LIVE MODE; ') + customerCount + ' customers, ' + activeSubscriptions + ' active subs, ' + successfulPaymentCount30d + ' successful payments in 30d',
        lastChecked: now(),
      },
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
// Authentication uses Supabase Auth. The probe is a real admin-API call. The probe is a real admin-API call
// (auth.admin.listUsers, service-role key), so the label now says what it
// actually reached.
export async function checkSupabaseAuth(): Promise<ConnectionStatus> {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const adminKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_SECRET_KEY?.trim();
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl) {
    return { key: 'supabase_auth', name: 'Supabase Auth', status: 'not_configured', detail: 'SUPABASE_URL is not configured.', lastChecked: now() };
  }
  try {
    if (adminKey) {
      const { adminAuth } = await import('../../supabase-admin.ts');
      await Promise.race([
        adminAuth.listUsers(1),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS)),
      ]);
      return { key: 'supabase_auth', name: 'Supabase Auth', status: 'ok', detail: 'Auth admin API reachable (server secret configured).', lastChecked: now() };
    }

    // Normal customer authentication only needs the project URL and public
    // publishable key. Verify that service directly instead of declaring the
    // whole auth provider disconnected because founder-only admin telemetry
    // is not enabled.
    const headers: Record<string, string> = {};
    if (publishableKey) headers.apikey = publishableKey;
    const res = await fetchWithTimeout(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/health`, { headers });
    if (!res.ok) return { key: 'supabase_auth', name: 'Supabase Auth', status: 'error', detail: `auth health endpoint returned HTTP ${res.status}`, lastChecked: now() };
    return { key: 'supabase_auth', name: 'Supabase Auth', status: 'ok', detail: 'Auth service reachable; founder admin-user telemetry key is not configured.', lastChecked: now() };
  } catch (err) {
    return { key: 'supabase_auth', name: 'Supabase Auth', status: 'error', detail: safeErrorDetail(err), lastChecked: now() };
  }
}
