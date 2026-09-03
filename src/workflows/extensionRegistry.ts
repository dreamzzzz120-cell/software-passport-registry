export type ExtensionDefinition = {
  id: string;
  name: string;
  shortName: string;
  description: string;
  accent: string;
  steps: string[];
  entryPath: string;
  sourceRoutes: string[];
};

/**
 * Product ownership map.
 *
 * Intake is not analysis; analysis is not evidence storage; and the MSP
 * command center is the single MSP operating surface. Specialized workflows
 * link into these canonical surfaces instead of creating parallel copies.
 */
export const EXTENSIONS: ExtensionDefinition[] = [
  {
    id: 'new-review',
    name: 'New Software Review',
    shortName: 'New Review',
    description: 'Start a software review by connecting a repository or securely uploading evidence files. The submission then enters the canonical SPR analysis pipeline.',
    accent: 'emerald',
    steps: ['Choose repository or files', 'Submit evidence', 'Verify upload', 'Run analysis', 'Review results'],
    entryPath: '/extensions/new-review',
    sourceRoutes: ['/scans'],
  },
  {
    id: 'trust-evidence',
    name: 'Trust & Evidence',
    shortName: 'Trust',
    description: 'Canonical analysis and evidence workflow: register software, collect observed evidence, scan dependencies, review findings, and publish a trust passport.',
    accent: 'cyan',
    steps: ['Register asset', 'Collect evidence', 'Run analysis', 'Review findings', 'Publish passport'],
    entryPath: '/extensions/trust-evidence',
    sourceRoutes: ['/passports', '/evidence-explorer', '/scans'],
  },
  {
    id: 'msp-command-center',
    name: 'MSP Stack Command Center',
    shortName: 'MSP Command',
    description: 'The single MSP operating surface. Correlate clients, software, evidence, findings, monitoring, remediation, integrations, reporting, and audit state without replacing the MSP systems of record.',
    accent: 'violet',
    steps: ['Connect sources', 'Verify connectivity', 'Review client estate', 'Act on findings', 'Export / report'],
    entryPath: '/extensions/msp-command-center',
    sourceRoutes: ['/msp', '/clients', '/assets', '/passports', '/evidence-explorer', '/alerts', '/compliance', '/monitoring', '/integrations', '/reports', '/audit-log'],
  },
  {
    id: 'agent-trust',
    name: 'AI Agent Trust',
    shortName: 'Agents',
    description: 'Specialized trust workflow for AI-agent identity, permissions, provenance, evidence, and operational monitoring. Uses the same evidence and findings model as core SPR.',
    accent: 'fuchsia',
    steps: ['Register agent', 'Verify identity', 'Review permissions', 'Inspect evidence', 'Monitor trust'],
    entryPath: '/extensions/agent-trust',
    sourceRoutes: ['/agent-trust', '/security', '/monitoring'],
  },
  {
    id: 'vendor-risk',
    name: 'Vendor Risk',
    shortName: 'Vendors',
    description: 'Specialized supplier-risk workflow that maps vendors to software assets and evidence without duplicating the canonical passport or evidence records.',
    accent: 'amber',
    steps: ['Add vendor', 'Map assets', 'Assess risk', 'Review evidence', 'Approve / monitor'],
    entryPath: '/extensions/vendor-risk',
    sourceRoutes: ['/vendors', '/passports', '/security'],
  },
  {
    id: 'integrations',
    name: 'Integrations Hub',
    shortName: 'Integrations',
    description: 'Connect external systems and normalize their signals into SPR evidence. Integrations remain the system boundary; SPR remains the trust and evidence control plane.',
    accent: 'emerald',
    steps: ['Choose source', 'Connect', 'Sync', 'Validate', 'Monitor'],
    entryPath: '/extensions/integrations',
    sourceRoutes: ['/integrations'],
  },
];

export const EXTENSION_BY_ID = Object.fromEntries(EXTENSIONS.map((extension) => [extension.id, extension]));
