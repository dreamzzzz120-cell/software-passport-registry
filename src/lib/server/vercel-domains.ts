/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Thin client for the Vercel Project Domains API, used by white-label custom
 * domains. The web app is served by one Vercel project; a tenant's hostname
 * has to be attached to that project for Vercel to answer for it and issue
 * its certificate. Every function here maps to one documented endpoint and
 * returns what Vercel said -- nothing is inferred.
 *
 * Requires VERCEL_API_TOKEN, VERCEL_PROJECT_ID and (for a team-owned
 * project) VERCEL_TEAM_ID. isVercelDomainsConfigured() is what the routes
 * check before promising anything.
 */

import { config } from '../../config.ts';

const API = 'https://api.vercel.com';

export interface VercelVerificationRecord { type: string; domain: string; value: string; reason?: string }
export interface VercelProjectDomain { name: string; apexName?: string; verified: boolean; verification?: VercelVerificationRecord[] }
export interface VercelDomainConfig { misconfigured: boolean; configuredBy?: string | null; acceptedChallenges?: string[] }

export class VercelApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}

export function isVercelDomainsConfigured(): boolean {
  return Boolean(config.vercel.apiToken && config.vercel.projectId);
}

function teamQuery(): string {
  return config.vercel.teamId ? `?teamId=${encodeURIComponent(config.vercel.teamId)}` : '';
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = config.vercel.apiToken;
  if (!token || !config.vercel.projectId) throw new VercelApiError(503, 'VERCEL_NOT_CONFIGURED', 'VERCEL_API_TOKEN and VERCEL_PROJECT_ID are required.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${API}${path}${teamQuery()}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    const json = text ? (() => { try { return JSON.parse(text); } catch { return null; } })() : null;
    if (!response.ok) {
      const code = typeof json?.error?.code === 'string' ? json.error.code : `HTTP_${response.status}`;
      const message = typeof json?.error?.message === 'string' ? json.error.message : `Vercel returned HTTP ${response.status}`;
      throw new VercelApiError(response.status, code, message);
    }
    return json as T;
  } finally { clearTimeout(timer); }
}

const project = () => encodeURIComponent(config.vercel.projectId!);

export function addProjectDomain(hostname: string): Promise<VercelProjectDomain> {
  return call<VercelProjectDomain>('POST', `/v10/projects/${project()}/domains`, { name: hostname });
}

export function getProjectDomain(hostname: string): Promise<VercelProjectDomain> {
  return call<VercelProjectDomain>('GET', `/v9/projects/${project()}/domains/${encodeURIComponent(hostname)}`);
}

export function verifyProjectDomain(hostname: string): Promise<VercelProjectDomain> {
  return call<VercelProjectDomain>('POST', `/v9/projects/${project()}/domains/${encodeURIComponent(hostname)}/verify`);
}

export function getDomainConfig(hostname: string): Promise<VercelDomainConfig> {
  return call<VercelDomainConfig>('GET', `/v6/domains/${encodeURIComponent(hostname)}/config`);
}

export async function removeProjectDomain(hostname: string): Promise<void> {
  try { await call('DELETE', `/v9/projects/${project()}/domains/${encodeURIComponent(hostname)}`); } catch (error) {
    if (error instanceof VercelApiError && error.status === 404) return;
    throw error;
  }
}

/**
 * The DNS records the customer has to create. Vercel's documented targets:
 * a subdomain points a CNAME at cname.vercel-dns.com; an apex (which cannot
 * carry a CNAME) points an A record at 76.76.21.21. When the domain is
 * already attached to another Vercel account, Vercel additionally returns a
 * TXT challenge under _vercel, passed through untouched.
 */
export function dnsInstructions(hostname: string, domain: VercelProjectDomain): Array<{ type: string; name: string; value: string; purpose: string }> {
  const apex = domain.apexName ?? hostname;
  const isApex = hostname.toLowerCase() === apex.toLowerCase();
  const records = [
    isApex
      ? { type: 'A', name: hostname, value: '76.76.21.21', purpose: 'Points the apex domain at the hosting provider.' }
      : { type: 'CNAME', name: hostname, value: 'cname.vercel-dns.com', purpose: 'Points the hostname at the hosting provider.' },
  ];
  for (const record of domain.verification ?? []) {
    records.push({ type: record.type, name: record.domain, value: record.value, purpose: record.reason ? `Ownership verification (${record.reason}).` : 'Ownership verification.' });
  }
  return records;
}
