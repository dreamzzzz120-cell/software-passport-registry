import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import { Agent } from 'undici';
import { withConnectorRetry } from './resilience.ts';

export type Provider =
  | 'gitlab' | 'bitbucket' | 'azure-devops' | 'jira' | 'confluence' | 'slack'
  | 'microsoft-365' | 'aws' | 'azure' | 'google-cloud' | 'connectwise'
  | 'autotask' | 'ninjaone' | 'hudu';

export type ProviderCredentials = Record<string, string>;
export type EvidenceResult = {
  provider: Provider;
  subject: string;
  observedAt: string;
  verificationMethod: string;
  sourceUrl: string;
  responseHash: string;
  observation: unknown;
};

const TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2_000_000;
const BLOCKED_HOSTS = new Set(['localhost', 'localhost.localdomain', 'metadata.google.internal']);

export function blockPrivateAddress(address: string): boolean {
  const h = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === '::1' || h === '::' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80:')) return true;
  const p = h.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return p[0] === 0 || p[0] === 10 || p[0] === 127 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168);
}

async function validateOutboundUrl(raw: string): Promise<{ url: URL; pinnedIp: string }> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('PROVIDER_URL_INVALID'); }
  if (url.protocol !== 'https:') throw new Error('PROVIDER_URL_MUST_USE_HTTPS');
  if (url.username || url.password) throw new Error('PROVIDER_URL_CREDENTIALS_FORBIDDEN');
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || blockPrivateAddress(host)) throw new Error('PROVIDER_URL_BLOCKED');
  const records = await dns.lookup(host, { all: true, verbatim: true });
  if (!records.length || records.some(r => blockPrivateAddress(r.address))) throw new Error('PROVIDER_URL_RESOLVES_PRIVATE');
  return { url, pinnedIp: records[0].address };
}

function pinnedDispatcher(ip: string) {
  if (blockPrivateAddress(ip)) throw new Error('PROVIDER_URL_BLOCKED');
  const family = ip.includes(':') ? 6 : 4;
  return new Agent({ connect: { lookup: (_hostname, _options, callback) => callback(null, [{ address: ip, family }]) } } as any);
}

export async function safeRequestJson(url: string, init: RequestInit = {}) {
  return withConnectorRetry(async () => {
    const { url: safeUrl, pinnedIp } = await validateOutboundUrl(url);
    const dispatcher = pinnedDispatcher(pinnedIp);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(safeUrl, { ...init, redirect: 'error', signal: controller.signal, dispatcher, headers: { accept: 'application/json', ...(init.headers || {}) } } as any);
      if (response.status >= 300 && response.status < 400) throw new Error('PROVIDER_URL_BLOCKED');
      const contentLength = Number(response.headers.get('content-length') || 0);
      if (contentLength > MAX_RESPONSE_BYTES) throw new Error('PROVIDER_RESPONSE_TOO_LARGE');
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('PROVIDER_RESPONSE_TOO_LARGE');
      if (!response.ok) {
        const retryAfter = response.headers.get('retry-after');
        const suffix = retryAfter ? `:${retryAfter}` : '';
        throw new Error(`PROVIDER_HTTP_${response.status}${suffix}`);
      }
      let body: unknown;
      try { body = JSON.parse(text); } catch { body = { text: text.slice(0, MAX_RESPONSE_BYTES) }; }
      return { body, text };
    } catch (error: any) {
      if (error?.name === 'AbortError') throw new Error('PROVIDER_TIMEOUT');
      if (error?.cause?.code === 'UND_ERR_REDIRECT' || /redirect/i.test(String(error?.message || ''))) throw new Error('PROVIDER_URL_BLOCKED');
      throw error;
    } finally {
      clearTimeout(timer);
      void dispatcher.close().catch(() => undefined);
    }
  });
}

function sha256(value: string) { return `sha256:${crypto.createHash('sha256').update(value, 'utf8').digest('hex')}`; }
function canonicalJson(value: unknown): string { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`; return `{${Object.keys(value as Record<string, unknown>).sort().map(k => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`; }
export function bearer(credentials: ProviderCredentials) { if (!credentials.accessToken) throw new Error('CREDENTIAL_MISSING_ACCESS_TOKEN'); return { Authorization: `Bearer ${credentials.accessToken}` }; }
function base64url(input: Buffer | string): string { return (Buffer.isBuffer(input) ? input : Buffer.from(input)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
export function buildGoogleServiceAccountJwt(serviceAccountKeyJson: string, scope: string, nowSeconds: number = Math.floor(Date.now() / 1000)): { jwt: string; tokenUri: string } {
  let key: any;
  try { key = JSON.parse(serviceAccountKeyJson); } catch { throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY_INVALID_JSON'); }
  if (key?.type !== 'service_account' || !key.client_email || !key.private_key) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY_MISSING_FIELDS');
  const tokenUri = typeof key.token_uri === 'string' && key.token_uri ? key.token_uri : 'https://oauth2.googleapis.com/token';
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = { iss: key.client_email, scope, aud: tokenUri, iat: nowSeconds, exp: nowSeconds + 3600 };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), key.private_key);
  return { jwt: `${unsigned}.${base64url(signature)}`, tokenUri };
}
export async function mintGoogleServiceAccountAccessToken(serviceAccountKeyJson: string, scope = 'https://www.googleapis.com/auth/cloud-platform.read-only'): Promise<string> {
  const { jwt, tokenUri } = buildGoogleServiceAccountJwt(serviceAccountKeyJson, scope);
  const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }).toString();
  const r = await safeRequestJson(tokenUri, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const accessToken = (r.body as any)?.access_token;
  if (typeof accessToken !== 'string' || !accessToken) throw new Error('GOOGLE_TOKEN_EXCHANGE_FAILED');
  return accessToken;
}
export function basic(credentials: ProviderCredentials) { if (!credentials.email || !credentials.apiToken) throw new Error('CREDENTIAL_MISSING_EMAIL_OR_TOKEN'); return { Authorization: `Basic ${Buffer.from(`${credentials.email}:${credentials.apiToken}`).toString('base64')}` }; }
function evidence(provider: Provider, subject: string, sourceUrl: string, body: unknown, verificationMethod: string): EvidenceResult { const observedAt = new Date().toISOString(); const canonical = canonicalJson({ provider, subject, sourceUrl, observedAt, body }); return { provider, subject, observedAt, verificationMethod, sourceUrl, responseHash: sha256(canonical), observation: body }; }
function hmac(key: crypto.BinaryLike, data: string, encoding?: crypto.BinaryToTextEncoding): Buffer | string { const digest = crypto.createHmac('sha256', key).update(data, 'utf8').digest(); return encoding ? digest.toString(encoding) : digest; }
function awsSignedSts(credentials: ProviderCredentials) { if (!credentials.accessKeyId || !credentials.secretAccessKey) throw new Error('CREDENTIAL_MISSING_AWS_KEYS'); const region = credentials.region || 'us-east-1'; const service = 'sts'; const host = credentials.stsHost || 'sts.amazonaws.com'; if (!/^[A-Za-z0-9.-]+$/.test(host)) throw new Error('AWS_STS_HOST_INVALID'); const method = 'POST'; const path = '/'; const body = 'Action=GetCallerIdentity&Version=2011-06-15'; const now = new Date(); const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); const dateStamp = amzDate.slice(0, 8); const payloadHash = crypto.createHash('sha256').update(body).digest('hex'); const canonicalHeaders = `content-type:application/x-www-form-urlencoded; charset=utf-8\nhost:${host}\nx-amz-date:${amzDate}\n`; const signedHeaders = 'content-type;host;x-amz-date'; const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n'); const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`; const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n'); const kDate = hmac(`AWS4${credentials.secretAccessKey}`, dateStamp) as Buffer; const kRegion = hmac(kDate, region) as Buffer; const kService = hmac(kRegion, service) as Buffer; const kSigning = hmac(kService, 'aws4_request') as Buffer; const signature = hmac(kSigning, stringToSign, 'hex') as string; const authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`; const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8', host, 'x-amz-date': amzDate, Authorization: authorization }; if (credentials.sessionToken) headers['x-amz-security-token'] = credentials.sessionToken; return { url: `https://${host}${path}`, headers, body }; }

export async function collectProviderEvidence(provider: Provider, credentials: ProviderCredentials): Promise<EvidenceResult> {
  switch (provider) {
    case 'gitlab': { const base = (credentials.baseUrl || 'https://gitlab.com').replace(/\/$/, ''); const userUrl = `${base}/api/v4/user`; const projectsUrl = `${base}/api/v4/projects?membership=true&per_page=1`; const user = await safeRequestJson(userUrl, { headers: bearer(credentials) }); const projects = await safeRequestJson(projectsUrl, { headers: bearer(credentials) }); return evidence(provider, 'authenticated-user', userUrl, { user: user.body, sampleProjects: projects.body }, 'GitLab API authenticated identity and project request'); }
    case 'bitbucket': { const base = (credentials.baseUrl || 'https://api.bitbucket.org/2.0').replace(/\/$/, ''); const userUrl = `${base}/user`; const reposUrl = `${base}/repositories?role=member&pagelen=1`; const user = await safeRequestJson(userUrl, { headers: bearer(credentials) }); const repos = await safeRequestJson(reposUrl, { headers: bearer(credentials) }); return evidence(provider, 'authenticated-user', userUrl, { user: user.body, sampleRepositories: repos.body }, 'Bitbucket authenticated identity and repository request'); }
    case 'azure-devops': { const organization = credentials.organization; if (!organization) throw new Error('CREDENTIAL_MISSING_ORGANIZATION'); const token = credentials.accessToken; if (!token) throw new Error('CREDENTIAL_MISSING_ACCESS_TOKEN'); const url = `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/projects?api-version=7.1&$top=5`; const r = await safeRequestJson(url, { headers: { Authorization: `Basic ${Buffer.from(`:${token}`).toString('base64')}` } }); return evidence(provider, organization, url, r.body, 'Azure DevOps projects API authenticated request'); }
    case 'jira': { const base = credentials.baseUrl?.replace(/\/$/, ''); if (!base) throw new Error('CREDENTIAL_MISSING_BASE_URL'); const meUrl = `${base}/rest/api/3/myself`; const projectsUrl = `${base}/rest/api/3/project/search?maxResults=5`; const me = await safeRequestJson(meUrl, { headers: basic(credentials) }); const projects = await safeRequestJson(projectsUrl, { headers: basic(credentials) }); return evidence(provider, 'authenticated-user', meUrl, { user: me.body, projects: projects.body }, 'Jira REST authenticated identity and project request'); }
    case 'confluence': { const base = credentials.baseUrl?.replace(/\/$/, ''); if (!base) throw new Error('CREDENTIAL_MISSING_BASE_URL'); const userUrl = `${base}/wiki/rest/api/user/current`; const spacesUrl = `${base}/wiki/rest/api/space?limit=5`; const user = await safeRequestJson(userUrl, { headers: basic(credentials) }); const spaces = await safeRequestJson(spacesUrl, { headers: basic(credentials) }); return evidence(provider, 'authenticated-user', userUrl, { user: user.body, spaces: spaces.body }, 'Confluence REST authenticated identity and space request'); }
    case 'slack': { const authUrl = 'https://slack.com/api/auth.test'; const infoUrl = 'https://slack.com/api/team.info'; const headers = bearer(credentials); const auth = await safeRequestJson(authUrl, { headers }); if ((auth.body as any)?.ok !== true) throw new Error('PROVIDER_AUTH_REJECTED'); const team = await safeRequestJson(infoUrl, { headers }); if ((team.body as any)?.ok !== true) throw new Error('PROVIDER_AUTH_REJECTED'); return evidence(provider, 'workspace-authentication', authUrl, { auth: auth.body, team: team.body }, 'Slack auth.test and team.info API requests'); }
    case 'microsoft-365': { const orgUrl = 'https://graph.microsoft.com/v1.0/organization'; const org = await safeRequestJson(orgUrl, { headers: bearer(credentials) }); return evidence(provider, 'tenant-organization', orgUrl, org.body, 'Microsoft Graph organization API authenticated request'); }
    case 'aws': { const request = awsSignedSts(credentials); const r = await safeRequestJson(request.url, { method: 'POST', headers: request.headers, body: request.body }); return evidence(provider, 'aws-account-identity', request.url, r.body, 'AWS Signature Version 4 STS GetCallerIdentity request'); }
    case 'azure': { const subscriptionId = credentials.subscriptionId; if (!subscriptionId || !credentials.accessToken) throw new Error('CREDENTIAL_MISSING'); const subUrl = `https://management.azure.com/subscriptions/${encodeURIComponent(subscriptionId)}?api-version=2022-12-01`; const rgUrl = `https://management.azure.com/subscriptions/${encodeURIComponent(subscriptionId)}/resourcegroups?api-version=2021-04-01&$top=5`; const subscription = await safeRequestJson(subUrl, { headers: bearer(credentials) }); const resourceGroups = await safeRequestJson(rgUrl, { headers: bearer(credentials) }); return evidence(provider, subscriptionId, subUrl, { subscription: subscription.body, resourceGroups: resourceGroups.body }, 'Azure Resource Manager subscription and resource-group requests'); }
    case 'google-cloud': { const url = 'https://cloudresourcemanager.googleapis.com/v3/projects?pageSize=5'; const usingServiceAccount = Boolean(credentials.serviceAccountKey); const token = usingServiceAccount ? await mintGoogleServiceAccountAccessToken(credentials.serviceAccountKey) : credentials.accessToken; if (!token) throw new Error('CREDENTIAL_MISSING_ACCESS_TOKEN'); const r = await safeRequestJson(url, { headers: { Authorization: `Bearer ${token}` } }); return evidence(provider, 'accessible-projects', url, r.body, usingServiceAccount ? 'Google Cloud Resource Manager authenticated project request (service-account JWT exchange)' : 'Google Cloud Resource Manager authenticated project request'); }
    case 'connectwise': { const base = credentials.baseUrl?.replace(/\/$/, ''); if (!base || !credentials.companyId || !credentials.publicKey || !credentials.privateKey) throw new Error('CREDENTIAL_MISSING'); const auth = Buffer.from(`${credentials.companyId}+${credentials.publicKey}:${credentials.privateKey}`).toString('base64'); const url = `${base}/v4_6_release/apis/3.0/company/companies?pageSize=5`; const r = await safeRequestJson(url, { headers: { Authorization: `Basic ${auth}` } }); return evidence(provider, credentials.companyId, url, r.body, 'ConnectWise Manage company inventory API authenticated request'); }
    case 'autotask': { const base = credentials.baseUrl?.replace(/\/$/, ''); if (!base || !credentials.username || !credentials.secret || !credentials.integrationCode) throw new Error('CREDENTIAL_MISSING'); const url = `${base}/v1.0/Companies/query`; const r = await safeRequestJson(url, { method: 'POST', headers: { ApiIntegrationCode: credentials.integrationCode, UserName: credentials.username, Secret: credentials.secret, 'Content-Type': 'application/json' }, body: JSON.stringify({ filter: [], MaxRecords: 5 }) }); return evidence(provider, credentials.username, url, r.body, 'Autotask Companies API authenticated request'); }
    case 'ninjaone': { const base = (credentials.baseUrl || 'https://app.ninjarmm.com').replace(/\/$/, ''); const url = `${base}/api/v2/devices?pageSize=5`; const r = await safeRequestJson(url, { headers: bearer(credentials) }); return evidence(provider, 'accessible-devices', url, r.body, 'NinjaOne device inventory API authenticated request'); }
    case 'hudu': { const base = credentials.baseUrl?.replace(/\/$/, ''); if (!base || !credentials.apiKey) throw new Error('CREDENTIAL_MISSING'); const url = `${base}/api/v1/companies?page_size=5`; const r = await safeRequestJson(url, { headers: { 'x-api-key': credentials.apiKey } }); return evidence(provider, 'accessible-companies', url, r.body, 'Hudu company inventory API authenticated request'); }
  }
}
