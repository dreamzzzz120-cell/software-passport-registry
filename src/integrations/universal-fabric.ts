/**
 * SPR Universal Integration Fabric
 *
 * This is the canonical connector contract. A provider may only be marked
 * `live` when a provider-specific authenticated collector exists in adapters.ts.
 * `planned` is intentionally honest: it exposes the integration surface without
 * pretending credentials or provider APIs are already wired.
 */
export type ConnectorState = 'live' | 'planned' | 'disabled';
export type ConnectorDomain = 'source' | 'build' | 'cloud' | 'identity' | 'security' | 'observability' | 'itsm' | 'msp' | 'data' | 'ai';

export type UniversalConnector = {
  id: string;
  name: string;
  domain: ConnectorDomain;
  state: ConnectorState;
  auth: 'oauth2' | 'token' | 'api-key' | 'basic' | 'signed' | 'service-account' | 'webhook' | 'agent';
  capabilities: readonly ('identity' | 'inventory' | 'source' | 'builds' | 'deployments' | 'dependencies' | 'sbom' | 'vulnerabilities' | 'runtime' | 'logs' | 'alerts' | 'tickets' | 'documents' | 'users' | 'policies' | 'attestations' | 'provenance' | 'ai-agents')[];
};

export const UNIVERSAL_CONNECTORS: readonly UniversalConnector[] = [
  // Source / build
  { id: 'github', name: 'GitHub', domain: 'source', state: 'live', auth: 'token', capabilities: ['identity','source','dependencies','sbom','vulnerabilities','provenance'] },
  { id: 'gitlab', name: 'GitLab', domain: 'source', state: 'live', auth: 'token', capabilities: ['identity','inventory','source'] },
  { id: 'bitbucket', name: 'Bitbucket', domain: 'source', state: 'live', auth: 'token', capabilities: ['identity','inventory','source'] },
  { id: 'azure-devops', name: 'Azure DevOps', domain: 'build', state: 'live', auth: 'token', capabilities: ['identity','inventory','source','builds'] },
  { id: 'circleci', name: 'CircleCI', domain: 'build', state: 'planned', auth: 'token', capabilities: ['builds','deployments'] },
  { id: 'jenkins', name: 'Jenkins', domain: 'build', state: 'planned', auth: 'token', capabilities: ['builds','deployments'] },
  { id: 'buildkite', name: 'Buildkite', domain: 'build', state: 'planned', auth: 'token', capabilities: ['builds','deployments'] },
  { id: 'github-actions', name: 'GitHub Actions', domain: 'build', state: 'planned', auth: 'token', capabilities: ['builds','deployments','provenance'] },
  // Cloud / runtime
  { id: 'aws', name: 'AWS', domain: 'cloud', state: 'live', auth: 'signed', capabilities: ['identity','inventory','runtime','policies'] },
  { id: 'azure', name: 'Microsoft Azure', domain: 'cloud', state: 'live', auth: 'oauth2', capabilities: ['identity','inventory','runtime','policies'] },
  { id: 'google-cloud', name: 'Google Cloud', domain: 'cloud', state: 'live', auth: 'oauth2', capabilities: ['identity','inventory','runtime'] },
  { id: 'cloudflare', name: 'Cloudflare', domain: 'cloud', state: 'planned', auth: 'token', capabilities: ['identity','inventory','runtime','logs'] },
  { id: 'vercel', name: 'Vercel', domain: 'cloud', state: 'planned', auth: 'token', capabilities: ['identity','inventory','deployments','runtime'] },
  { id: 'railway', name: 'Railway', domain: 'cloud', state: 'planned', auth: 'token', capabilities: ['identity','inventory','deployments','runtime'] },
  { id: 'kubernetes', name: 'Kubernetes', domain: 'cloud', state: 'planned', auth: 'service-account', capabilities: ['identity','inventory','runtime','policies'] },
  // Identity / enterprise
  { id: 'microsoft-365', name: 'Microsoft 365', domain: 'identity', state: 'live', auth: 'oauth2', capabilities: ['identity','users','policies'] },
  { id: 'google-workspace', name: 'Google Workspace', domain: 'identity', state: 'planned', auth: 'oauth2', capabilities: ['identity','users','policies'] },
  { id: 'okta', name: 'Okta', domain: 'identity', state: 'planned', auth: 'oauth2', capabilities: ['identity','users','policies'] },
  { id: 'entra-id', name: 'Microsoft Entra ID', domain: 'identity', state: 'planned', auth: 'oauth2', capabilities: ['identity','users','policies'] },
  // Security / evidence
  { id: 'nvd', name: 'NVD', domain: 'security', state: 'planned', auth: 'api-key', capabilities: ['vulnerabilities'] },
  { id: 'osv', name: 'OSV', domain: 'security', state: 'live', auth: 'api-key', capabilities: ['vulnerabilities','dependencies'] },
  { id: 'github-advisory', name: 'GitHub Advisory Database', domain: 'security', state: 'planned', auth: 'token', capabilities: ['vulnerabilities','dependencies'] },
  { id: 'snyk', name: 'Snyk', domain: 'security', state: 'planned', auth: 'token', capabilities: ['vulnerabilities','dependencies','sbom'] },
  { id: 'semgrep', name: 'Semgrep', domain: 'security', state: 'planned', auth: 'token', capabilities: ['vulnerabilities','policies'] },
  { id: 'wiz', name: 'Wiz', domain: 'security', state: 'planned', auth: 'oauth2', capabilities: ['inventory','vulnerabilities','policies','runtime'] },
  { id: 'crowdstrike', name: 'CrowdStrike', domain: 'security', state: 'planned', auth: 'oauth2', capabilities: ['inventory','alerts','runtime'] },
  // Observability
  { id: 'datadog', name: 'Datadog', domain: 'observability', state: 'planned', auth: 'api-key', capabilities: ['inventory','logs','alerts','runtime'] },
  { id: 'new-relic', name: 'New Relic', domain: 'observability', state: 'planned', auth: 'api-key', capabilities: ['inventory','logs','alerts','runtime'] },
  { id: 'splunk', name: 'Splunk', domain: 'observability', state: 'planned', auth: 'token', capabilities: ['logs','alerts','runtime'] },
  // ITSM / collaboration
  { id: 'jira', name: 'Jira', domain: 'itsm', state: 'live', auth: 'basic', capabilities: ['identity','tickets','policies'] },
  { id: 'servicenow', name: 'ServiceNow', domain: 'itsm', state: 'planned', auth: 'oauth2', capabilities: ['inventory','tickets','policies'] },
  { id: 'confluence', name: 'Confluence', domain: 'data', state: 'live', auth: 'basic', capabilities: ['identity','documents'] },
  { id: 'slack', name: 'Slack', domain: 'data', state: 'live', auth: 'token', capabilities: ['identity','users','alerts'] },
  // MSP
  { id: 'connectwise', name: 'ConnectWise', domain: 'msp', state: 'live', auth: 'basic', capabilities: ['identity','inventory','tickets'] },
  { id: 'autotask', name: 'Autotask', domain: 'msp', state: 'live', auth: 'api-key', capabilities: ['identity','inventory','tickets'] },
  { id: 'ninjaone', name: 'NinjaOne', domain: 'msp', state: 'live', auth: 'token', capabilities: ['identity','inventory','runtime'] },
  { id: 'hudu', name: 'Hudu', domain: 'msp', state: 'live', auth: 'api-key', capabilities: ['identity','inventory','documents'] },
  // Data / AI
  { id: 'snowflake', name: 'Snowflake', domain: 'data', state: 'planned', auth: 'oauth2', capabilities: ['identity','inventory','policies'] },
  { id: 'databricks', name: 'Databricks', domain: 'data', state: 'planned', auth: 'token', capabilities: ['identity','inventory','policies'] },
  { id: 'openai', name: 'OpenAI', domain: 'ai', state: 'planned', auth: 'api-key', capabilities: ['identity','ai-agents'] },
  { id: 'anthropic', name: 'Anthropic', domain: 'ai', state: 'planned', auth: 'api-key', capabilities: ['identity','ai-agents'] },
  { id: 'google-ai', name: 'Google AI', domain: 'ai', state: 'planned', auth: 'api-key', capabilities: ['identity','ai-agents'] },
];

export const CONNECTOR_SECURITY_POLICY = Object.freeze({
  transport: 'https-only',
  redirectPolicy: 'same-origin-or-explicit-provider-allowlist',
  ssrfProtection: true,
  privateAddressBlocking: true,
  metadataEndpointBlocking: true,
  responseLimitBytes: 2_000_000,
  timeoutMs: 15_000,
  maxRedirects: 3,
  credentialStorage: 'server-side-vault-only',
  clientCredentialExposure: false,
  observationHash: 'sha256',
  evidenceModel: 'append-only-observation',
  unknownStateAllowed: true,
} as const);

export function connectorCoverage() {
  const live = UNIVERSAL_CONNECTORS.filter((item) => item.state === 'live');
  const planned = UNIVERSAL_CONNECTORS.filter((item) => item.state === 'planned');
  return { total: UNIVERSAL_CONNECTORS.length, live: live.length, planned: planned.length, liveIds: live.map((item) => item.id), plannedIds: planned.map((item) => item.id) };
}
