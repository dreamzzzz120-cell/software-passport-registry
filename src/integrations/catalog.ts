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
 * Live means SPR has a provider-specific authenticated collector that can make
 * a real provider request and persist a hashed observation. It does NOT mean
 * every possible security control offered by that provider has been assessed.
 */
export const INTEGRATION_CATALOG: IntegrationCatalogItem[] = [
  { id: 'github', name: 'GitHub', category: 'DEVOPS', icon: 'github', provider: 'github', capability: 'live', description: 'Repository identity, immutable commit acquisition, CycloneDX SBOM generation, dependency evidence and OSV vulnerability evidence.' },
  { id: 'gitlab', name: 'GitLab', category: 'DEVOPS', icon: 'gitlab', provider: 'gitlab', capability: 'live', description: 'Authenticated account and project inventory evidence; repository/project collection foundation.' },
  { id: 'bitbucket', name: 'Bitbucket', category: 'DEVOPS', icon: 'git', provider: 'bitbucket', capability: 'live', description: 'Authenticated account and repository inventory evidence; repository collection foundation.' },
  { id: 'azure-devops', name: 'Azure DevOps', category: 'DEVOPS', icon: 'cloud-lightning', provider: 'azure-devops', capability: 'live', description: 'Authenticated organization/project inventory evidence; repository and build collection foundation.' },
  { id: 'jira', name: 'Jira', category: 'ISSUE TRACKER', icon: 'ticket', provider: 'jira', capability: 'live', description: 'Authenticated user and project/work-item evidence for remediation traceability.' },
  { id: 'confluence', name: 'Confluence', category: 'DOCUMENTATION', icon: 'book-open', provider: 'confluence', capability: 'live', description: 'Authenticated user, space and documentation inventory evidence.' },
  { id: 'slack', name: 'Slack', category: 'CHAT', icon: 'slack', provider: 'slack', capability: 'live', description: 'Authenticated workspace identity and operational metadata evidence.' },
  { id: 'microsoft-365', name: 'Microsoft 365', category: 'WORKSPACE', icon: 'shield-check', provider: 'microsoft-365', capability: 'live', description: 'Microsoft Graph tenant, user and directory evidence.' },
  { id: 'aws', name: 'AWS', category: 'CLOUD', icon: 'cloud-lightning', provider: 'aws', capability: 'live', description: 'Signed AWS identity and account evidence; cloud collection foundation.' },
  { id: 'azure', name: 'Microsoft Azure', category: 'CLOUD', icon: 'cloud-lightning', provider: 'azure', capability: 'live', description: 'Authenticated subscription and resource-group inventory evidence.' },
  { id: 'google-cloud', name: 'Google Cloud', category: 'CLOUD', icon: 'cloud-lightning', provider: 'google-cloud', capability: 'live', description: 'Authenticated accessible-project inventory evidence.' },
  { id: 'connectwise', name: 'ConnectWise', category: 'PSA', icon: 'briefcase', provider: 'connectwise', capability: 'live', description: 'Authenticated company/customer inventory evidence and PSA foundation.' },
  { id: 'autotask', name: 'Autotask', category: 'PSA', icon: 'briefcase', provider: 'autotask', capability: 'live', description: 'Authenticated company/customer inventory evidence and PSA foundation.' },
  { id: 'ninjaone', name: 'NinjaOne', category: 'RMM', icon: 'monitor', provider: 'ninjaone', capability: 'live', description: 'Authenticated endpoint/device inventory evidence and RMM foundation.' },
  { id: 'hudu', name: 'Hudu', category: 'DOCUMENTATION', icon: 'file-text', provider: 'hudu', capability: 'live', description: 'Authenticated company/asset documentation inventory evidence.' },
];
