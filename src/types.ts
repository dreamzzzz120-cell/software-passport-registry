/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type Severity = 'Critical' | 'High' | 'Medium' | 'Low';
export type RiskLevel = 'Critical' | 'High' | 'Medium' | 'Low' | 'Safe' | 'Unknown';
export type ScanStatus = 'Success' | 'Failed' | 'Scanning' | 'scan target not yet instrumented';
export type AlertStatus = 'Active' | 'Snoozed' | 'Resolved';

export interface SoftwareComponent {
  name: string;
  version: string;
  license: string;
  purl: string;
  depth: number;
  dependencyType: 'Direct' | 'Transitive';
  trustLevel: 'Trusted' | 'Review Required' | 'Blocked';
}

export interface Vulnerability {
  id: string; // e.g., CVE-2024-1234
  title: string;
  severity: Severity;
  cvss: number;
  component: string;
  fixedVersion: string;
  publishedDate: string;
  status: 'Open' | 'Mitigated' | 'Resolved' | 'Snoozed';
  description: string;
  mitigationPlan?: string;
  mitigationOwner?: string;
  mitigationTargetDate?: string;
}

// Controlled vocabulary for evidence status — never a bare boolean.
// VERIFIED / PARTIALLY_VERIFIED may only be set by server-side verification logic
// that also supplies checksum + chainOfCustody + verifierEngineId + verifiedAt.
// Client-submitted evidence starts at DECLARED (or CONFIGURED/OBSERVED) until an
// actual verification engine independently checks it.
export type EvidenceStatus =
  | 'VERIFIED'            // Independently checked by a real verification engine; checksum + chain of custody on file
  | 'PARTIALLY_VERIFIED'  // Some but not all claims in this evidence item were independently checked
  | 'DECLARED'            // Submitted by a user/customer; not independently checked
  | 'CONFIGURED'          // Reflects a configuration setting, not a checked fact
  | 'OBSERVED'            // Captured by an automated collector without an independent verification step
  | 'FAILED'              // A verification attempt was made and it failed — see failureReason
  | 'UNKNOWN'             // Status has not been determined
  | 'STALE'               // Was verified previously but the verification has expired / needs refresh
  | 'SOURCE_DISCONNECTED' // The upstream evidence source is no longer reachable
  | 'NOT_APPLICABLE';     // This evidence type does not apply to this asset

export interface EvidenceChainOfCustodyStep {
  step: string;      // e.g. 'collected', 'hashed', 'signature-checked'
  actor: string;      // engine id or user email that performed this step
  timestamp: string;
}

export interface EvidenceItem {
  id: string;
  name: string;
  type: 'Signature' | 'Audit Report' | 'Build Log' | 'Security Scan' | 'Attestation';
  status: EvidenceStatus;
  signer: string;
  timestamp: string;
  hash: string;
  // Required whenever status is VERIFIED or PARTIALLY_VERIFIED — see validateBody(evidenceItemSchema)
  // in src/middleware/validation.ts, which enforces this server-side.
  checksum?: string;
  chainOfCustody?: EvidenceChainOfCustodyStep[];
  verifierEngineId?: string;
  verifiedAt?: string;
  // Required whenever status is FAILED
  failureReason?: string;
}

export interface SoftwarePassport {
  id: string;
  name: string;
  version: string;
  publisher: string;
  category: string;
  overallScore: number;
  securityScore: number;
  complianceScore: number;
  vendorReputationScore: number;
  releaseDate: string;
  fileHash: string;
  licenseType: string;
  aiSummary: string;
  sbom: SoftwareComponent[];
  evidence: EvidenceItem[];
  vulnerabilities: Vulnerability[];
  timeline: {
    date: string;
    event: string;
    user: string;
    details: string;
  }[];
}

export interface ComplianceStandard {
  id: string;
  name: string;
  code: 'SOC2' | 'ISO27001' | 'HIPAA' | 'NIST' | 'CIS';
  progress: number; // 0 to 100
  compliantControls: number;
  totalControls: number;
  status: 'Compliant' | 'In Progress' | 'Attention Required';
}

export interface TeamMember {
  name: string;
  role: string;
  email: string;
  avatar: string;
}

export interface ActivityLog {
  id: string;
  timestamp: string;
  eventType: 'Passport Created' | 'Vulnerability Discovered' | 'Scan Completed' | 'Compliance Approved' | 'Client Onboarded' | 'Integration Synced';
  description: string;
  user: string;
  severity: Severity | 'Info';
}

export interface Client {
  id: string;
  name: string;
  domain: string;
  industry: string;
  trustScore: number;
  riskLevel: RiskLevel;
  avatarColor: string;
  subscriptionTier: 'Standard' | 'Enterprise' | 'Premium';
  joinedDate: string;
  teamCount: number;
  passportCount: number;
  criticalRisksCount: number;
  complianceProgress: number; // 0 to 100
  softwareInventory: {
    passportId: string;
    name: string;
    version: string;
    overallScore: number;
    riskStatus: 'Safe' | 'Warning' | 'Critical';
    lastScanDate: string;
  }[];
  complianceStatus: ComplianceStandard[];
  teamMembers: TeamMember[];
  activityTimeline: ActivityLog[];
}

export interface VendorAudit {
  id: string;
  date: string;
  auditType: string;
  status: 'Passed' | 'Failed' | 'Under Review';
  details: string;
  auditor: string;
  referenceHash: string;
}

export interface Vendor {
  id: string;
  name: string;
  riskTier: RiskLevel;
  overallTrustScore: number;
  category: string;
  locations: string;
  activePassportsCount: number;
  reviewStatus: 'Approved' | 'Under Review' | 'Blocked';
  securityIncidentsCount: number;
  website: string;
  lastAuditDate: string;
  reputationScore?: number;
  auditHistory?: VendorAudit[];
}

export interface Scan {
  id: string;
  targetName: string;
  scanType: 'SBOM Verify' | 'Binary Attestation' | 'Source Code Codeql' | 'Container Image' | 'Unclassified Attestation';
  triggeredBy: string;
  status: ScanStatus;
  durationMs: number;
  findingsCount: number | null;
  timestamp: string;
  clientName: string;
}

export interface Alert {
  id: string;
  title: string;
  severity: Severity;
  category: 'Vulnerability' | 'Compliance Gap' | 'Unverified Attestation' | 'Policy Violation';
  clientName: string;
  description: string;
  timestamp: string;
  status: AlertStatus;
}

export interface Integration {
  id: string;
  name: string;
  category: 'SIEM' | 'MDM' | 'DevOps' | 'Chat' | 'Issue Tracker' | 'Workspace' | 'RMM' | 'PSA' | 'BDR' | 'Documentation' | 'PAM';
  icon: string;
  connected: boolean;
  description: string;
  apiKeyHint: string;
  lastSyncDate: string;
}

export interface BillingItem {
  id: string;
  clientName: string;
  activePassportsCount: number;
  pricePerPassport: number;
  extraFees: number;
  billingCycle: string;
  totalAmount: number;
  status: 'Paid' | 'Pending' | 'Overdue';
}

export interface ReportTemplate {
  id: string;
  name: string;
  type: 'Executive Summary' | 'Vulnerability Audit' | 'Compliance Attestation' | 'Supplier Risk Portfolio' | 'Acquisition Audit' | 'Commercial Certificate';
  description: string;
  frequency: 'Ad-hoc' | 'Weekly' | 'Monthly' | 'Quarterly';
}
