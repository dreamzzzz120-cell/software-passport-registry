import crypto from 'node:crypto';

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

function sha256(value: string) {
  return `sha256:${crypto.createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

async function requestJson(url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { accept: 'application/json', ...(init.headers || {}) },
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`PROVIDER_HTTP_${response.status}`);
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = { text: text.slice(0, 100_000) }; }
    return { body, text };
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('PROVIDER_TIMEOUT');
    throw error;
  } finally { clearTimeout(timer); }
}

function bearer(credentials: ProviderCredentials) {
  if (!credentials.accessToken) throw new Error('CREDENTIAL_MISSING');
  return { Authorization: `Bearer ${credentials.accessToken}` };
}

function basic(credentials: ProviderCredentials) {
  if (!credentials.email || !credentials.apiToken) throw new Error('CREDENTIAL_MISSING');
  return { Authorization: `Basic ${Buffer.from(`${credentials.email}:${credentials.apiToken}`).toString('base64')}` };
}

function evidence(provider: Provider, subject: string, sourceUrl: string, body: unknown, verificationMethod: string): EvidenceResult {
  const observedAt = new Date().toISOString();
  const canonical = JSON.stringify({ provider, subject, sourceUrl, observedAt, body });
  return { provider, subject, observedAt, verificationMethod, sourceUrl, responseHash: sha256(canonical), observation: body };
}

export async function collectProviderEvidence(provider: Provider, credentials: ProviderCredentials): Promise<EvidenceResult> {
  switch (provider) {
    case 'gitlab': {
      const base = (credentials.baseUrl || 'https://gitlab.com').replace(/\/$/, '');
      const r = await requestJson(`${base}/api/v4/user`, { headers: bearer(credentials) });
      return evidence(provider, 'authenticated-user', `${base}/api/v4/user`, r.body, 'GitLab API token authenticated request');
    }
    case 'bitbucket': {
      const base = (credentials.baseUrl || 'https://api.bitbucket.org/2.0').replace(/\/$/, '');
      const r = await requestJson(`${base}/user`, { headers: bearer(credentials) });
      return evidence(provider, 'authenticated-user', `${base}/user`, r.body, 'Bitbucket API authenticated request');
    }
    case 'azure-devops': {
      const organization = credentials.organization;
      if (!organization) throw new Error('CREDENTIAL_MISSING_ORGANIZATION');
      if (!credentials.accessToken) throw new Error('CREDENTIAL_MISSING');
      const url = `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/projects?api-version=7.1`;
      const r = await requestJson(url, { headers: { Authorization: `Basic ${Buffer.from(`:${credentials.accessToken}`).toString('base64')}` } });
      return evidence(provider, organization, url, r.body, 'Azure DevOps projects API authenticated request');
    }
    case 'jira': {
      const base = credentials.baseUrl?.replace(/\/$/, '');
      if (!base) throw new Error('CREDENTIAL_MISSING_BASE_URL');
      const url = `${base}/rest/api/3/myself`;
      const r = await requestJson(url, { headers: basic(credentials) });
      return evidence(provider, 'authenticated-user', url, r.body, 'Jira REST API authenticated request');
    }
    case 'confluence': {
      const base = credentials.baseUrl?.replace(/\/$/, '');
      if (!base) throw new Error('CREDENTIAL_MISSING_BASE_URL');
      const url = `${base}/wiki/rest/api/user/current`;
      const r = await requestJson(url, { headers: basic(credentials) });
      return evidence(provider, 'authenticated-user', url, r.body, 'Confluence REST API authenticated request');
    }
    case 'slack': {
      const url = 'https://slack.com/api/auth.test';
      const r = await requestJson(url, { headers: bearer(credentials) });
      if ((r.body as any)?.ok !== true) throw new Error('PROVIDER_AUTH_REJECTED');
      return evidence(provider, 'workspace-authentication', url, r.body, 'Slack auth.test API request');
    }
    case 'microsoft-365': {
      const url = 'https://graph.microsoft.com/v1.0/organization';
      const r = await requestJson(url, { headers: bearer(credentials) });
      return evidence(provider, 'tenant-organization', url, r.body, 'Microsoft Graph organization API authenticated request');
    }
    case 'aws': {
      if (!credentials.accessKeyId || !credentials.secretAccessKey) throw new Error('CREDENTIAL_MISSING');
      throw new Error('UNSUPPORTED_SIGNED_AWS_REQUEST');
    }
    case 'azure': {
      const subscriptionId = credentials.subscriptionId;
      if (!subscriptionId || !credentials.accessToken) throw new Error('CREDENTIAL_MISSING');
      const url = `https://management.azure.com/subscriptions/${encodeURIComponent(subscriptionId)}?api-version=2022-12-01`;
      const r = await requestJson(url, { headers: bearer(credentials) });
      return evidence(provider, subscriptionId, url, r.body, 'Azure Resource Manager authenticated request');
    }
    case 'google-cloud': {
      const url = 'https://cloudresourcemanager.googleapis.com/v3/projects';
      const r = await requestJson(url, { headers: bearer(credentials) });
      return evidence(provider, 'accessible-projects', url, r.body, 'Google Cloud Resource Manager authenticated request');
    }
    case 'connectwise': {
      const base = credentials.baseUrl?.replace(/\/$/, '');
      if (!base || !credentials.companyId || !credentials.publicKey || !credentials.privateKey) throw new Error('CREDENTIAL_MISSING');
      const auth = Buffer.from(`${credentials.companyId}+${credentials.publicKey}:${credentials.privateKey}`).toString('base64');
      const url = `${base}/v4_6_release/apis/3.0/company/companies?pageSize=1`;
      const r = await requestJson(url, { headers: { Authorization: `Basic ${auth}` } });
      return evidence(provider, credentials.companyId, url, r.body, 'ConnectWise Manage API authenticated request');
    }
    case 'autotask': {
      const base = credentials.baseUrl?.replace(/\/$/, '');
      if (!base || !credentials.username || !credentials.secret) throw new Error('CREDENTIAL_MISSING');
      const url = `${base}/v1.0/Companies/query`;
      const r = await requestJson(url, { method: 'POST', headers: { 'ApiIntegrationCode': credentials.integrationCode || '', 'UserName': credentials.username, 'Secret': credentials.secret, 'Content-Type': 'application/json' }, body: JSON.stringify({ filter: [], MaxRecords: 1 }) });
      return evidence(provider, credentials.username, url, r.body, 'Autotask REST API authenticated request');
    }
    case 'ninjaone': {
      const base = (credentials.baseUrl || 'https://app.ninjarmm.com').replace(/\/$/, '');
      const url = `${base}/api/v2/devices?pageSize=1`;
      const r = await requestJson(url, { headers: bearer(credentials) });
      return evidence(provider, 'accessible-devices', url, r.body, 'NinjaOne API authenticated request');
    }
    case 'hudu': {
      const base = credentials.baseUrl?.replace(/\/$/, '');
      if (!base) throw new Error('CREDENTIAL_MISSING_BASE_URL');
      const url = `${base}/api/v1/companies?page_size=1`;
      const r = await requestJson(url, { headers: { 'x-api-key': credentials.apiKey || '' } });
      return evidence(provider, 'accessible-companies', url, r.body, 'Hudu API authenticated request');
    }
  }
}
