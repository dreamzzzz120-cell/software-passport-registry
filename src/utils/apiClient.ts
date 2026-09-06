/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { auth } from '../lib/firebase';
import { setAuthNotice, notProvisionedMessage } from '../lib/authNotice';
import { isSignupTransitionActive } from '../lib/signupTransition';

interface FetchOptions extends RequestInit {
  timeout?: number;
  retries?: number;
}

/**
 * Client-directory presentation normalization.
 *
 * clients.trust_score and clients.compliance_progress are NOT NULL integer
 * columns that default to 0 -- and nothing in this codebase ever computes or
 * writes either one to anything else, for any client, regardless of how much
 * software/passport evidence that client has (verified by searching every
 * route and worker for an UPDATE touching either column: there is none).
 * A previous version of this normalization only converted 0 -> 'Not
 * assessed' for a client with zero registered software, on the assumption
 * that a client WITH software would have a real computed score. That
 * assumption doesn't hold: a client with fifty passports still shows exactly
 * 0, indistinguishable from having failed an assessment. Every 0 on either
 * field is "never assessed", full stop, so both are normalized
 * unconditionally -- matching src/utils/pdfGenerator.ts's scoreDisplay/
 * assessmentDisplay, which already treat value > 0 as the only real signal.
 */
const normalizeClientDirectoryResponse = async (response: Response): Promise<Response> => {
  if (!response.ok) return response;

  let payload: unknown;
  try {
    payload = await response.clone().json();
  } catch {
    return response;
  }

  if (!Array.isArray(payload)) return response;

  let changed = false;
  const normalized = payload.map((client: any) => {
    if (!client || typeof client !== 'object') return client;

    const next = { ...client };
    if (Number(next.trustScore) === 0) {
      next.trustScore = 'Not assessed';
      changed = true;
    }
    if (Number(next.complianceProgress) === 0) {
      next.complianceProgress = 'Not assessed';
      changed = true;
    }
    if (next.joinedDate) {
      const date = new Date(next.joinedDate);
      if (!Number.isNaN(date.getTime())) {
        next.joinedDate = new Intl.DateTimeFormat(undefined, {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }).format(date);
        changed = true;
      }
    }
    return next;
  });

  if (!changed) return response;

  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  return new Response(JSON.stringify(normalized), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

/** Hardened same-origin API client. Never sends Firebase credentials off-origin. */
export const apiFetch = async (
  input: RequestInfo | URL,
  init?: FetchOptions,
): Promise<Response> => {
  const rawUrl = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
  const resolvedUrl = new URL(rawUrl, window.location.origin);
  const isSameOriginApiRequest =
    resolvedUrl.origin === window.location.origin &&
    (resolvedUrl.pathname === '/api' || resolvedUrl.pathname.startsWith('/api/'));

  // Critical boundary: never attach an SPR bearer token to arbitrary URLs.
  if (!isSameOriginApiRequest) return fetch(input, init);

  const headers = new Headers(init?.headers || {});
  if (auth.currentUser) {
    try {
      const token = await auth.currentUser.getIdToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);
    } catch (err) {
      console.error('[API Client Firebase Token Retrieval Error]:', err);
    }
  }
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  if (init?.body && !headers.has('Content-Type') && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const timeoutMs = init?.timeout ?? 30_000;
  const method = (init?.method ?? 'GET').toUpperCase();
  const maxRetries = init?.retries ?? (method === 'GET' ? 2 : 0);
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const rawResponse = await fetch(resolvedUrl, { ...init, headers, signal: controller.signal });
      const response = resolvedUrl.pathname === '/api/user/clients'
        ? await normalizeClientDirectoryResponse(rawResponse)
        : rawResponse;

      if (response.status === 401) {
        window.dispatchEvent(new CustomEvent('auth-expired'));
      }
      if (response.status === 402) {
        // The server is the authority for paid access. Keep the user signed in
        // and route them to the real billing surface instead of treating a
        // commercial denial as an authentication failure. This also makes the
        // paywall work for direct API attempts, not only visible UI buttons.
        const isBillingPage = window.location.pathname === '/billing' || window.location.pathname === '/pricing';
        if (!isBillingPage) {
          const billingUrl = '/billing';
          window.history.pushState({}, '', billingUrl);
          window.dispatchEvent(new PopStateEvent('popstate'));
          window.dispatchEvent(new CustomEvent('billing-required', {
            detail: { path: resolvedUrl.pathname },
          }));
        }
      }
      if (response.status === 403 && resolvedUrl.pathname === '/api/user/me' && !isSignupTransitionActive()) {
        // A valid Firebase identity without a persisted SPR user record is
        // authenticated but not authorized for the workspace. Do not render
        // a partially initialized dashboard or silently fall back to Viewer.
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
      if (attempt < maxRetries) {
        await new Promise(resolve => window.setTimeout(resolve, (attempt + 1) * 1000));
      }
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Network failure connecting to ${resolvedUrl.pathname}`);
};
