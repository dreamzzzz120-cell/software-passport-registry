/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { auth } from '../lib/firebase';

interface FetchOptions extends RequestInit {
  timeout?: number;
  retries?: number;
}

/** Authenticated API client with session recovery and safe retry semantics. */
export const apiFetch = async (
  input: RequestInfo | URL,
  init?: FetchOptions,
): Promise<Response> => {
  const url = typeof input === 'string'
    ? input
    : (input instanceof URL ? input.href : (input as Request).url || '');
  const isApiRequest = url.startsWith('/api/') || url.includes('/api/');

  if (!isApiRequest) return fetch(input, init);

  const timeoutMs = init?.timeout || 30000;
  const maxRetries = init?.retries ?? (init?.method === 'GET' ? 2 : 0);
  const baseHeaders = new Headers(init?.headers || {});
  if (!baseHeaders.has('Accept')) baseHeaders.set('Accept', 'application/json');
  if (init?.body && !baseHeaders.has('Content-Type') && typeof init.body === 'string') {
    baseHeaders.set('Content-Type', 'application/json');
  }

  let refreshedAfter401 = false;
  let attempt = 0;

  while (true) {
    const headers = new Headers(baseHeaders);
    const currentUser = auth.currentUser;
    if (currentUser) {
      try {
        const token = await currentUser.getIdToken(refreshedAfter401);
        if (token) headers.set('Authorization', `Bearer ${token}`);
      } catch (error) {
        console.error('[SPR auth token]', error);
      }
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    const requestInit: RequestInit = { ...init, headers, signal: controller.signal };

    try {
      const response = await fetch(input, requestInit);
      window.clearTimeout(timeoutId);

      // A stale Firebase ID token must not immediately destroy an otherwise
      // valid local session. Force-refresh once and retry the exact request.
      if (response.status === 401 && auth.currentUser && !refreshedAfter401) {
        refreshedAfter401 = true;
        continue;
      }

      if (response.status === 401 && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('auth-expired'));
      }
      return response;
    } catch (error: any) {
      window.clearTimeout(timeoutId);
      if (error?.name === 'AbortError') throw error;
      if (attempt >= maxRetries) throw error;
      attempt += 1;
      await new Promise((resolve) => window.setTimeout(resolve, attempt * 1000));
    }
  }
};
