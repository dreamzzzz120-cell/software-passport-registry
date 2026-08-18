/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { auth } from '../lib/firebase';

interface FetchOptions extends RequestInit {
  timeout?: number;
  retries?: number;
}

/**
 * Intercepts all client requests targeting /api/* endpoints,
 * attaches the verified user metadata inside the Bearer Authorization header,
 * and adds resilience features like timeouts, retries, and clean error handling.
 */
export const apiFetch = async (
  input: RequestInfo | URL,
  init?: FetchOptions
): Promise<Response> => {
  const url = typeof input === 'string' 
    ? input 
    : (input instanceof URL ? input.href : (input as Request).url || '');

  const isApiRequest = url.startsWith('/api/') || url.includes('/api/');

  if (isApiRequest) {
    const newInit = { ...init };
    const headers = new Headers(newInit.headers || {});
    
    let token = '';

    // 1. Try to get token from current active Firebase session
    if (auth.currentUser) {
      try {
        token = await auth.currentUser.getIdToken();
      } catch (err) {
        console.error('[API Client Firebase Token Retrieval Error]:', err);
      }
    }

    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    
    // Hardening: Enforce secure content negotiation headers
    if (!headers.has('Accept')) {
      headers.set('Accept', 'application/json');
    }
    // Set content-type for post/put requests automatically if not specified and body is present
    if (newInit.body && !headers.has('Content-Type') && typeof newInit.body === 'string') {
      headers.set('Content-Type', 'application/json');
    }

    newInit.headers = headers;

    // Hardening: Timeout using AbortController (default 30 seconds)
    const timeoutMs = init?.timeout || 30000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    newInit.signal = controller.signal;

    const maxRetries = init?.retries ?? (newInit.method === 'GET' ? 2 : 0); // Only retry safe idempotent GET requests
    let attempt = 0;
    let response: Response | null = null;
    let lastError: any = null;

    while (attempt <= maxRetries) {
      try {
        response = await fetch(input, newInit);
        clearTimeout(timeoutId);
        break;
      } catch (err: any) {
        lastError = err;
        if (err.name === 'AbortError') {
          console.warn(`[API Client Timeout] Request to ${url} aborted after ${timeoutMs}ms.`);
          break;
        }
        
        attempt++;
        if (attempt <= maxRetries) {
          const backoffDelay = attempt * 1000;
          console.warn(`[API Client Network Error] Failed attempt ${attempt}/${maxRetries + 1} to fetch ${url}. Retrying in ${backoffDelay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, backoffDelay));
        }
      }
    }

    // Clean up timeout if we succeeded or if loop finished
    clearTimeout(timeoutId);

    if (!response) {
      throw lastError || new Error(`Network failure connecting to ${url}`);
    }

    if (response.status === 401) {
      console.warn('[API Client 401 Unauthorized] Dispatched session expiration trigger.');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('auth-expired'));
      }
    }
    
    return response;
  }

  return fetch(input, init);
};
