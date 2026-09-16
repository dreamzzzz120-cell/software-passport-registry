/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { auth, supabase } from '../lib/firebase';
import { setAuthNotice, notProvisionedMessage } from '../lib/authNotice';
import { isSignupTransitionActive } from '../lib/signupTransition';

interface FetchOptions extends RequestInit {
  timeout?: number;
  retries?: number;
}

const normalizeClientDirectoryResponse = async (response: Response): Promise<Response> => {
  if (!response.ok) return response;
  let payload: unknown;
  try { payload = await response.clone().json(); } catch { return response; }
  if (!Array.isArray(payload)) return response;
  let changed = false;
  const normalized = payload.map((client: any) => {
    if (!client || typeof client !== 'object') return client;
    const next = { ...client };
    if (Number(next.trustScore) === 0) { next.trustScore = 'Not assessed'; changed = true; }
    if (Number(next.complianceProgress) === 0) { next.complianceProgress = 'Not assessed'; changed = true; }
    if (next.joinedDate) {
      const date = new Date(next.joinedDate);
      if (!Number.isNaN(date.getTime())) {
        next.joinedDate = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
        changed = true;
      }
    }
    return next;
  });
  if (!changed) return response;
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  return new Response(JSON.stringify(normalized), { status: response.status, statusText: response.statusText, headers });
};

/** Hardened same-origin API client. Uses the active Supabase session token. */
export const apiFetch = async (input: RequestInfo | URL, init?: FetchOptions): Promise<Response> => {
  const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const resolvedUrl = new URL(rawUrl, window.location.origin);
  const isSameOriginApiRequest = resolvedUrl.origin === window.location.origin && (resolvedUrl.pathname === '/api' || resolvedUrl.pathname.startsWith('/api/'));
  if (!isSameOriginApiRequest) return fetch(input, init);

  const headers = new Headers(init?.headers || {});
  // LoginView talks directly to Supabase, so the compatibility auth.currentUser
  // can lag the real browser session during the first dashboard request. Read
  // the current Supabase session as the source of truth and use its JWT.
  try {
    const sessionResult = await supabase.auth.getSession();
    const token = sessionResult.data.session?.access_token;
    if (token) headers.set('Authorization', `Bearer ${token}`);
    else if (auth.currentUser) {
      const fallbackToken = await auth.currentUser.getIdToken(false);
      if (fallbackToken) headers.set('Authorization', `Bearer ${fallbackToken}`);
    }
  } catch (err) {
    console.error('[API Client Supabase Session Retrieval Error]:', err);
  }
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  if (init?.body && !headers.has('Content-Type') && typeof init.body === 'string') headers.set('Content-Type', 'application/json; charset=utf-8');

  const timeoutMs = init?.timeout ?? 30_000;
  const method = (init?.method ?? 'GET').toUpperCase();
  const maxRetries = init?.retries ?? (method === 'GET' ? 2 : 0);
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const rawResponse = await fetch(resolvedUrl, { ...init, headers, signal: controller.signal });
      const response = resolvedUrl.pathname === '/api/user/clients' ? await normalizeClientDirectoryResponse(rawResponse) : rawResponse;
      if (response.status === 401) window.dispatchEvent(new CustomEvent('auth-expired'));
      if (response.status === 402) {
        const isBillingPage = window.location.pathname === '/billing' || window.location.pathname === '/pricing';
        if (!isBillingPage) {
          window.history.pushState({}, '', '/billing');
          window.dispatchEvent(new PopStateEvent('popstate'));
          window.dispatchEvent(new CustomEvent('billing-required', { detail: { path: resolvedUrl.pathname } }));
        }
      }
      if (response.status === 403 && resolvedUrl.pathname === '/api/user/me' && !isSignupTransitionActive()) {
        const rejectedEmail = auth?.currentUser?.email ?? null;
        setAuthNotice(notProvisionedMessage(rejectedEmail));
        window.dispatchEvent(new CustomEvent('auth-provisioning-failed', { detail: { email: rejectedEmail } }));
        await auth.signOut().catch(() => undefined);
      }
      return response;
    } catch (err) {
      lastError = err;
      if (err instanceof DOMException && err.name === 'AbortError') {
        console.warn(`[API Client Timeout] ${resolvedUrl.pathname} exceeded ${timeoutMs}ms.`);
        break;
      }
      if (attempt < maxRetries) await new Promise(resolve => window.setTimeout(resolve, (attempt + 1) * 1000));
    } finally {
      window.clearTimeout(timeoutId);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Network failure connecting to ${resolvedUrl.pathname}`);
};
