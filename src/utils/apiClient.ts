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
      const response = await fetch(resolvedUrl, { ...init, headers, signal: controller.signal });
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
        //
        // Suppressed only during the signup transition, where a 403 here is
        // the expected state of an account that was created seconds ago and
        // is not provisioned yet - reporting it would replace the signup
        // success message with a misleading failure. Every other 403 still
        // surfaces normally, and the server's decision is unchanged.
        // Read the address before signOut() clears currentUser, so the notice
        // can name the identity that was actually refused.
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
