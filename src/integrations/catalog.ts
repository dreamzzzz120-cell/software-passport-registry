export type IntegrationCatalogItem = {
  id: string;
  name: string;
  category: string;
  icon: string;
  description: string;
  provider: string;
  capability: 'live' | 'planned';
};

/**
 * Truthful integration registry. A card is never treated as connected merely
 * because it exists in this catalog. `capability: planned` means the provider
 * is intentionally visible but has no live pull adapter yet.
 */
export const INTEGRATION_CATALOG: IntegrationCatalogItem[] = [
  { id: 'github', name: 'GitHub', category: 'DEVOPS', icon: 'github', provider: 'github', capability: 'live', description: 'Pull repository metadata, resolve an immutable commit, acquire the source archive, generate a CycloneDX SBOM with Syft, and query OSV.' },
  { id: 'gitlab', name: 'GitLab', category: 'DEVOPS', icon: 'gitlab', provider: 'gitlab', capability: 'planned', description: 'Planned repository, commit, CI and dependency evidence connector.' },
  { id: 'bitbucket', name: 'Bitbucket', category: 'DEVOPS', icon: 'git', provider: 'bitbucket', capability: 'planned', description: 'Planned repository and pipeline evidence connector.' },
  { id: 'azure-devops', name: 'Azure DevOps', category: 'DEVOPS', icon: 'cloud-lightning', provider: 'azure-devops', capability: 'planned', description: 'Planned repository, build and work-item evidence connector.' },
  { id: 'jira', name: 'Jira', category: 'ISSUE TRACKER', icon: 'ticket', provider: 'jira', capability: 'planned', description: 'Planned remediation and issue-traceability evidence connector.' },
  { id: 'confluence', name: 'Confluence', category: 'DOCUMENTATION', icon: 'book-open', provider: 'confluence', capability: 'planned', description: 'Planned policy, architecture and documentation evidence connector.' },
  { id: 'slack', name: 'Slack', category: 'CHAT', icon: 'slack', provider: 'slack', capability: 'planned', description: 'Planned security notification and operational evidence connector.' },
  { id: 'microsoft-365', name: 'Microsoft 365', category: 'WORKSPACE', icon: 'shield-check', provider: 'microsoft-365', capability: 'planned', description: 'Planned identity, tenant and security-control evidence connector.' },
  { id: 'aws', name: 'AWS', category: 'CLOUD', icon: 'cloud-lightning', provider: 'aws', capability: 'planned', description: 'Planned cloud configuration and workload evidence connector.' },
  { id: 'azure', name: 'Microsoft Azure', category: 'CLOUD', icon: 'cloud-lightning', provider: 'azure', capability: 'planned', description: 'Planned cloud configuration and workload evidence connector.' },
  { id: 'google-cloud', name: 'Google Cloud', category: 'CLOUD', icon: 'cloud-lightning', provider: 'google-cloud', capability: 'planned', description: 'Planned cloud configuration and workload evidence connector.' },
  { id: 'connectwise', name: 'ConnectWise', category: 'PSA', icon: 'briefcase', provider: 'connectwise', capability: 'planned', description: 'Planned MSP client, asset, ticket and operational evidence connector.' },
  { id: 'autotask', name: 'Autotask', category: 'PSA', icon: 'briefcase', provider: 'autotask', capability: 'planned', description: 'Planned MSP client, asset, ticket and operational evidence connector.' },
  { id: 'ninjaone', name: 'NinjaOne', category: 'RMM', icon: 'monitor', provider: 'ninjaone', capability: 'planned', description: 'Planned endpoint, patch and device posture evidence connector.' },
  { id: 'hudu', name: 'Hudu', category: 'DOCUMENTATION', icon: 'file-text', provider: 'hudu', capability: 'planned', description: 'Planned documentation, asset and client evidence connector.' },
];
