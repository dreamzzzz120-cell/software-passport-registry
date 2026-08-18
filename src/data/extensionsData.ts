/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { 
  ShieldCheck, 
  UserCheck, 
  FileCheck, 
  Building2, 
  Lock, 
  Brain, 
  Cpu, 
  Workflow, 
  Cloud, 
  LineChart, 
  ClipboardCheck, 
  FileText,
  Boxes
} from 'lucide-react';

export interface SubExtension {
  id: string;
  label: string;
  desc: string;
}

export interface Extension {
  id: string;
  name: string;
  version: string;
  publisher: string;
  category: string;
  description: string;
  installs: string;
  rating: number;
  icon: any; // React Component
  iconColor: string;
  dependencies: string[];
  permissions: string[];
  digitalSignature: string;
  changelog: { version: string; changes: string[] }[];
  documentation: string;
  reviews: { author: string; rating: number; text: string }[];
  subExtensions: SubExtension[];
}

export const extensionCategories = [
  'Identity & Signatures',
  'Security & Auditing',
  'Trust & Analytics',
  'Compliance & Frameworks',
  'AI & Intelligence',
  'Infrastructure & Operations',
  'Data & Reports'
];

export const allExtensions: Extension[] = [
  {
    id: 'identity',
    name: 'Identity & Signatures Core',
    version: 'v2.4.1',
    publisher: 'spr.identity.labs',
    category: 'Identity & Signatures',
    description: 'Cryptographic identity anchors for applications, builders, and release registries.',
    installs: '1.2M',
    rating: 4.9,
    icon: UserCheck,
    iconColor: 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20',
    dependencies: [],
    permissions: ['read_certificates', 'sign_passport', 'verify_signatures'],
    digitalSignature: 'Not verified — no signature evidence provided',
    changelog: [
      { version: 'v2.4.1', changes: ['Enhanced software DNA hashing speed.', 'Updated CA key validation list.'] },
      { version: 'v2.3.0', changes: ['Added organization identity registry integration.'] }
    ],
    documentation: 'Identity Extension serves as the security foundation. It binds software binaries to developer signatures and verifies digital certificates before any deployment or compliance scheduling.',
    reviews: [
      { author: 'Jane_SecOps', rating: 5, text: 'Essential for developer chain of custody!' },
      { author: 'AuditGuy', rating: 4.8, text: 'Solid signature verifications.' }
    ],
    subExtensions: [
      { id: 'software-identity', label: 'Software Identity', desc: 'Sovereign binary URI and publisher indexing.' },
      { id: 'vendor-identity', label: 'Vendor Identity', desc: 'Secure cryptographic profiling for software vendors.' },
      { id: 'repo-identity', label: 'Repository Identity', desc: 'Signed repository metadata, branch locks and webhooks.' },
      { id: 'org-identity', label: 'Organization Identity', desc: 'Multi-tenant organization cryptographic key anchors.' },
      { id: 'digital-certs', label: 'Digital Certificates', desc: 'X.509 security cert verification pipeline.' },
      { id: 'crypto-signatures', label: 'Cryptographic Signatures', desc: 'SLSA Level 4 digital signatures for passports.' },
      { id: 'software-dna', label: 'Software DNA', desc: 'Hierarchical binary hashing and component fingerprinting.' },
      { id: 'ownership-history', label: 'Ownership History', desc: 'Immutable ledger trace of registry owners.' }
    ]
  },
  {
    id: 'security',
    name: 'Continuous Sentinel Security',
    version: 'v3.2.0',
    publisher: 'spr.security.scanner',
    category: 'Security & Auditing',
    description: 'Autonomous static/dynamic scanners, malware alerts, and deep secrets inspection.',
    installs: '2.5M',
    rating: 5.0,
    icon: ShieldCheck,
    iconColor: 'bg-rose-500/10 text-rose-400 border border-rose-500/20',
    dependencies: ['identity'],
    permissions: ['run_scans', 'scan_source_code', 'alert_notifications', 'manage_cves'],
    digitalSignature: 'Not verified — no signature evidence provided',
    changelog: [
      { version: 'v3.2.0', changes: ['Integrated real-time zero-day vulnerability streams.', 'SAST engines run 2.5x faster.'] },
      { version: 'v3.1.5', changes: ['Improved AWS Cloud Security posture controls.'] }
    ],
    documentation: 'Continuous Sentinel integrates continuous static and dynamic security scanners with secrets detection, malware databases, and automated container/API risk scores.',
    reviews: [
      { author: 'David_D', rating: 5, text: 'Instantly flagged hardcoded keys in our staging container!' },
      { author: 'Alice_S', rating: 5, text: 'Exceptional DAST performance.' }
    ],
    subExtensions: [
      { id: 'vuln-scanner', label: 'Vulnerability Scanner', desc: 'Scans containers, libraries, and binaries against active CVE registries.' },
      { id: 'secrets-detection', label: 'Secrets Detection', desc: 'Stops leak of API tokens, SSH keys, and passwords.' },
      { id: 'dep-risk', label: 'Dependency Risk', desc: 'Calculates licensing conflicts and transitive vulnerability trees.' },
      { id: 'malware-detection', label: 'Malware Detection', desc: 'Signatures scanning for compromised modules or build binaries.' },
      { id: 'sast', label: 'SAST Engine', desc: 'Static application security testing for codebase files.' },
      { id: 'dast', label: 'DAST Daemon', desc: 'Simulated runtime penetration testing for web apps.' },
      { id: 'container-security', label: 'Container Security', desc: 'Inspects base images and docker layers.' },
      { id: 'api-security', label: 'API Security', desc: 'Audit endpoints and REST routes for authorization leakage.' },
      { id: 'cloud-security', label: 'Cloud Security', desc: 'Verify IAM rules and Kubernetes configuration safety.' },
      { id: 'zero-trust', label: 'Zero Trust Control', desc: 'Continuous mutual TLS & peer validation policies.' },
      { id: 'threat-intel', label: 'Threat Intelligence', desc: 'Ingests active global security indicators.' },
      { id: 'security-policies', label: 'Security Policies', desc: 'Defines risk tolerance rules and threshold configs.' }
    ]
  },
  {
    id: 'trust',
    name: 'Trust Score & Analytics Engine',
    version: 'v1.8.9',
    publisher: 'trust.score.engine',
    category: 'Trust & Analytics',
    description: 'Dynamic risk scoring models, dependency trust graphs, and risk forecasting.',
    installs: '850K',
    rating: 4.8,
    icon: LineChart,
    iconColor: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
    dependencies: ['identity', 'security'],
    permissions: ['calculate_metrics', 'read_telemetry', 'generate_forecasts'],
    digitalSignature: 'Not verified — no signature evidence provided',
    changelog: [
      { version: 'v1.8.9', changes: ['Optimized trust comparisons engine.', 'Added trust forecasting model.'] }
    ],
    documentation: 'Trust Engine translates security data, vendor audits, and code signatures into a fluid mathematical Trust Score ranging from 0-100, tracking software lifecycle risk over time.',
    reviews: [
      { author: 'CISO_Robert', rating: 4.8, text: 'Great for boards of directors to visualize security!' }
    ],
    subExtensions: [
      { id: 'trust-score', label: 'Trust Score Engine', desc: 'Formulates current system trust index scores.' },
      { id: 'trust-timeline', label: 'Trust Timeline', desc: 'Historical trace of posture fluctuations and releases.' },
      { id: 'trust-evidence', label: 'Trust Evidence Map', desc: 'Links individual metrics directly to compliance logs.' },
      { id: 'trust-graph', label: 'Trust Graph Visualizer', desc: 'Explorable dependency nodes trust mapping.' },
      { id: 'trust-analytics', label: 'Trust Analytics', desc: 'Slicing & dicing software risk indices by department.' },
      { id: 'trust-forecasting', label: 'Trust Forecasting', desc: 'AI predictions of trust scores based on open vulnerabilities.' },
      { id: 'trust-comparisons', label: 'Trust Comparisons', desc: 'Juxtapose different packages and vendor libraries.' },
      { id: 'trust-benchmarks', label: 'Trust Benchmarks', desc: 'Compare your posture against industry averages.' },
      { id: 'trust-alerts', label: 'Trust Alerts', desc: 'Notify team if score falls below custom security thresholds.' },
      { id: 'trust-reports', label: 'Trust Reports Generator', desc: 'Generates detailed risk digests.' }
    ]
  },
  {
    id: 'passport',
    name: 'Software Passport Core',
    version: 'v3.0.1',
    publisher: 'spr.passport.services',
    category: 'Identity & Signatures',
    description: 'Seals software components, SBOMs, and audits into interactive, cryptographically verifiable passports.',
    installs: '1.9M',
    rating: 4.9,
    icon: FileCheck,
    iconColor: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
    dependencies: ['identity'],
    permissions: ['create_passport', 'seal_passport', 'share_passport', 'api_access'],
    digitalSignature: 'Not verified — no signature evidence provided',
    changelog: [
      { version: 'v3.0.1', changes: ['Added JSON schema verification.', 'Enabled quick export to CSV/Excel.'] }
    ],
    documentation: 'This extension is the primary controller for Software Passports. It compiles code hashes, compliance evidence, scanner outputs, and sign-offs into a tamper-proof package for release distribution.',
    reviews: [],
    subExtensions: [
      { id: 'passport-gen', label: 'Passport Generator', desc: 'Compiles and seals project metadata into passport files.' },
      { id: 'passport-view', label: 'Passport Viewer', desc: 'Explores signatures, SBOM dependencies, and seals.' },
      { id: 'passport-timeline', label: 'Passport Timeline', desc: 'Version-by-version release evolution viewer.' },
      { id: 'passport-validation', label: 'Passport Validation', desc: 'Validates integrity hashes and certificates on-the-fly.' },
      { id: 'passport-history', label: 'Passport History', desc: 'Lifecycle transition trace ledger.' },
      { id: 'passport-export', label: 'Passport Export', desc: 'Saves sealed passports as cryptographically signed PDF/JSON files.' },
      { id: 'passport-sharing', label: 'Passport Sharing', desc: 'Secure sharing links for external supply-chain audits.' },
      { id: 'passport-api', label: 'Passport API Server', desc: 'Exposes secure endpoints for deployment gates.' },
      { id: 'passport-verify', label: 'Passport Verification Gate', desc: 'CI/CD pipeline verification runner.' },
      { id: 'passport-lifecycle', label: 'Passport Lifecycle', desc: 'Manages expiration, revocation, and re-signing.' }
    ]
  },
  {
    id: 'compliance',
    name: 'Multi-Framework Compliance Suite',
    version: 'v2.5.0',
    publisher: 'spr.compliance.co',
    category: 'Compliance & Frameworks',
    description: 'Pre-mapped controls, gap audits, and evidence mapping for SOC2, ISO27001, FedRAMP, HIPAA, CRA, and GDPR.',
    installs: '1.4M',
    rating: 4.9,
    icon: ClipboardCheck,
    iconColor: 'bg-teal-500/10 text-teal-400 border border-teal-500/20',
    dependencies: ['identity', 'security'],
    permissions: ['read_compliance', 'modify_assessments', 'collect_evidence'],
    digitalSignature: 'Not verified — no signature evidence provided',
    changelog: [
      { version: 'v2.5.0', changes: ['Added Cyber Resilience Act (CRA) compliance maps.', 'Fully mapped FedRAMP Moderate controls.'] }
    ],
    documentation: 'Maps software postures and evidence to multiple global compliance standards, tracking gaps and managing remediation checklists.',
    reviews: [
      { author: 'Auditor_Dave', rating: 5, text: 'Halved our audit prep time.' }
    ],
    subExtensions: [
      { id: 'soc2', label: 'SOC 2 Core Mapper', desc: 'Pre-mapped security trust principles checks.' },
      { id: 'iso27001', label: 'ISO/IEC 27001 standard', desc: 'Checks directory for ISMS structures.' },
      { id: 'nist', label: 'NIST SP 800-53', desc: 'Federal security control auditing checklists.' },
      { id: 'cis', label: 'CIS Benchmarks', desc: 'System level configurations verification rules.' },
      { id: 'gdpr', label: 'GDPR Privacy Controls', desc: 'Ensures data protection policies & encryption rules.' },
      { id: 'hipaa', label: 'HIPAA Health Security', desc: 'PHI access logging, authentication and audit controls.' },
      { id: 'pci-dss', label: 'PCI DSS Finance', desc: 'Credit card transaction and transmission security rules.' },
      { id: 'fedramp', label: 'FedRAMP Authorization', desc: 'Checklists mapping to federal cloud security specifications.' },
      { id: 'dora', label: 'DORA Resiliency', desc: 'Digital Operational Resilience compliance metrics.' },
      { id: 'cra', label: 'Cyber Resilience Act (CRA)', desc: 'European product security standards compliance.' },
      { id: 'compliance-dash', label: 'Compliance Dashboard', desc: 'Aggregated progress across all mapped standards.' },
      { id: 'evidence-mapping', label: 'Evidence Mapping Daemon', desc: 'Auto-maps scanned outputs to control guidelines.' }
    ]
  },
  {
    id: 'evidence',
    name: 'Immutable Evidence Ledger',
    version: 'v1.3.4',
    publisher: 'spr.evidence.vault',
    category: 'Compliance & Frameworks',
    description: 'Immutable ledger vaults, SHA-256 artifact hashing, and secure chain-of-custody controls.',
    installs: '720K',
    rating: 4.7,
    icon: Lock,
    iconColor: 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20',
    dependencies: ['identity'],
    permissions: ['write_ledger', 'verify_hashes', 'read_evidence_vault'],
    digitalSignature: 'Not verified — no signature evidence provided',
    changelog: [
      { version: 'v1.3.4', changes: ['Upgraded evidence compression algorithms.', 'Added block validation hooks.'] }
    ],
    documentation: 'Saves software evidence and compliance checks onto an immutable, verifiable local or cloud blockchain ledger to guarantee non-repudiation during audits.',
    reviews: [],
    subExtensions: [
      { id: 'evidence-vault', label: 'Evidence Vault', desc: 'Secure local storage directory with zero-knowledge encryption.' },
      { id: 'evidence-collector', label: 'Evidence Collector', desc: 'Cron jobs that capture automated screenshot/CLI outputs.' },
      { id: 'evidence-timeline', label: 'Evidence Timeline', desc: 'Auditable trace of all collected proof objects.' },
      { id: 'evidence-validation', label: 'Evidence Validation', desc: 'Verifies evidence file content matches its blockchain hash.' },
      { id: 'evidence-hashing', label: 'Evidence Hashing', desc: 'SHA-256 compliance hashing tool.' },
      { id: 'immutable-ledger', label: 'Immutable Ledger', desc: 'Integrity checking on-chain node simulator.' },
      { id: 'audit-trail', label: 'Audit Trail Logs', desc: 'Chronological activity traces of users and integrations.' },
      { id: 'chain-of-custody', label: 'Chain of Custody', desc: 'Tracks developer sign-offs and peer reviewer ids.' }
    ]
  },
  {
    id: 'ai',
    name: 'Cognitive Trust Brain AI',
    version: 'v4.0.0',
    publisher: 'spr.ai.intelligence',
    category: 'AI & Intelligence',
    description: 'Gemini cognitive risk engine, smart remediation recommendations, and compliance chat assistant.',
    installs: '1.6M',
    rating: 5.0,
    icon: Brain,
    iconColor: 'bg-purple-500/10 text-purple-400 border border-purple-500/20',
    dependencies: ['identity', 'security', 'trust'],
    permissions: ['use_ai_model', 'access_codebase', 'generate_recommendations'],
    digitalSignature: 'Not verified — no signature evidence provided',
    changelog: [
      { version: 'v4.0.0', changes: ['Upgraded to Gemini 2.5 Flash model.', 'Added AI Root Cause Analysis engine.', 'Added interactive chat assistant.'] }
    ],
    documentation: 'Integrates secure Gemini models to analyze software risk, formulate remediation scripts, summarize audits, and act as a live compliance copilot.',
    reviews: [
      { author: 'Cto_Will', rating: 5, text: 'The chat assistant is unbelievably knowledgeable!' }
    ],
    subExtensions: [
      { id: 'ai-risk-analysis', label: 'AI Risk Analysis', desc: 'Predictive modeling of code vulnerability exploitation.' },
      { id: 'ai-recommendations', label: 'AI Recommendations', desc: 'Auto-generated code fix snippets for vulnerable dependencies.' },
      { id: 'ai-report-gen', label: 'AI Report Generator', desc: 'Synthesizes security reports into executive descriptions.' },
      { id: 'ai-exec-summary', label: 'AI Executive Summary', desc: 'One-page summaries of compliance maps for management.' },
      { id: 'ai-root-cause', label: 'AI Root Cause Analysis', desc: 'Pinpoint exactly how a vulnerability entered the pipeline.' },
      { id: 'ai-threat-detection', label: 'AI Threat Detection', desc: 'Neural anomaly scanning of build outputs.' },
      { id: 'ai-compliance-assistant', label: 'AI Compliance Assistant', desc: 'Trained guidelines chatbot for passing audits.' },
      { id: 'ai-copilot', label: 'AI Copilot Chat', desc: 'Interactive developer assistance for secure code writing.' }
    ]
  },
  {
    id: 'assets',
    name: 'Asset Registry & Relationships',
    version: 'v2.0.4',
    publisher: 'spr.assets.mgr',
    category: 'Infrastructure & Operations',
    description: 'Active servers tracking, relationship mapping, and container inventory cataloging.',
    installs: '920K',
    rating: 4.7,
    icon: Boxes,
    iconColor: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
    dependencies: ['identity'],
    permissions: ['read_assets', 'modify_assets', 'scan_network'],
    digitalSignature: 'Not verified — no signature evidence provided',
    changelog: [
      { version: 'v2.0.4', changes: ['Optimized network mapping layout.', 'Enabled bulk CSV imports.'] }
    ],
    documentation: 'Asset Management maintains an active, auditable directory of enterprise server networks, cloud infrastructure, container services, and virtual environments.',
    reviews: [],
    subExtensions: [
      { id: 'asset-inventory', label: 'Asset Inventory', desc: 'Consolidated list of servers, databases, and Docker images.' },
      { id: 'asset-discovery', label: 'Asset Discovery', desc: 'Scans network ranges to automatically register nodes.' },
      { id: 'asset-relationships', label: 'Asset Relationships', desc: 'Maps dependency linkages between software components and hardware hosts.' },
      { id: 'asset-health', label: 'Asset Health', desc: 'Gauges active uptime, vulnerability counts, and sign status.' },
      { id: 'asset-ownership', label: 'Asset Ownership', desc: 'Assigns sysadmin team contacts to hardware nodes.' },
      { id: 'asset-lifecycle', label: 'Asset Lifecycle', desc: 'Tracks systems from provisioning through end-of-life decommission.' },
      { id: 'asset-search', label: 'Asset Search', desc: 'Dynamic query parser filtering assets by sector, threat, or cluster.' },
      { id: 'asset-bulk', label: 'Bulk Actions Editor', desc: 'Modify configurations or tags of thousands of assets.' }
    ]
  },
  {
    id: 'vendors',
    name: 'Supply Chain Vendor Risk',
    version: 'v1.6.0',
    publisher: 'spr.vendor.ledger',
    category: 'Compliance & Frameworks',
    description: 'Third-party vendor registration, vendor compliance sheets, and subservice trackers.',
    installs: '780K',
    rating: 4.8,
    icon: Building2,
    iconColor: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
    dependencies: ['identity', 'compliance'],
    permissions: ['read_vendors', 'modify_vendors', 'audit_supply_chain'],
    digitalSignature: 'Not verified — no signature evidence provided',
    changelog: [
      { version: 'v1.6.0', changes: ['Added direct SBOM integration for vendor imports.'] }
    ],
    documentation: 'Tracks third-party vendor compliance postures, digital passports, and critical service levels, highlighting systemic supply-chain vulnerabilities.',
    reviews: [],
    subExtensions: [
      { id: 'vendor-registry', label: 'Vendor Registry', desc: 'Comprehensive yellow-pages database of approved software suppliers.' },
      { id: 'vendor-trust', label: 'Vendor Trust Score', desc: 'Averages vendor passport ratings into unified risk indexes.' },
      { id: 'vendor-passports', label: 'Vendor Passports Directory', desc: 'Repository of signed certificates provided by suppliers.' },
      { id: 'vendor-monitoring', label: 'Vendor Monitoring Daemon', desc: 'Tracks outages or compliance revocations.' },
      { id: 'vendor-risk', label: 'Vendor Risk Analyst', desc: 'Calculates the cascading risk of single-point vendor dependencies.' },
      { id: 'vendor-certs', label: 'Vendor Certifications', desc: 'Saves SOC2 / ISO compliance evidence submitted by vendors.' }
    ]
  },
  {
    id: 'devops',
    name: 'DevOps & Pipeline Sync',
    version: 'v2.8.0',
    publisher: 'spr.devops.sync',
    category: 'Infrastructure & Operations',
    description: 'Integrations with GitHub Actions, GitLab CI, Jenkins, and Kubernetes deployment locks.',
    installs: '1.8M',
    rating: 4.9,
    icon: Workflow,
    iconColor: 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20',
    dependencies: ['identity', 'passport'],
    permissions: ['read_pipelines', 'trigger_builds', 'manage_webhooks', 'k8s_access'],
    digitalSignature: 'Not verified — no signature evidence provided',
    changelog: [
      { version: 'v2.8.0', changes: ['Added ArgoCD deployment sync verification.', 'Enhanced Kubernetes admission webhook handler.'] }
    ],
    documentation: 'Connects security passports directly to developer toolchains to block unsigned, vulnerable, or non-compliant artifacts at deployment build stage.',
    reviews: [
      { author: 'PipelineMaster', rating: 5, text: 'The GitHub action block works incredibly well!' }
    ],
    subExtensions: [
      { id: 'github', label: 'GitHub Integrator', desc: 'Connects to GitHub repositories, release tags, and check runs.' },
      { id: 'gitlab', label: 'GitLab Sync Engine', desc: 'Listens to GitLab CI pipeline events and merges.' },
      { id: 'azure-devops', label: 'Azure DevOps Boards', desc: 'Enforces work item policy check validations.' },
      { id: 'bitbucket', label: 'Bitbucket Pipelines', desc: 'Saves build metrics from Bitbucket cloud runs.' },
      { id: 'jenkins', label: 'Jenkins CI Adapter', desc: 'Verifies builds inside legacy Jenkins servers.' },
      { id: 'circleci', label: 'CircleCI Orbs Manager', desc: 'Provides ready-to-use CircleCI Orbs.' },
      { id: 'docker', label: 'Docker Registry Signer', desc: 'Cosign-based signing of Docker container images.' },
      { id: 'kubernetes', label: 'Kubernetes Admission Webhook', desc: 'Refuses pods without valid Software Passports.' },
      { id: 'terraform', label: 'Terraform State Scanner', desc: 'Inspects HCL code for cloud security gaps.' },
      { id: 'argocd', label: 'ArgoCD Sync Guard', desc: 'Binds GitOps deployments to verified trust gates.' }
    ]
  },
  {
    id: 'cloud',
    name: 'Multi-Cloud Infrastructure Control',
    version: 'v1.4.0',
    publisher: 'spr.cloud.ops',
    category: 'Infrastructure & Operations',
    description: 'Cloud posture auditing and secure verification across AWS, Azure, Google Cloud, and Cloudflare.',
    installs: '1.1M',
    rating: 4.8,
    icon: Cloud,
    iconColor: 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20',
    dependencies: ['identity', 'assets'],
    permissions: ['read_cloud_configs', 'verify_cloud_iam'],
    digitalSignature: 'Not verified — no signature evidence provided',
    changelog: [
      { version: 'v1.4.0', changes: ['Added Oracle Cloud support.', 'Enhanced Azure Active Directory policy mapper.'] }
    ],
    documentation: 'Integrates with cloud providers to map active services to asset databases, checking permissions, public firewall ports, and encryption posture.',
    reviews: [],
    subExtensions: [
      { id: 'aws', label: 'AWS Auditor', desc: 'Monitors EC2, S3, IAM, and EKS configuration profiles.' },
      { id: 'azure', label: 'Azure Active Directory Core', desc: 'Validates subscriptions and Entra ID permissions.' },
      { id: 'google-cloud', label: 'Google Cloud Platform Sync', desc: 'Parses Cloud Run and GKE cluster security profiles.' },
      { id: 'cloudflare', label: 'Cloudflare Edge Safeguard', desc: 'Validates proxy rules, SSL profiles, and WAF rules.' },
      { id: 'oracle-cloud', label: 'Oracle Cloud OCI', desc: 'Monitors cloud compartments configuration.' },
      { id: 'digitalocean', label: 'DigitalOcean Droplets', desc: 'Queries Droplets security firewall settings.' }
    ]
  },
  {
    id: 'monitoring',
    name: 'Trust OS Continuous Monitoring',
    version: 'v2.1.2',
    publisher: 'spr.monitoring.co',
    category: 'Infrastructure & Operations',
    description: 'System health check logs, real-time metrics charts, and immediate risk-drop alert notifications.',
    installs: '1.5M',
    rating: 4.9,
    icon: Cpu,
    iconColor: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
    dependencies: ['identity', 'security'],
    permissions: ['read_metrics', 'push_alerts', 'read_logs'],
    digitalSignature: 'Not verified — no signature evidence provided',
    changelog: [
      { version: 'v2.1.2', changes: ['Optimized telemetry charts.', 'Added slack webhook alerts.'] }
    ],
    documentation: 'Monitors continuous logs, active scanner daemons, and system health. Fires urgent alerts to pager services if trust indexes drop below compliance thresholds.',
    reviews: [],
    subExtensions: [
      { id: 'logs', label: 'Logs Collector Daemon', desc: 'Parses system security logs.' },
      { id: 'metrics', label: 'Real-Time Metrics Provider', desc: 'Provides memory, cpu, and scanner rate data.' },
      { id: 'traces', label: 'Cryptographic Signature Traces', desc: 'Inspects call chains of passport signatures.' },
      { id: 'alerts', label: 'Incident Alerts Router', desc: 'Dispatches Slack, Teams, and Webhook alerts.' },
      { id: 'dashboards', label: 'SLA Dashboard Compiler', desc: 'Precompiled visual health graphics.' },
      { id: 'health-checks', label: 'Endpoint Health Probes', desc: 'Periodic ping routines to verification gates.' },
      { id: 'incidents', label: 'Incident History Repository', desc: 'Remediation logs of historical security breach alerts.' }
    ]
  },
  {
    id: 'reporting',
    name: 'Executive Report Compiler',
    version: 'v2.0.1',
    publisher: 'spr.reports.inc',
    category: 'Data & Reports',
    description: 'Executive SOC2 compliance summaries, audit timelines, and PDF/Excel exporting.',
    installs: '1.3M',
    rating: 4.8,
    icon: FileText,
    iconColor: 'bg-teal-500/10 text-teal-400 border border-teal-500/20',
    dependencies: ['identity', 'compliance', 'evidence'],
    permissions: ['compile_reports', 'export_files', 'read_all_data'],
    digitalSignature: 'Not verified — no signature evidence provided',
    changelog: [
      { version: 'v2.0.1', changes: ['Added compliance chart renderings to PDF exports.', 'Added multi-select bulk report generation.'] }
    ],
    documentation: 'Synthesizes logs, passports, compliance mappings, and trust score timelines into elegant, audit-ready PDF, Excel, or CSV executive digests.',
    reviews: [
      { author: 'Auditor_Sam', rating: 5, text: 'Great templates, clean formatting!' }
    ],
    subExtensions: [
      { id: 'exec-reports', label: 'Executive Summaries', desc: 'High-level business-focused posture reports.' },
      { id: 'compliance-reports', label: 'Compliance Reports', desc: 'SOC2, ISO, and NIST gap analyses.' },
      { id: 'security-reports', label: 'Security Reports', desc: 'CVE mitigation logs and container audit histories.' },
      { id: 'audit-reports', label: 'Audit Trail Reports', desc: 'System-wide activity ledger spreadsheet dumps.' },
      { id: 'trust-reports', label: 'Trust Score Trends', desc: 'Score fluctuations over time with trend lines.' },
      { id: 'risk-reports', label: 'Vendor Risk Reports', desc: 'Supply-chain dependency threat levels analyses.' },
      { id: 'pdf-export', label: 'PDF Export Core', desc: 'Renders custom branded reports to PDF files.' },
      { id: 'excel-export', label: 'Excel/CSV Ledger Export', desc: 'Exports structured data sheets.' }
    ]
  }
];
