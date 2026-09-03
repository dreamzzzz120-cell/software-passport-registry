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

export const EXTENSIONS: ExtensionDefinition[] = [
  {
    id: 'trust-evidence',
    name: 'Trust & Evidence',
    shortName: 'Trust',
    description: 'Register software, collect evidence, scan dependencies, and produce an evidence-first passport.',
    accent: 'cyan',
    steps: ['Register asset', 'Collect evidence', 'Run scan', 'Review findings', 'Publish passport'],
    entryPath: '/extensions/trust-evidence',
    sourceRoutes: ['/passports', '/scans', '/registry'],
  },
  {
    id: 'new-review',
    name: 'New Software Review',
    shortName: 'New Review',
    description: 'Submit a GitHub repository or upload software evidence files and send them into the SPR analysis pipeline.',
    accent: 'emerald',
    steps: ['Choose repository or files', 'Submit evidence', 'Verify upload', 'Run analysis', 'Review results'],
    entryPath: '/extensions/new-review',
    sourceRoutes: ['/scans'],
  },
  {
    id: 'msp-compliance',
    name: 'MSP Compliance',
    shortName: 'MSP',
    description: 'Run a repeatable managed-service workflow across clients, controls, evidence, findings, and remediation.',
    accent: 'violet',
    steps: ['Select client', 'Assess posture', 'Collect evidence', 'Remediate gaps', 'Export status'],
    entryPath: '/extensions/msp-compliance',
    sourceRoutes: ['/msp', '/clients', '/compliance', '/alerts'],
  },
  {
    id: 'agent-trust',
    name: 'AI Agent Trust',
    shortName: 'Agents',
    description: 'Evaluate AI-agent identity, permissions, evidence, provenance, and operational trust.',
    accent: 'fuchsia',
    steps: ['Register agent', 'Verify identity', 'Review permissions', 'Inspect evidence', 'Monitor trust'],
    entryPath: '/extensions/agent-trust',
    sourceRoutes: ['/agent-trust', '/security', '/monitoring'],
  },
  {
    id: 'vendor-risk',
    name: 'Vendor Risk',
    shortName: 'Vendors',
    description: 'Turn software and supplier records into a continuously reviewable vendor-risk workflow.',
    accent: 'amber',
    steps: ['Add vendor', 'Map assets', 'Assess risk', 'Review evidence', 'Approve / monitor'],
    entryPath: '/extensions/vendor-risk',
    sourceRoutes: ['/vendors', '/passports', '/security'],
  },
  {
    id: 'integrations',
    name: 'Integrations Hub',
    shortName: 'Integrations',
    description: 'Connect evidence sources and keep synchronization, credentials, and status visible in one workflow.',
    accent: 'emerald',
    steps: ['Choose source', 'Connect', 'Sync', 'Validate', 'Monitor'],
    entryPath: '/extensions/integrations',
    sourceRoutes: ['/integrations'],
  },
];

export const EXTENSION_BY_ID = Object.fromEntries(EXTENSIONS.map((extension) => [extension.id, extension]));
