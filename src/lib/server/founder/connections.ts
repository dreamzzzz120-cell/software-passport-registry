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
    if (!run) return { key: 'github_ci', name: 'GitHub CI', status: 'not_configured', detail: 'no workflow runs found', lastChecked: now() };
    const runStatus = String(run.status ?? '').toLowerCase();
    const conclusion = run.conclusion == null ? null : String(run.conclusion).toLowerCase();
    // Queued/in-progress is evidence that GitHub Actions is connected and
    // actively processing work. It is not a CI failure. Only a completed run
    // with a non-success conclusion is an error.
    if (runStatus !== 'completed' || conclusion === null) {
      return { key: 'github_ci', name: 'GitHub CI', status: 'ok', detail: `latest run: ${runStatus || 'in progress'}`, lastChecked: now() };
    }
    return { key: 'github_ci', name: 'GitHub CI', status: conclusion === 'success' ? 'ok' : 'error', detail: `latest run: ${conclusion}`, lastChecked: now() };
  } catch (err) {
    return { key: 'github_ci', name: 'GitHub CI', status: 'error', detail: safeErrorDetail(err), lastChecked: now() };
  }
}

// --- Stripe -------------------------------------------------------------------
// Exact counts are paged rather than silently capped at Stripe's first 100
// records. MRR is normalized to a monthly value and discounts are applied.
// Failed/unavailable checks return null values so the Founder UI cannot turn a
// provider failure into a false zero.
type StripeMetrics = { connection: ConnectionStatus; customerCount: number | null; mrrCents: number | null; activeSubscriptionCount: number | null; successfulPaymentCount30d: number | null; successfulPaymentAmount30dCents: number | null };
const emptyStripeMetrics = { customerCount: null, mrrCents: null, activeSubscriptionCount: null, successfulPaymentCount30d: null, successfulPaymentAmount30dCents: null };

function stripeFailure(err: unknown): string {
  const status = (err as { statusCode?: number })?.statusCode;
  if (status === 401) return 'credentials rejected';
  if (status === 403) return 'read permission missing';
  if (status === 429) return 'provider rate limit';
  if (status === 400) return 'provider rejected the telemetry request';
  if ((err as Error)?.name === 'FounderStripeTimeout') return 'check timed out';
  return safeErrorDetail(err);
}

async function boundedStripeRead<T>(read: (expired: () => boolean) => Promise<T>): Promise<T> {
  let expired = false;
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { expired = true; const error = new Error('Stripe check timed out'); error.name = 'FounderStripeTimeout'; reject(error); }, CHECK_TIMEOUT_MS);
  });
  try { return await Promise.race([Promise.resolve().then(() => read(() => expired)), timeout]); }
  finally { clearTimeout(timer!); }
}

// The dashboard formats money as USD. Unsupported prices/discounts remain
// unknown instead of becoming zero, undiscounted revenue, or mixed currency.
export function subscriptionMonthlyUsd(sub: any): number | null {
  if (sub.items?.has_more || !Array.isArray(sub.items?.data) || !sub.items.data.length) return null;
  const items = sub.items.data;
  let total = 0;
  for (const item of items) {
    const price = item.price;
    const recurring = price?.recurring;
    const amount = price?.unit_amount;
    const quantity = item.quantity ?? 1;
    const count = recurring?.interval_count ?? 1;
    if (price?.currency !== 'usd' || price?.transform_quantity || !Number.isFinite(amount) || amount < 0 || recurring?.usage_type === 'metered'
      || !Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(count) || count <= 0 || item.discounts?.length) return null;
    const factor = recurring?.interval === 'year' ? 1 / 12 : recurring?.interval === 'week' ? 52 / 12 : recurring?.interval === 'day' ? 365 / 12 : recurring?.interval === 'month' ? 1 : null;
    if (factor === null) return null;
    total += amount * quantity * factor / count;
  }
  for (const discount of sub.discounts ?? []) {
    if (!discount || typeof discount !== 'object') return null;
    if (typeof discount.end === 'number' && discount.end < Date.now() / 1000) continue;
    const coupon = discount.coupon ?? discount.source?.coupon;
    if (!coupon || typeof coupon !== 'object' || coupon.applies_to?.products?.length) return null;
    if (typeof coupon.percent_off === 'number' && coupon.percent_off >= 0 && coupon.percent_off <= 100) total *= 1 - coupon.percent_off / 100;
    else if (typeof coupon.amount_off === 'number' && coupon.amount_off >= 0 && coupon.currency === 'usd') {
      // A fixed coupon is applied per billing period. Mixed periods require a
      // provider invoice breakdown; do not subtract its face value from MRR.
      const interval = items[0].price.recurring.interval;
      const count = items[0].price.recurring.interval_count ?? 1;
      if (items.some((item: any) => item.price.recurring.interval !== interval || (item.price.recurring.interval_count ?? 1) !== count)) return null;
      const factor = interval === 'year' ? 1 / 12 : interval === 'week' ? 52 / 12 : interval === 'day' ? 365 / 12 : 1;
      total -= coupon.amount_off * factor / count;
    } else return null;
  }
  return Number.isFinite(total) ? Math.max(0, total) : null;
}

export async function checkStripeAndMrr(): Promise<StripeMetrics> {
  const key = config.stripe.secretKey;
  if (!key) return { connection: { key: 'stripe', name: 'Stripe', status: 'not_configured', detail: 'Stripe connection is not configured', lastChecked: now() }, ...emptyStripeMetrics };
  const testMode = /^(?:sk|rk)_test_/.test(key);
  if (config.isProduction && testMode) return { connection: { key: 'stripe', name: 'Stripe', status: 'error', detail: 'TEST MODE key is configured in production; live billing telemetry is unavailable.', lastChecked: now() }, ...emptyStripeMetrics };
  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(key, { timeout: CHECK_TIMEOUT_MS, maxNetworkRetries: 0 });
    const [customers, subscriptions, payments] = await Promise.allSettled([
      boundedStripeRead(async expired => {
        let count = 0;
        for await (const _customer of stripe.customers.list({ limit: 100 })) { if (expired()) throw new Error('check expired'); count += 1; }
        return count;
      }),
      boundedStripeRead(async expired => {
        let count = 0;
        let total = 0;
        let known = true;
        for await (const sub of stripe.subscriptions.list({ status: 'active', limit: 100, expand: ['data.discounts.source.coupon'] })) {
          if (expired()) throw new Error('check expired');
          count += 1;
          const monthly = subscriptionMonthlyUsd(sub);
          if (monthly === null) known = false; else total += monthly;
        }
        return { count, mrr: known ? Math.round(total) : null };
      }),
      boundedStripeRead(async expired => {
        const createdAfter = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
        let count = 0;
        let total = 0;
        let known = true;
        for await (const intent of stripe.paymentIntents.list({ limit: 100, created: { gte: createdAfter } })) {
          if (expired()) throw new Error('check expired');
          if (intent.status !== 'succeeded') continue;
          count += 1;
          const amount = intent.amount_received;
          if (intent.currency !== 'usd' || !Number.isFinite(amount) || amount < 0) known = false; else total += amount;
        }
        return { count, amount: known ? total : null };
      }),
    ]);
    const failures = [customers, subscriptions, payments].flatMap((result, index) => result.status === 'rejected' ? [`${['customers', 'subscriptions', 'payments'][index]} unavailable (${stripeFailure(result.reason)})`] : []);
    if (subscriptions.status === 'fulfilled' && subscriptions.value.mrr === null) failures.push('USD MRR unavailable for unsupported pricing or discounts');
    if (payments.status === 'fulfilled' && payments.value.amount === null) failures.push('USD payment total unavailable for unsupported currency or amount');
    const customerCount = customers.status === 'fulfilled' ? customers.value : null;
    const activeSubscriptionCount = subscriptions.status === 'fulfilled' ? subscriptions.value.count : null;
    const successfulPaymentCount30d = payments.status === 'fulfilled' ? payments.value.count : null;
    const readings = `${customerCount ?? 'unknown'} customers, ${activeSubscriptionCount ?? 'unknown'} active subs, ${successfulPaymentCount30d ?? 'unknown'} successful payments in 30d`;
    // Operational diagnostics contain availability only, never keys, customer
    // identities, money amounts or raw provider errors.
    console.info('[FounderStripeTelemetry]', JSON.stringify({
      customers: customers.status === 'fulfilled' ? 'verified' : stripeFailure(customers.reason),
      subscriptions: subscriptions.status === 'fulfilled' ? 'verified' : stripeFailure(subscriptions.reason),
      payments: payments.status === 'fulfilled' ? 'verified' : stripeFailure(payments.reason),
      usdMrr: subscriptions.status === 'fulfilled' && subscriptions.value.mrr !== null ? 'verified' : 'unavailable',
      usdPaymentTotal: payments.status === 'fulfilled' && payments.value.amount !== null ? 'verified' : 'unavailable',
    }));
    return {
      connection: { key: 'stripe', name: 'Stripe', status: failures.length ? 'error' : 'ok', detail: `${testMode ? 'TEST MODE' : 'LIVE MODE'}; ${readings}${failures.length ? '; ' + failures.join('; ') : ''}`, lastChecked: now() },
      customerCount,
      mrrCents: subscriptions.status === 'fulfilled' ? subscriptions.value.mrr : null,
      activeSubscriptionCount,
      successfulPaymentCount30d,
      successfulPaymentAmount30dCents: payments.status === 'fulfilled' ? payments.value.amount : null,
    };
  } catch (err) {
    return { connection: { key: 'stripe', name: 'Stripe', status: 'error', detail: stripeFailure(err), lastChecked: now() }, ...emptyStripeMetrics };
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
