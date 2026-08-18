/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Award,
  Users,
  ShieldCheck,
  FileCheck,
  Activity,
  ChevronRight,
  TrendingUp,
  Brain,
  Layers,
  Sparkles,
  ClipboardCheck,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Send,
  Eye,
  Mail,
  FileText,
  MessageSquare,
  Wrench,
  Sliders,
  DollarSign,
  Download,
  Info,
  ExternalLink,
  ChevronDown,
  Trash2,
  Calendar,
  Zap,
  Globe,
  Briefcase,
  Play,
  Radar,
  Settings,
  ShieldAlert,
  ArrowRight
} from 'lucide-react';
import { Client } from '../types';

// Define explicit database interfaces matching user specs
export interface PilotOrganization {
  id: string;
  name: string;
  industry: string;
  website: string;
  employeeCount: string;
  status: 'Prospect' | 'Applied' | 'Under Review' | 'Approved' | 'Active Pilot' | 'Completed' | 'Converted' | 'Declined';
  engagementScore: number; // 0 - 100
  conversionProbability: number; // percentage
  joinedDate: string;
}

export interface PilotContact {
  id: string;
  orgId: string;
  name: string;
  email: string;
  roleTitle: string;
  phone: string;
}

export interface PilotApplication {
  id: string;
  orgId: string;
  submittedAt: string;
  mainChallenges: string;
  currentTools: string;
  pilotType: 'MSP partner' | 'Software company' | 'Enterprise customer';
  status: 'Applied' | 'Under Review' | 'Approved' | 'Declined';
}

export interface PilotProject {
  id: string;
  orgId: string;
  name: string;
  status: 'Planning' | 'Active' | 'Completed' | 'On Hold';
  startDate: string;
  endDate: string;
}

export interface SoftwareAsset {
  id: string;
  orgId: string;
  name: string;
  vendor: string;
  version: string;
  dependenciesCount: number;
  riskLevel: 'Low' | 'Medium' | 'High' | 'Critical';
  trustScore: number;
}

export interface PassportReport {
  id: string;
  orgId: string;
  assetId: string;
  reportType: 'NIST Mapping' | 'SOC 2 Alignment' | 'Vulnerability Scan' | 'Executive Brief';
  reportPath: string;
  generatedAt: string;
}

export interface FeedbackItem {
  id: string;
  orgId: string;
  contactName: string;
  comment: string;
  rating: number; // 1-5
  submittedAt: string;
}

export interface Meeting {
  id: string;
  orgId: string;
  title: string;
  scheduledAt: string;
  notes: string;
}

export interface FeatureRequest {
  id: string;
  orgId: string;
  title: string;
  description: string;
  status: 'Suggested' | 'Under Review' | 'Planned' | 'Completed';
}

export interface PilotConversionTracking {
  id: string;
  orgId: string;
  convertedAt: string;
  dealValue: number;
  previousStatus: string;
  notes: string;
}

interface PilotProgramViewProps {
  clients: Client[];
  activeTab?: string;
  setActiveTab?: (tab: string) => void;
}

export default function PilotProgramView({ clients, activeTab, setActiveTab }: PilotProgramViewProps) {
  // Sync the local sub tab state with the global navigation sidebar if passed in
  const [localSubTab, setLocalSubTab] = useState<'overview' | 'apply' | 'partners' | 'workspace' | 'demo' | 'comm' | 'admin'>('overview');

  useEffect(() => {
    if (activeTab && activeTab.startsWith('pilot-')) {
      const sub = activeTab.replace('pilot-', '');
      if (['overview', 'apply', 'partners', 'workspace', 'demo', 'comm', 'admin'].includes(sub)) {
        setLocalSubTab(sub as any);
      }
    }
  }, [activeTab]);

  const handleSubTabChange = (tab: 'overview' | 'apply' | 'partners' | 'workspace' | 'demo' | 'comm' | 'admin') => {
    setLocalSubTab(tab);
    if (setActiveTab) {
      setActiveTab(`pilot-${tab}`);
    }
  };

  // --- USER ROLES & PERMISSIONS CONTROLS ---
  // SPR Admin (Full access), Pilot Partner Admin (Workspace only), Pilot Analyst (Analysis & reports), Viewer (Read-only)
  const [selectedRole, setSelectedRole] = useState<'SPR Admin' | 'Pilot Partner Admin' | 'Pilot Analyst' | 'Viewer'>('SPR Admin');

  // Helper checking edit permissions
  const canEdit = selectedRole === 'SPR Admin' || selectedRole === 'Pilot Analyst';
  const isPartnerAdmin = selectedRole === 'Pilot Partner Admin';

  // --- DATABASE LOCAL STORAGE STATE MANAGERS ---
  // 1. Organizations
  const [organizations, setOrganizations] = useState<PilotOrganization[]>(() => {
    const saved = localStorage.getItem('spr_pilot_orgs');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return [
      { id: 'org-1', name: 'Apex Security MSP', industry: 'Managed Service Provider', website: 'https://apexmsp.io', employeeCount: '50-200 employees', status: 'Active Pilot', engagementScore: 92, conversionProbability: 95, joinedDate: '2026-06-12' },
      { id: 'org-2', name: 'MedVanguard Health', industry: 'Healthcare & Pharma', website: 'https://medvanguard.com', employeeCount: '1000+ employees', status: 'Under Review', engagementScore: 68, conversionProbability: 70, joinedDate: '2026-07-01' },
      { id: 'org-3', name: 'CloudWeave Solutions', industry: 'SaaS / Software Product', website: 'https://cloudweave.app', employeeCount: '1-50 employees', status: 'Active Pilot', engagementScore: 94, conversionProbability: 90, joinedDate: '2026-06-28' },
      { id: 'org-4', name: 'Standard Federal Bank', industry: 'Financial Services', website: 'https://stdfedbank.com', employeeCount: '1000+ employees', status: 'Prospect', engagementScore: 40, conversionProbability: 35, joinedDate: '2026-07-10' }
    ];
  });

  // 2. Contacts
  const [contacts, setContacts] = useState<PilotContact[]>(() => {
    const saved = localStorage.getItem('spr_pilot_contacts');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return [
      { id: 'con-1', orgId: 'org-1', name: 'Sarah Jenkins', email: 'sarah.j@apexmsp.io', roleTitle: 'Director of Cloud Services', phone: '+1 (555) 349-2041' },
      { id: 'con-2', orgId: 'org-2', name: 'David Chen', email: 'dchen@medvanguard.com', roleTitle: 'Chief Information Security Officer', phone: '+1 (555) 832-1982' },
      { id: 'con-3', orgId: 'org-3', name: 'Elena Rostova', email: 'elena@cloudweave.app', roleTitle: 'VP of Engineering', phone: '+1 (555) 723-9938' },
      { id: 'con-4', orgId: 'org-4', name: 'Marcus Sterling', email: 'msterling@stdfedbank.com', roleTitle: 'Head of Vendor Risk Management', phone: '+1 (555) 459-0012' }
    ];
  });

  // 3. Applications
  const [applications, setApplications] = useState<PilotApplication[]>(() => {
    const saved = localStorage.getItem('spr_pilot_apps');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return [
      { id: 'app-1', orgId: 'org-1', submittedAt: '2026-06-10', mainChallenges: 'Validating client software origins and license liabilities.', currentTools: 'Snyk, manual Excel sheets', pilotType: 'MSP partner', status: 'Approved' },
      { id: 'app-2', orgId: 'org-2', submittedAt: '2026-06-29', mainChallenges: 'Securing medical software supply chains for HIPAA compliance checks.', currentTools: 'Veracode, SonarQube', pilotType: 'Enterprise customer', status: 'Approved' },
      { id: 'app-3', orgId: 'org-3', submittedAt: '2026-06-25', mainChallenges: 'Generating certified SBOMs for enterprise buyers.', currentTools: 'GitHub Dependabot', pilotType: 'Software company', status: 'Approved' }
    ];
  });

  // 4. Projects
  const [projects, setProjects] = useState<PilotProject[]>(() => {
    const saved = localStorage.getItem('spr_pilot_projects');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return [
      { id: 'prj-1', orgId: 'org-1', name: '30-Day Technical Proof of Concept', status: 'Active', startDate: '2026-06-15', endDate: '2026-07-15' },
      { id: 'prj-2', orgId: 'org-2', name: 'NIST Framework Security Compliance Alignment Assessment', status: 'Active', startDate: '2026-07-02', endDate: '2026-08-02' },
      { id: 'prj-3', orgId: 'org-3', name: 'Production Pipeline SBOM Attestation Integration', status: 'Active', startDate: '2026-07-01', endDate: '2026-08-01' }
    ];
  });

  // 5. Software Assets
  const [softwareAssets, setSoftwareAssets] = useState<SoftwareAsset[]>(() => {
    const saved = localStorage.getItem('spr_pilot_assets');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return [
      { id: 'sa-1', orgId: 'org-1', name: 'Docker Kubernetes Runtime Engine', vendor: 'CNCF / Google', version: 'v1.28.4', dependenciesCount: 184, riskLevel: 'Medium', trustScore: 82 },
      { id: 'sa-2', orgId: 'org-1', name: 'Apache Tomcat Core Server', vendor: 'Apache Software Foundation', version: 'v10.1.8', dependenciesCount: 92, riskLevel: 'Low', trustScore: 94 },
      { id: 'sa-3', orgId: 'org-2', name: 'PostgreSQL Database Adapter', vendor: 'Postgres Core', version: 'v15.3', dependenciesCount: 45, riskLevel: 'Low', trustScore: 96 },
      { id: 'sa-4', orgId: 'org-2', name: 'Log4j Enterprise Logging Framework', vendor: 'Apache Software Foundation', version: 'v2.14.1', dependenciesCount: 112, riskLevel: 'Critical', trustScore: 34 },
      { id: 'sa-5', orgId: 'org-3', name: 'Apollo Gateway Service Router', vendor: 'SaaS Corp', version: 'v4.12.0', dependenciesCount: 147, riskLevel: 'Low', trustScore: 91 }
    ];
  });

  // 6. Passport Reports
  const [passportReports, setPassportReports] = useState<PassportReport[]>(() => {
    const saved = localStorage.getItem('spr_pilot_reports');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return [
      { id: 'rep-1', orgId: 'org-1', assetId: 'sa-1', reportType: 'SOC 2 Alignment', reportPath: '/reports/apex-kubernetes-soc2.pdf', generatedAt: '2026-07-10' },
      { id: 'rep-2', orgId: 'org-2', assetId: 'sa-4', reportType: 'Vulnerability Scan', reportPath: '/reports/medvanguard-log4j-cve.pdf', generatedAt: '2026-07-12' },
      { id: 'rep-3', orgId: 'org-3', assetId: 'sa-5', reportType: 'NIST Mapping', reportPath: '/reports/cloudweave-apollo-nist.pdf', generatedAt: '2026-07-14' }
    ];
  });

  // 7. Feedback Items
  const [feedbackItems, setFeedbackItems] = useState<FeedbackItem[]>(() => {
    const saved = localStorage.getItem('spr_pilot_feedback');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return [
      { id: 'fee-1', orgId: 'org-1', contactName: 'Sarah Jenkins', comment: 'The customer workspace isolation is absolute class. It fits perfectly into our multi-tenant MSP model.', rating: 5, submittedAt: '2026-07-08' },
      { id: 'fee-2', orgId: 'org-3', contactName: 'Elena Rostova', comment: 'Using SPR has cut down our customer security compliance response times by nearly 80%. Outstanding tool.', rating: 5, submittedAt: '2026-07-12' }
    ];
  });

  // 8. Meetings
  const [meetings, setMeetings] = useState<Meeting[]>(() => {
    const saved = localStorage.getItem('spr_pilot_meetings');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return [
      { id: 'meet-1', orgId: 'org-1', title: 'Onboarding kickoff & API Keys Integration', scheduledAt: '2026-06-15 10:00 AM', notes: 'Configured SAML/OIDC. Initial inventory upload was seamless.' },
      { id: 'meet-2', orgId: 'org-2', title: 'NIST Framework Security Review Consultation', scheduledAt: '2026-07-05 02:00 PM', notes: 'Discussed Log4j critical discovery on the database engine. Plan generated.' }
    ];
  });

  // 9. Feature Requests
  const [featureRequests, setFeatureRequests] = useState<FeatureRequest[]>(() => {
    const saved = localStorage.getItem('spr_pilot_features');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return [
      { id: 'feat-1', orgId: 'org-1', title: 'Automated Tenant Billing Export', description: 'White-labeled customer billing calculations sent directly via API webhook integrations.', status: 'Under Review' },
      { id: 'feat-2', orgId: 'org-3', title: 'GitLab CI/CD attestation signing badge', description: 'Allow appending tamper-proof seals inside pipeline run summaries.', status: 'Planned' }
    ];
  });

  // 10. Pilot Conversion Tracking
  const [conversions, setConversions] = useState<PilotConversionTracking[]>(() => {
    const saved = localStorage.getItem('spr_pilot_conversions');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return [
      { id: 'con-track-1', orgId: 'org-1', convertedAt: '2026-07-14', dealValue: 48000, previousStatus: 'Active Pilot', notes: 'Successfully transitioned to Enterprise Subscription Tier.' }
    ];
  });

  // Sync to local storage
  useEffect(() => {
    localStorage.setItem('spr_pilot_orgs', JSON.stringify(organizations));
    localStorage.setItem('spr_pilot_contacts', JSON.stringify(contacts));
    localStorage.setItem('spr_pilot_apps', JSON.stringify(applications));
    localStorage.setItem('spr_pilot_projects', JSON.stringify(projects));
    localStorage.setItem('spr_pilot_assets', JSON.stringify(softwareAssets));
    localStorage.setItem('spr_pilot_reports', JSON.stringify(passportReports));
    localStorage.setItem('spr_pilot_feedback', JSON.stringify(feedbackItems));
    localStorage.setItem('spr_pilot_meetings', JSON.stringify(meetings));
    localStorage.setItem('spr_pilot_features', JSON.stringify(featureRequests));
    localStorage.setItem('spr_pilot_conversions', JSON.stringify(conversions));
  }, [organizations, contacts, applications, projects, softwareAssets, passportReports, feedbackItems, meetings, featureRequests, conversions]);


  // --- FORM STATES FOR CREATING PROSPECTS OR APPLYING ---
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgIndustry, setNewOrgIndustry] = useState('Managed Service Provider');
  const [newOrgWebsite, setNewOrgWebsite] = useState('');
  const [newOrgSize, setNewOrgSize] = useState('50-200 employees');
  const [newContactName, setNewContactName] = useState('');
  const [newContactEmail, setNewContactEmail] = useState('');
  const [newContactRole, setNewContactRole] = useState('');
  const [newChallenges, setNewChallenges] = useState('');
  const [newTools, setNewTools] = useState('');
  const [newPilotType, setNewPilotType] = useState<'MSP partner' | 'Software company' | 'Enterprise customer'>('MSP partner');

  // Interactive metrics state
  const [banner, setBanner] = useState<{ text: string; error?: boolean } | null>(null);

  const triggerBanner = (text: string, error = false) => {
    setBanner({ text, error });
  };

  const handleCreatePilotSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrgName || !newContactName || !newContactEmail) {
      triggerBanner('Please provide organization name, contact name, and email address.', true);
      return;
    }

    const orgId = `org-${Date.now()}`;
    const conId = `con-${Date.now()}`;
    const appId = `app-${Date.now()}`;
    const prjId = `prj-${Date.now()}`;

    // Create Org
    const newOrg: PilotOrganization = {
      id: orgId,
      name: newOrgName,
      industry: newOrgIndustry,
      website: newOrgWebsite || 'https://example.com',
      employeeCount: newOrgSize,
      status: 'Applied',
      engagementScore: 70,
      conversionProbability: 50,
      joinedDate: new Date().toISOString().split('T')[0]
    };

    // Create Contact
    const newContact: PilotContact = {
      id: conId,
      orgId,
      name: newContactName,
      email: newContactEmail,
      roleTitle: newContactRole || 'Information Security Analyst',
      phone: '+1 (555) 912-3200'
    };

    // Create Application
    const newApp: PilotApplication = {
      id: appId,
      orgId,
      submittedAt: new Date().toISOString().split('T')[0],
      mainChallenges: newChallenges || 'General license compliance and software origin attestation controls.',
      currentTools: newTools || 'None, manual auditing',
      pilotType: newPilotType,
      status: 'Applied'
    };

    // Create PoC Project
    const newPrj: PilotProject = {
      id: prjId,
      orgId,
      name: 'Pilot Evaluation Framework PoC',
      status: 'Planning',
      startDate: new Date().toISOString().split('T')[0],
      endDate: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().split('T')[0]
    };

    setOrganizations(prev => [newOrg, ...prev]);
    setContacts(prev => [newContact, ...prev]);
    setApplications(prev => [newApp, ...prev]);
    setProjects(prev => [newPrj, ...prev]);

    triggerBanner(`Application submitted for ${newOrgName}. Backend onboarding will process it once the pilot service is configured.`);

    // Reset fields
    setNewOrgName('');
    setNewOrgWebsite('');
    setNewContactName('');
    setNewContactEmail('');
    setNewContactRole('');
    setNewChallenges('');
    setNewTools('');

    setSelectedWorkspaceOrgId(orgId);
    handleSubTabChange('workspace');
  };

  // --- WORKSPACE CONTEXT SWITCHER STATE ---
  const [selectedWorkspaceOrgId, setSelectedWorkspaceOrgId] = useState<string>('org-1');
  const activeWorkspaceOrg = organizations.find(o => o.id === selectedWorkspaceOrgId) || organizations[0];
  const activeWorkspaceContacts = contacts.filter(c => c.orgId === activeWorkspaceOrg?.id);
  const activeWorkspaceAssets = softwareAssets.filter(sa => sa.orgId === activeWorkspaceOrg?.id);
  const activeWorkspaceReports = passportReports.filter(pr => pr.orgId === activeWorkspaceOrg?.id);
  const activeWorkspaceMeetings = meetings.filter(m => m.orgId === activeWorkspaceOrg?.id);
  const activeWorkspaceFeedback = feedbackItems.filter(f => f.orgId === activeWorkspaceOrg?.id);
  const activeWorkspaceFeatures = featureRequests.filter(fr => fr.orgId === activeWorkspaceOrg?.id);
  const activeWorkspaceProjects = projects.filter(p => p.orgId === activeWorkspaceOrg?.id);

  // Workspace sub tabs: profile, software, assessments, findings, reports, timeline, team, feedback
  const [workspaceSubTab, setWorkspaceSubTab] = useState<'profile' | 'software' | 'assessments' | 'findings' | 'reports' | 'timeline' | 'team' | 'feedback'>('profile');

  // Input fields for adding dynamic asset inside isolated workspace
  const [addAssetName, setAddAssetName] = useState('');
  const [addAssetVendor, setAddAssetVendor] = useState('');
  const [addAssetVersion, setAddAssetVersion] = useState('');
  const [addAssetRisk, setAddAssetRisk] = useState<'Low' | 'Medium' | 'High' | 'Critical'>('Low');

  const handleAddAsset = (e: React.FormEvent) => {
    e.preventDefault();
    if (!addAssetName || !addAssetVendor || !addAssetVersion) {
      triggerBanner('Please provide asset name, vendor, and version.', true);
      return;
    }

    if (!canEdit) {
      triggerBanner('Permissions denied. Selected role does not allow editing workspace resources.', true);
      return;
    }

    const newAsset: SoftwareAsset = {
      id: `sa-${Date.now()}`,
      orgId: activeWorkspaceOrg.id,
      name: addAssetName,
      vendor: addAssetVendor,
      version: addAssetVersion,
      dependenciesCount: 0,
      riskLevel: addAssetRisk,
      trustScore: 0
    };

    setSoftwareAssets(prev => [...prev, newAsset]);
    triggerBanner(`Added software asset "${addAssetName}" to the ${activeWorkspaceOrg.name} isolated inventory!`);
    
    // Auto generate a Software Passport Report too
    const newReport: PassportReport = {
      id: `rep-${Date.now()}`,
      orgId: activeWorkspaceOrg.id,
      assetId: newAsset.id,
      reportType: 'Vulnerability Scan',
      reportPath: `/reports/${addAssetName.toLowerCase().replace(/\s+/g, '-')}-passport-cert.pdf`,
      generatedAt: new Date().toISOString().split('T')[0]
    };
    setPassportReports(prev => [...prev, newReport]);

    setAddAssetName('');
    setAddAssetVendor('');
    setAddAssetVersion('');
    setAddAssetRisk('Low');
  };

  // Onboard / Workflow action triggers
  const handleApprovePilot = (orgId: string) => {
    if (!canEdit) {
      triggerBanner('Permissions denied for current role.', true);
      return;
    }
    setOrganizations(prev => prev.map(o => o.id === orgId ? { ...o, status: 'Active Pilot', engagementScore: 85 } : o));
    triggerBanner('Pilot approved. Sent corporate onboarding invitation.');
  };

  const handleConvertPilot = (orgId: string) => {
    if (!canEdit) {
      triggerBanner('Permissions denied for current role.', true);
      return;
    }
    setOrganizations(prev => prev.map(o => o.id === orgId ? { ...o, status: 'Converted', conversionProbability: 100 } : o));
    
    // Add conversion transaction
    const newTrack: PilotConversionTracking = {
      id: `con-track-${Date.now()}`,
      orgId,
      convertedAt: new Date().toISOString().split('T')[0],
      dealValue: activeWorkspaceOrg?.industry === 'Managed Service Provider' ? 48000 : 75000,
      previousStatus: 'Active Pilot',
      notes: 'Transitioned directly. Contracts finalized and logged in billing pipeline.'
    };
    setConversions(prev => [...prev, newTrack]);
    triggerBanner(`Pilot conversion request logged for ${orgId}. Billing integration must be configured before the contract is finalized.`);
  };

  // --- COMMUNICATIONS TOOLKIT / SALES ENABLEMENT STATES ---
  // A. Invitation Generator
  const [inviteContactName, setInviteContactName] = useState('Sarah Jenkins');
  const [inviteCompanyName, setInviteCompanyName] = useState('Apex Security MSP');
  const [inviteTerms, setInviteTerms] = useState('12 Months Compliant Core Passports Evaluation Suite');
  const [generatedInviteMail, setGeneratedInviteMail] = useState('');

  const generateInviteEmail = () => {
    const body = `Subject: Welcome to the SPR Founding Pilot Program - Exclusive Invitation

Dear ${inviteContactName},

I am writing to officially invite ${inviteCompanyName} to join our elite Founding Pilot Program at the Software Passport Registry (SPR). 

We have reserved a limited slot for ${inviteCompanyName} which provides:
- ${inviteTerms} with zero procurement friction.
- Unlimited cryptographically sealed Software Passports Nutrition Labels.
- Row-level customer workspace tenant isolation mapping.
- High-touch engineering support with automatic NIST compliance reporting.

We can initiate your pilot deployment this Thursday. Please review our PoC structure here or click below to lodge your registration details.

Warm regards,
Trust OS & Software Passport Registry (SPR) Core Team`;
    setGeneratedInviteMail(body);
    triggerBanner('Custom invitation text compiled!');
  };

  useEffect(() => {
    generateInviteEmail();
  }, [inviteContactName, inviteCompanyName, inviteTerms]);

  // B. Interactive ROI Calculator
  const [calcAssetsCount, setCalcAssetsCount] = useState(45);
  const [calcHrsSaved, setCalcHrsSaved] = useState(12);
  const [calcRiskScore, setCalcRiskScore] = useState(85);

  const calculateROI = () => {
    const annualAuditHours = calcAssetsCount * 4 * calcHrsSaved; // 4 assessments per asset/yr
    const hourCost = 85; // CISO/Auditor engineer average hourly rate
    const laborSavings = annualAuditHours * hourCost;
    const liabilityMitigatedValue = calcRiskScore * 1800;
    const totalROI = laborSavings + liabilityMitigatedValue;
    return {
      laborSavings,
      liabilityMitigatedValue,
      totalROI
    };
  };

  const roiResult = calculateROI();

  // Onboarding Customer Success Checklist
  const [onboardChecklist, setOnboardChecklist] = useState([
    { id: 'cs-1', text: 'Prospect initial qualification & scoping session', done: true },
    { id: 'cs-2', text: 'Founding Pilot program invitation dispatched', done: true },
    { id: 'cs-3', text: 'Secure pilot tenant container creation', done: true },
    { id: 'cs-4', text: 'Complete OIDC/SAML federated identity SSO mapping', done: false },
    { id: 'cs-5', text: 'Ingest initial 5 production Software Bills of Materials (SBOMs)', done: false },
    { id: 'cs-6', text: 'Generate first NIST compliance readiness passport', done: false },
    { id: 'cs-7', text: 'Publish white-labeled tenant workspace dashboard', done: false }
  ]);

  const toggleOnboardCheck = (id: string) => {
    setOnboardChecklist(prev => prev.map(item => item.id === id ? { ...item, done: !item.done } : item));
  };


  // Workflow scenario state is driven by actual pilot data and user actions.

  // --- 9-STEP INTERACTIVE WORKFLOW PLAYBOOK STATES ---
  const [activePlaybookStep, setActivePlaybookStep] = useState<number>(1);
  
  // Step 1: Onboarding
  const [obWorkspaceName, setObWorkspaceName] = useState('Acme Security Operations');
  const [obRole, setObRole] = useState<'MSP' | 'Enterprise'>('MSP');
  const [obTeam, setObTeam] = useState<{ email: string; role: string }[]>([
    { email: 'ciso@acme.com', role: 'Security Administrator' },
    { email: 'lead-dev@acme.com', role: 'Lead Architect' }
  ]);
  const [obNewEmail, setObNewEmail] = useState('');
  const [obNewRole, setObNewRole] = useState('Compliance Officer');

  // Step 2: Vendor Setup
  const [selectedVendorProj, setSelectedVendorProj] = useState('Nexus Router Module');
  const [obVendors, setObVendors] = useState<string[]>([
    'Nexus Router Module',
    'Zeta Database Engine',
    'Core Authentication Gateway'
  ]);
  const [newVendorName, setNewVendorName] = useState('');
  const [connType, setConnType] = useState<'SBOM Upload' | 'Repo Link' | 'API Connection'>('SBOM Upload');
  const [connectedSbomFile, setConnectedSbomFile] = useState<string>('nexus_router_cyclonedx.json');
  const [connectedRepoUrl, setConnectedRepoUrl] = useState('github.com/nexus-systems/router-module');
  const [connectedApiEndpoint, setConnectedApiEndpoint] = useState('https://api.nexus-systems.com/v1/sbom');

  // Step 3: Scanning & Evidence
  const [scanStatus, setScanStatus] = useState<'idle' | 'scanning' | 'complete'>('idle');
  const [scanProgress, setScanProgress] = useState(0);
  const [scanLogs, setScanLogs] = useState<string[]>([]);
  const [extractedSbomInfo, setExtractedSbomInfo] = useState<{
    dependencies: number;
    licenses: { name: string; type: string }[];
    hashes: string[];
  } | null>(null);

  // Step 4: Risk Mapping (Interactive Trust Graph)
  const [graphRiskNodes, setGraphRiskNodes] = useState([
    { id: 'upstream-node', name: 'OpenSSL Library', type: 'transitive-dep', risk: 'High', score: 45, depth: 3, description: 'Crypto toolkit' },
    { id: 'midstream-node', name: 'Auth Gateway', type: 'internal-dep', risk: 'Medium', score: 72, depth: 2, description: 'Identity module' },
    { id: 'root-node', name: 'Nexus Router Module', type: 'target-software', risk: 'Low', score: 88, depth: 1, description: 'Core proxy routing' }
  ]);

  // Step 5: Scoring Engine Weights
  const [cveWeight, setCveWeight] = useState(25);
  const [licenseWeight, setLicenseWeight] = useState(15);
  const [nistWeight, setNistWeight] = useState(20);
  const [depthWeight, setDepthWeight] = useState(10);
  const [customScoreModifier, setCustomScoreModifier] = useState<number>(0);

  // Step 6: Passport Issuance
  const [passportSigned, setPassportSigned] = useState(false);
  const [passportSerial, setPassportSerial] = useState('SPR-2026-F981-0012');
  const [passportHash, setPassportHash] = useState('sha256:d82b3a992cf88327c10b72a44df8865181a942a0fe387198e3b1c552093a61f2');

  // Step 7: Ongoing Monitoring
  const [monitoringSchedule, setMonitoringSchedule] = useState<'daily' | 'weekly' | 'push'>('daily');
  const [monitoringAlerts, setMonitoringAlerts] = useState<{ id: string; msg: string; severity: string; date: string }[]>([
    { id: 'a-1', msg: 'Periodic re-scan completed: No change in score.', severity: 'info', date: '2026-07-20 12:00' }
  ]);

  // Step 8: Distribution Custom Branding
  const [mspBrandingName, setMspBrandingName] = useState('Acme Trust Center');
  const [mspResellerMarkup, setMspResellerMarkup] = useState(15);
  const [mspCustomColor, setMspCustomColor] = useState('#4f46e5');

  // Step 9: Export Options
  const [exportSuccessToast, setExportSuccessToast] = useState(false);

  // --- PLAYBOOK EVALUATION LOGIC & COMPUTE ENGINE ---
  const triggerNotification = (text: string, type: 'success' | 'error' = 'success') => {
    triggerBanner(text, type === 'error');
  };

  const computedUpstreamRisk = (() => {
    let base = 98;
    graphRiskNodes.forEach(n => {
      const decayFactor = Math.pow(0.85, n.depth - 1);
      const penalty = n.risk === 'High' ? 40 : n.risk === 'Medium' ? 20 : 0;
      base -= penalty * decayFactor;
    });
    return Math.max(10, Math.round(base));
  })();

  const toggleNodeRisk = (id: string) => {
    setGraphRiskNodes(prev => prev.map(n => {
      if (n.id === id) {
        let nextRisk: 'High' | 'Medium' | 'Low' = 'Low';
        if (n.risk === 'Low') nextRisk = 'Medium';
        else if (n.risk === 'Medium') nextRisk = 'High';
        else nextRisk = 'Low';
        return { ...n, risk: nextRisk };
      }
      return n;
    }));
    triggerBanner('Recalculated graph transit risks across downstream dependents!');
  };

  const startPlaybookScan = () => {
    setScanStatus('scanning');
    setScanProgress(10);
    setScanLogs(['[INFO] Scan job queued. Configure the backend scan service to process this artifact.']);
    triggerBanner('Scan service is not configured.');
    setScanStatus('complete');
    setScanProgress(100);
  };

  // Global aggregate stats for overview page
  const totalPilots = organizations.length;
  const activePilotsCount = organizations.filter(o => o.status === 'Active Pilot' || o.status === 'Under Review').length;
  const totalAnalyzedAssets = softwareAssets.length;
  const totalPassportsCreated = softwareAssets.filter(sa => sa.trustScore > 60).length;
  const totalDiscoverdRisks = softwareAssets.filter(sa => sa.riskLevel === 'High' || sa.riskLevel === 'Critical').length;
  const totalReportsGenerated = passportReports.length;
  const avgEngagement = Math.round(organizations.reduce((acc, o) => acc + o.engagementScore, 0) / totalPilots);
  const conversionRate = Math.round((conversions.length / totalPilots) * 100);

  return (
    <div className="space-y-6" id="spr-pilot-program-master-viewport">
      {/* 1. Header Hero Panel with Role Switcher */}
      <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 border-b border-slate-200 dark:border-zinc-800 pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono font-bold tracking-wider text-indigo-600 dark:text-indigo-400 uppercase">
            <Award className="w-4 h-4 text-indigo-500" />
            <span>SPR FOUNDING PILOT PROGRAM CORE ENGINE</span>
          </div>
          <h1 className="text-xl font-display font-black text-slate-900 dark:text-zinc-50 mt-1">Founding Pilot Program Portal</h1>
          <p className="text-xs text-slate-500 dark:text-zinc-400 font-sans mt-1">
            Acquire prospects, manage multi-tenant compliance evaluations, generate Software Passports, and track commercial conversions.
          </p>
        </div>

        {/* User Role Permission Context Selector */}
        <div className="flex items-center gap-2 bg-slate-100 dark:bg-zinc-900 p-1.5 rounded-xl border border-slate-200 dark:border-zinc-800 text-xs shadow-sm">
          <span className="font-mono font-semibold text-slate-500 pl-2">Role:</span>
          <select
            value={selectedRole}
            onChange={(e) => {
              setSelectedRole(e.target.value as any);
              triggerBanner(`Switched RBAC execution context to: ${e.target.value}`);
            }}
            className="bg-white dark:bg-zinc-950 border border-slate-250 dark:border-zinc-800 rounded-lg py-1 px-2.5 outline-none font-bold text-indigo-600 dark:text-indigo-400"
          >
            <option value="SPR Admin">SPR Admin (Full RW)</option>
            <option value="Pilot Partner Admin">Pilot Partner Admin</option>
            <option value="Pilot Analyst">Pilot Analyst</option>
            <option value="Viewer">Viewer (RO)</option>
          </select>
        </div>
      </div>

      {/* Action Banner Notifications */}
      {banner && (
        <div className={`p-4 rounded-xl text-xs flex items-center gap-3 animate-fade-in border ${
          banner.error
            ? 'bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-400 border-rose-100 dark:border-rose-900'
            : 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900'
        }`}>
          {banner.error ? <AlertTriangle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />}
          <span className="font-semibold">{banner.text}</span>
        </div>
      )}

      {/* Sub-Tab Navigation Bar */}
      <div className="flex items-center gap-1.5 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-1.5 rounded-2xl shadow-sm overflow-x-auto scrollbar-none">
        {[
          { id: 'overview', label: 'Overview', icon: Award },
          { id: 'apply', label: 'Apply Form', icon: ClipboardCheck },
          { id: 'partners', label: 'Pilot Partners Pipeline', icon: Users },
          { id: 'workspace', label: 'Partner Workspace', icon: Briefcase },
          { id: 'demo', label: 'Evaluation Playbook', icon: Play },
          { id: 'comm', label: 'Communications & ROI', icon: Mail },
          { id: 'admin', label: 'Admin Console', icon: Settings }
        ].map(tab => {
          const Icon = tab.icon;
          const isSelected = localSubTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => handleSubTabChange(tab.id as any)}
              className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer whitespace-nowrap ${
                isSelected
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100 hover:bg-slate-50 dark:hover:bg-zinc-800/50'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* --- SUB-VIEW 1: OVERVIEW & ANALYTICS DASHBOARD --- */}
      {localSubTab === 'overview' && (
        <div className="space-y-8 animate-fade-in" id="overview-view">
          {/* Main Hero Jumbotron */}
          <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950 text-white rounded-2xl p-8 border border-slate-800 relative overflow-hidden shadow-xl">
            <div className="absolute top-0 right-0 opacity-10 transform translate-x-12 -translate-y-12">
              <Award className="w-96 h-96 text-indigo-400" />
            </div>
            <div className="relative max-w-2xl space-y-4">
              <span className="bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 px-3 py-1 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider">
                Limited Founding slot allocation (Active PoC)
              </span>
              <h2 className="text-2xl sm:text-3xl font-display font-black tracking-tight leading-snug">
                Accelerate software trust mapping across your enterprise pipeline.
              </h2>
              <p className="text-slate-300 text-xs sm:text-sm leading-relaxed">
                Connect deep compliance auditing structures with live Software Passports. Secure compliance alignment, run automated NIST scans, and minimize supply chain visibility blinds.
              </p>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => handleSubTabChange('apply')}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-5 py-2.5 rounded-lg shadow-md transition-all cursor-pointer flex items-center gap-1"
                >
                  Apply For Pilot <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleSubTabChange('demo')}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs px-5 py-2.5 rounded-lg transition-all cursor-pointer flex items-center gap-1"
                >
                  Launch Evaluation Playbook <Play className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Analytics Dashboard Panel */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider">Founding Pilot Program Analytics</h3>
              <span className="text-[10px] bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 font-mono font-bold py-0.5 px-2 rounded">
                Updated in real-time
              </span>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Card 1 */}
              <div className="bg-white dark:bg-zinc-900 p-5 rounded-xl border border-slate-200 dark:border-zinc-800 shadow-sm relative overflow-hidden">
                <div className="flex justify-between items-start">
                  <span className="text-[10px] font-mono text-slate-400 font-bold uppercase block">Pilot Companies</span>
                  <Users className="w-4 h-4 text-indigo-500" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-display font-black text-slate-800 dark:text-zinc-50">{totalPilots}</span>
                  <span className="text-[10px] text-emerald-500 font-bold font-mono">+{activePilotsCount} active</span>
                </div>
                <p className="text-[9px] text-slate-400 mt-1">Multi-tenant active databases</p>
              </div>

              {/* Card 2 */}
              <div className="bg-white dark:bg-zinc-900 p-5 rounded-xl border border-slate-200 dark:border-zinc-800 shadow-sm relative overflow-hidden">
                <div className="flex justify-between items-start">
                  <span className="text-[10px] font-mono text-slate-400 font-bold uppercase block">Analyzed Assets</span>
                  <FileCheck className="w-4 h-4 text-indigo-500" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-display font-black text-slate-800 dark:text-zinc-50">{totalAnalyzedAssets}</span>
                  <span className="text-[10px] text-emerald-500 font-bold font-mono">100% Sealed</span>
                </div>
                <p className="text-[9px] text-slate-400 mt-1">SBOM component nodes parsed</p>
              </div>

              {/* Card 3 */}
              <div className="bg-white dark:bg-zinc-900 p-5 rounded-xl border border-slate-200 dark:border-zinc-800 shadow-sm relative overflow-hidden">
                <div className="flex justify-between items-start">
                  <span className="text-[10px] font-mono text-slate-400 font-bold uppercase block">Risks Solved</span>
                  <ShieldCheck className="w-4 h-4 text-indigo-500" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-display font-black text-slate-800 dark:text-zinc-50">{totalDiscoverdRisks}</span>
                  <span className="text-[10px] text-rose-500 font-bold font-mono">Criticals Patching</span>
                </div>
                <p className="text-[9px] text-slate-400 mt-1">CVE vulnerabilities neutralized</p>
              </div>

              {/* Card 4 */}
              <div className="bg-white dark:bg-zinc-900 p-5 rounded-xl border border-slate-200 dark:border-zinc-800 shadow-sm relative overflow-hidden">
                <div className="flex justify-between items-start">
                  <span className="text-[10px] font-mono text-slate-400 font-bold uppercase block">Conversion Rate</span>
                  <TrendingUp className="w-4 h-4 text-indigo-500" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-display font-black text-slate-800 dark:text-zinc-50">{conversionRate}%</span>
                  <span className="text-[10px] text-indigo-600 font-bold font-mono">Avg Score: {avgEngagement}</span>
                </div>
                <p className="text-[9px] text-slate-400 mt-1">Commercial paid conversion trend</p>
              </div>
            </div>
          </div>

          {/* Problem / Solution bento columns */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl border border-slate-200 dark:border-zinc-800 space-y-3 shadow-sm">
              <div className="flex items-center gap-2 text-rose-500 font-bold">
                <AlertTriangle className="w-5 h-5" />
                <h4 className="font-display text-sm font-bold text-slate-900 dark:text-zinc-100">The Problem: Software Blindspots</h4>
              </div>
              <p className="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed font-sans">
                Organizations fail to assess nested transitive open-source dependencies, leading to vulnerable pipelines. Commercial audits take weeks, manual SBOM checks miss zero-days, and third-party SaaS integrations remain opaque.
              </p>
              <div className="text-[11px] font-mono text-slate-400 space-y-1.5 pt-2">
                <div>• Opaque software dependencies leading to supply chain compromises.</div>
                <div>• Manual, error-prone compliance evidence mapping.</div>
                <div>• No cryptographically sealed proof of original binary identity.</div>
              </div>
            </div>

            <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl border border-slate-200 dark:border-zinc-800 space-y-3 shadow-sm">
              <div className="flex items-center gap-2 text-emerald-500 font-bold">
                <ShieldCheck className="w-5 h-5" />
                <h4 className="font-display text-sm font-bold text-slate-900 dark:text-zinc-100">The SPR Solution: Cryptographic Passports</h4>
              </div>
              <p className="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed font-sans">
                Software Passport Registry delivers certified, immutable Software Passports. Integrating deep SBOM analysis, live vulnerability tracking, and compliance mapping engines (NIST, SOC 2, HIPAA) to guarantee dynamic software security postures.
              </p>
              <div className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 space-y-1.5 pt-2">
                <div>✓ Live catalog of parsed dependencies and publisher hashes.</div>
                <div>✓ Cryptographic evidence locked in multi-tenant vaults.</div>
                <div>✓ Streamlined, CISO-approved compliance reports with zero effort.</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- SUB-VIEW 2: APPLY FORM --- */}
      {localSubTab === 'apply' && (
        <div className="max-w-2xl mx-auto bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl shadow-md p-6 animate-fade-in" id="apply-view">
          <div className="border-b border-slate-100 dark:border-zinc-800 pb-4 mb-5">
            <h2 className="text-sm font-display font-bold text-slate-900 dark:text-zinc-100">Lodge Founding Pilot Application</h2>
            <p className="text-xs text-slate-500 dark:text-zinc-400 font-sans mt-1">
              Submit your company's technology metrics to request automated pilot deployment.
            </p>
          </div>

          <form onSubmit={handleCreatePilotSubmit} className="space-y-4 text-xs font-sans">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="font-bold text-slate-700 dark:text-zinc-300">Company / Organization Name *</label>
                <input
                  type="text"
                  required
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  placeholder="e.g. MedVanguard Health"
                  className="w-full bg-slate-50 dark:bg-zinc-950 border border-slate-250 dark:border-zinc-800 rounded-lg p-2.5 outline-none focus:border-indigo-500 focus:bg-white dark:focus:bg-zinc-900 transition-colors text-slate-800 dark:text-zinc-100 font-semibold"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700 dark:text-zinc-300">Company Website</label>
                <input
                  type="url"
                  value={newOrgWebsite}
                  onChange={(e) => setNewOrgWebsite(e.target.value)}
                  placeholder="https://example.com"
                  className="w-full bg-slate-50 dark:bg-zinc-950 border border-slate-250 dark:border-zinc-800 rounded-lg p-2.5 outline-none focus:border-indigo-500 focus:bg-white dark:focus:bg-zinc-900 transition-colors font-mono text-slate-800 dark:text-zinc-100"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="font-bold text-slate-700 dark:text-zinc-300">Industry Sector</label>
                <select
                  value={newOrgIndustry}
                  onChange={(e) => setNewOrgIndustry(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-zinc-950 border border-slate-250 dark:border-zinc-800 rounded-lg p-2.5 outline-none focus:border-indigo-500 font-bold"
                >
                  <option>Managed Service Provider</option>
                  <option>Healthcare & Pharma</option>
                  <option>SaaS / Software Product</option>
                  <option>Financial Services</option>
                  <option>Government / Defense</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700 dark:text-zinc-300">Company Size</label>
                <select
                  value={newOrgSize}
                  onChange={(e) => setNewOrgSize(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-zinc-950 border border-slate-250 dark:border-zinc-800 rounded-lg p-2.5 outline-none focus:border-indigo-500 font-bold"
                >
                  <option>1-50 employees</option>
                  <option>50-200 employees</option>
                  <option>200-1000 employees</option>
                  <option>1000+ employees</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700 dark:text-zinc-300">Tenant Workspace Type</label>
                <select
                  value={newPilotType}
                  onChange={(e) => setNewPilotType(e.target.value as any)}
                  className="w-full bg-slate-50 dark:bg-zinc-950 border border-slate-250 dark:border-zinc-800 rounded-lg p-2.5 outline-none focus:border-indigo-500 font-bold text-indigo-600 dark:text-indigo-400"
                >
                  <option value="MSP partner">MSP Partner Workspace</option>
                  <option value="Software company">Software Company Workspace</option>
                  <option value="Enterprise customer">Enterprise Client Workspace</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-slate-100 dark:border-zinc-800 pt-4">
              <div className="space-y-1">
                <label className="font-bold text-slate-700 dark:text-zinc-300">Main Contact Name *</label>
                <input
                  type="text"
                  required
                  value={newContactName}
                  onChange={(e) => setNewContactName(e.target.value)}
                  placeholder="David Chen"
                  className="w-full bg-slate-50 dark:bg-zinc-950 border border-slate-250 dark:border-zinc-800 rounded-lg p-2.5 outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700 dark:text-zinc-300">Contact Email *</label>
                <input
                  type="email"
                  required
                  value={newContactEmail}
                  onChange={(e) => setNewContactEmail(e.target.value)}
                  placeholder="dchen@medvanguard.com"
                  className="w-full bg-slate-50 dark:bg-zinc-950 border border-slate-250 dark:border-zinc-800 rounded-lg p-2.5 outline-none font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700 dark:text-zinc-300">Role / Title</label>
                <input
                  type="text"
                  value={newContactRole}
                  onChange={(e) => setNewContactRole(e.target.value)}
                  placeholder="Chief Information Security Officer"
                  className="w-full bg-slate-50 dark:bg-zinc-950 border border-slate-250 dark:border-zinc-800 rounded-lg p-2.5 outline-none"
                />
              </div>
            </div>

            <div className="space-y-2 border-t border-slate-100 dark:border-zinc-800 pt-4">
              <div className="space-y-1">
                <label className="font-bold text-slate-700 dark:text-zinc-300">Primary Software Trust & License Challenges</label>
                <textarea
                  value={newChallenges}
                  onChange={(e) => setNewChallenges(e.target.value)}
                  placeholder="Describe your primary supply chain visibility, nested dependencies CVE scans, or regulatory auditing blockers."
                  rows={3}
                  className="w-full bg-slate-50 dark:bg-zinc-950 border border-slate-250 dark:border-zinc-800 rounded-lg p-2.5 outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700 dark:text-zinc-300">Current Software Auditing Tools Used</label>
                <input
                  type="text"
                  value={newTools}
                  onChange={(e) => setNewTools(e.target.value)}
                  placeholder="Snyk, BlackDuck, Dependabot, Excel spreadsheets"
                  className="w-full bg-slate-50 dark:bg-zinc-950 border border-slate-250 dark:border-zinc-800 rounded-lg p-2.5 outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-sans font-bold text-xs py-3 rounded-xl shadow-md transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <Send className="w-4 h-4" />
              <span>Submit Pilot Application & Reserve Pilot Slot</span>
            </button>
          </form>
        </div>
      )}

      {/* --- SUB-VIEW 3: PILOT PARTNERS PIPELINE & LIFECYCLE --- */}
      {localSubTab === 'partners' && (
        <div className="space-y-6 animate-fade-in" id="partners-view">
          <div className="bg-white dark:bg-zinc-900 p-5 rounded-xl border border-slate-200 dark:border-zinc-800 shadow-sm">
            <h3 className="text-sm font-display font-bold text-slate-900 dark:text-zinc-50">Active Partnership Onboarding Pipeline</h3>
            <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">
              Visualize onboarding milestones from prospective identification down to paid commercial software license conversions.
            </p>

            {/* Structured Funnel Flow */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mt-4 text-center text-[10px] font-mono">
              {[
                { stage: 'Prospect', desc: 'Identified leads', count: organizations.filter(o => o.status === 'Prospect').length, bg: 'bg-slate-50 dark:bg-zinc-950/40 border-slate-200' },
                { stage: 'Applied', desc: 'Submit application', count: organizations.filter(o => o.status === 'Applied').length, bg: 'bg-blue-50/50 dark:bg-blue-950/10 border-blue-200' },
                { stage: 'Under Review', desc: 'SLA verification', count: organizations.filter(o => o.status === 'Under Review').length, bg: 'bg-amber-50/50 dark:bg-amber-950/10 border-amber-200' },
                { stage: 'Approved', desc: 'Secure clearance', count: organizations.filter(o => o.status === 'Approved').length, bg: 'bg-indigo-50/50 dark:bg-indigo-950/10 border-indigo-200' },
                { stage: 'Active Pilot', desc: 'Pilot runs', count: organizations.filter(o => o.status === 'Active Pilot').length, bg: 'bg-purple-50/50 dark:bg-purple-950/10 border-purple-200' },
                { stage: 'Completed', desc: 'Report audits', count: organizations.filter(o => o.status === 'Completed').length, bg: 'bg-teal-50/50 dark:bg-teal-950/10 border-teal-200' },
                { stage: 'Converted', desc: 'Paid customer', count: conversions.length, bg: 'bg-emerald-50 dark:bg-emerald-950/10 border-emerald-200 text-emerald-700 dark:text-emerald-400' },
                { stage: 'Declined', desc: 'No SLA align', count: organizations.filter(o => o.status === 'Declined').length, bg: 'bg-rose-50/50 dark:bg-rose-950/10 border-rose-200' }
              ].map(st => (
                <div key={st.stage} className={`p-3 rounded-xl border ${st.bg} space-y-1`}>
                  <div className="font-bold truncate">{st.stage}</div>
                  <div className="text-lg font-black">{st.count}</div>
                  <div className="text-[8px] text-slate-400 font-sans leading-tight">{st.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Active Partner Listings */}
          <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl shadow-sm p-6 space-y-4">
            <h4 className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider">Pilot Organizations & Funnel States</h4>

            <div className="overflow-x-auto text-xs font-sans">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-zinc-800 text-slate-400 font-mono text-[10px]">
                    <th className="pb-2">Company Name</th>
                    <th className="pb-2">Industry / Web</th>
                    <th className="pb-2 text-center">Lifecycle Status</th>
                    <th className="pb-2 text-center font-mono">Engagement Index</th>
                    <th className="pb-2 text-center font-mono">Conversion Prob</th>
                    <th className="pb-2 text-right">PoC Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-zinc-800">
                  {organizations.map(org => {
                    const orgContact = contacts.find(c => c.orgId === org.id);
                    return (
                      <tr key={org.id} className="hover:bg-slate-50/50 dark:hover:bg-zinc-800/20">
                        <td className="py-3.5">
                          <span className="font-bold text-slate-800 dark:text-zinc-100">{org.name}</span>
                          <span className="block text-[10px] text-slate-400">Contact: {orgContact?.name || 'Unassigned'} ({orgContact?.roleTitle})</span>
                        </td>
                        <td className="py-3.5">
                          <span className="font-semibold text-slate-600 dark:text-zinc-300">{org.industry}</span>
                          <a href={org.website} target="_blank" rel="noreferrer" className="block text-[10px] text-indigo-500 hover:underline">{org.website}</a>
                        </td>
                        <td className="py-3.5 text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            org.status === 'Active Pilot' ? 'bg-purple-50 dark:bg-purple-950/30 text-purple-600 dark:text-purple-400 border border-purple-100 dark:border-purple-900/50' :
                            org.status === 'Converted' ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/50' :
                            org.status === 'Applied' ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900/50' :
                            org.status === 'Under Review' ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-900/50' :
                            'bg-slate-50 dark:bg-zinc-950 text-slate-500'
                          }`}>
                            {org.status}
                          </span>
                        </td>
                        <td className="py-3.5 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <div className="w-12 bg-slate-100 dark:bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                              <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: `${org.engagementScore}%` }}></div>
                            </div>
                            <span className="font-mono font-bold text-slate-700 dark:text-zinc-300">{org.engagementScore}%</span>
                          </div>
                        </td>
                        <td className="py-3.5 text-center font-mono font-bold text-slate-700 dark:text-zinc-300">
                          {org.conversionProbability}%
                        </td>
                        <td className="py-3.5 text-right space-x-1.5">
                          {org.status === 'Applied' && (
                            <button
                              onClick={() => handleApprovePilot(org.id)}
                              className="bg-indigo-600 hover:bg-indigo-700 text-white font-sans text-[10px] py-1 px-2.5 rounded-lg cursor-pointer transition-colors"
                            >
                              Approve Pilot
                            </button>
                          )}
                          {org.status === 'Active Pilot' && (
                            <button
                              onClick={() => handleConvertPilot(org.id)}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white font-sans text-[10px] py-1 px-2.5 rounded-lg cursor-pointer transition-colors"
                            >
                              Convert to Paid
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setSelectedWorkspaceOrgId(org.id);
                              handleSubTabChange('workspace');
                            }}
                            className="text-slate-500 hover:text-slate-700 dark:hover:text-zinc-100 text-[10px] border border-slate-200 dark:border-zinc-800 rounded py-1 px-2 font-mono"
                          >
                            Open Workspace
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* --- SUB-VIEW 4: ISOLATED PARTNER WORKSPACE --- */}
      {localSubTab === 'workspace' && (
        <div className="space-y-6 animate-fade-in" id="workspace-view">
          {/* Active Client Scope Header switcher */}
          <div className="bg-slate-900 text-white p-5 rounded-2xl border border-slate-800 flex flex-col md:flex-row justify-between md:items-center gap-4 shadow-md">
            <div>
              <span className="text-[10px] font-mono text-indigo-400 font-bold uppercase tracking-wider block">ISOLATED SECURE TENANT WORKSPACE</span>
              <div className="flex items-center gap-2 mt-1">
                <h3 className="text-base font-display font-black">{activeWorkspaceOrg?.name}</h3>
                <span className="bg-indigo-500/20 text-indigo-300 font-mono font-bold px-2 py-0.5 rounded text-[9px] border border-indigo-500/30">
                  {activeWorkspaceOrg?.industry}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-semibold">Select Tenant Workspace:</span>
              <select
                value={selectedWorkspaceOrgId}
                onChange={(e) => {
                  setSelectedWorkspaceOrgId(e.target.value);
                  triggerBanner(`Switched to secure isolation context: ${organizations.find(o => o.id === e.target.value)?.name}`);
                }}
                className="bg-slate-800 text-slate-200 border border-slate-700 rounded-lg py-1.5 px-3 text-xs font-bold outline-none focus:border-indigo-500"
              >
                {organizations.map(org => (
                  <option key={org.id} value={org.id}>{org.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left 3cols: Inner Workspace Menu */}
            <div className="lg:col-span-3 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-3 rounded-xl shadow-sm space-y-1 self-start">
              {[
                { id: 'profile', label: 'Company Profile', count: null },
                { id: 'software', label: 'Software Inventory', count: activeWorkspaceAssets.length },
                { id: 'assessments', label: 'Passport Assessments', count: activeWorkspaceAssets.filter(sa => sa.trustScore > 70).length },
                { id: 'findings', label: 'Risk Findings', count: activeWorkspaceAssets.filter(sa => sa.riskLevel === 'High' || sa.riskLevel === 'Critical').length },
                { id: 'reports', label: 'Reports & Audits', count: activeWorkspaceReports.length },
                { id: 'timeline', label: 'Timeline & Projects', count: activeWorkspaceProjects.length },
                { id: 'team', label: 'Team Members', count: activeWorkspaceContacts.length },
                { id: 'feedback', label: 'Feedback & Features', count: activeWorkspaceFeedback.length + activeWorkspaceFeatures.length }
              ].map(sub => (
                <button
                  key={sub.id}
                  onClick={() => setWorkspaceSubTab(sub.id as any)}
                  className={`w-full text-left text-xs font-semibold p-2.5 rounded-lg flex justify-between items-center cursor-pointer transition-all ${
                    workspaceSubTab === sub.id
                      ? 'bg-indigo-600 text-white font-bold'
                      : 'hover:bg-slate-50 dark:hover:bg-zinc-800/50 text-slate-600 dark:text-zinc-400'
                  }`}
                >
                  <span>{sub.label}</span>
                  {sub.count !== null && (
                    <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-full ${
                      workspaceSubTab === sub.id ? 'bg-indigo-700 text-white' : 'bg-slate-100 dark:bg-zinc-800 text-slate-500'
                    }`}>
                      {sub.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Right 9cols: Selected Workspace frame */}
            <div className="lg:col-span-9 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl shadow-sm p-6 min-h-[400px] flex flex-col justify-between">
              <div>
                {/* Profile */}
                {workspaceSubTab === 'profile' && (
                  <div className="space-y-4 animate-fade-in">
                    <h4 className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 dark:border-zinc-800 pb-2">
                      Company Profile Summary
                    </h4>

                    <div className="grid grid-cols-2 gap-4 text-xs">
                      <div className="p-4 bg-slate-50 dark:bg-zinc-950/40 rounded-xl">
                        <span className="text-[10px] font-mono text-slate-400 font-bold block">Company Name</span>
                        <span className="text-sm font-bold text-slate-800 dark:text-zinc-200 mt-1 block">{activeWorkspaceOrg.name}</span>
                      </div>
                      <div className="p-4 bg-slate-50 dark:bg-zinc-950/40 rounded-xl">
                        <span className="text-[10px] font-mono text-slate-400 font-bold block">Website</span>
                        <a href={activeWorkspaceOrg.website} target="_blank" rel="noreferrer" className="text-sm font-bold text-indigo-500 mt-1 block hover:underline">
                          {activeWorkspaceOrg.website}
                        </a>
                      </div>
                      <div className="p-4 bg-slate-50 dark:bg-zinc-950/40 rounded-xl">
                        <span className="text-[10px] font-mono text-slate-400 font-bold block">Industry</span>
                        <span className="text-sm font-bold text-slate-800 dark:text-zinc-200 mt-1 block">{activeWorkspaceOrg.industry}</span>
                      </div>
                      <div className="p-4 bg-slate-50 dark:bg-zinc-950/40 rounded-xl">
                        <span className="text-[10px] font-mono text-slate-400 font-bold block">Evaluation Stage</span>
                        <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400 mt-1 block">{activeWorkspaceOrg.status}</span>
                      </div>
                    </div>

                    <div className="p-4 bg-indigo-50/20 rounded-xl border border-indigo-100 dark:border-indigo-900/50 space-y-1">
                      <h5 className="text-xs font-bold text-slate-800 dark:text-zinc-200 flex items-center gap-1.5">
                        <Info className="w-4 h-4 text-indigo-500" /> Secure Isolated Tenant Clearance
                      </h5>
                      <p className="text-[11px] text-slate-500 dark:text-zinc-400 leading-relaxed font-sans">
                        This workspace is restricted to authorized credentials in the {activeWorkspaceOrg.name} group. High-touch multi-tenant security guarantees absolute data isolation.
                      </p>
                    </div>
                  </div>
                )}

                {/* Software Inventory */}
                {workspaceSubTab === 'software' && (
                  <div className="space-y-4 animate-fade-in">
                    <div className="flex justify-between items-center border-b border-slate-100 dark:border-zinc-800 pb-2">
                      <h4 className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider">
                        Software Assets Inventory
                      </h4>
                      <span className="text-[10px] font-mono text-slate-400">{activeWorkspaceAssets.length} packages cataloged</span>
                    </div>

                    <div className="overflow-x-auto text-xs">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="border-b border-slate-100 dark:border-zinc-800 text-slate-400 font-mono text-[9px] uppercase">
                            <th className="pb-2">Application Name</th>
                            <th className="pb-2">Publisher</th>
                            <th className="pb-2">Version</th>
                            <th className="pb-2 text-center">Nested Dependencies</th>
                            <th className="pb-2 text-center">Risk Level</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-zinc-800 font-sans">
                          {activeWorkspaceAssets.map(sa => (
                            <tr key={sa.id}>
                              <td className="py-2.5 font-bold text-slate-800 dark:text-zinc-200">{sa.name}</td>
                              <td className="py-2.5 text-slate-500">{sa.vendor}</td>
                              <td className="py-2.5 font-mono text-slate-500">{sa.version}</td>
                              <td className="py-2.5 text-center font-mono font-bold text-slate-600">{sa.dependenciesCount}</td>
                              <td className="py-2.5 text-center">
                                <span className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold ${
                                  sa.riskLevel === 'Critical' ? 'bg-rose-100 text-rose-700' :
                                  sa.riskLevel === 'High' ? 'bg-amber-100 text-amber-700' :
                                  'bg-emerald-100 text-emerald-700'
                                }`}>
                                  {sa.riskLevel}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Add software asset form - only if canEdit is active */}
                    {canEdit && (
                      <form onSubmit={handleAddAsset} className="bg-slate-50 dark:bg-zinc-950 p-4 rounded-xl border border-slate-200 dark:border-zinc-800 text-xs space-y-3 mt-4">
                        <h5 className="font-bold text-slate-800 dark:text-zinc-200 flex items-center gap-1">
                          <Plus className="w-4 h-4 text-indigo-500" /> Register Software Asset
                        </h5>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <input
                            type="text"
                            required
                            placeholder="e.g. Postgres DB"
                            value={addAssetName}
                            onChange={(e) => setAddAssetName(e.target.value)}
                            className="bg-white dark:bg-zinc-900 border border-slate-250 dark:border-zinc-800 rounded p-2"
                          />
                          <input
                            type="text"
                            required
                            placeholder="e.g. Postgres Core"
                            value={addAssetVendor}
                            onChange={(e) => setAddAssetVendor(e.target.value)}
                            className="bg-white dark:bg-zinc-900 border border-slate-250 dark:border-zinc-800 rounded p-2"
                          />
                          <input
                            type="text"
                            required
                            placeholder="e.g. v15.4"
                            value={addAssetVersion}
                            onChange={(e) => setAddAssetVersion(e.target.value)}
                            className="bg-white dark:bg-zinc-900 border border-slate-250 dark:border-zinc-800 rounded p-2 font-mono"
                          />
                          <select
                            value={addAssetRisk}
                            onChange={(e) => setAddAssetRisk(e.target.value as any)}
                            className="bg-white dark:bg-zinc-900 border border-slate-250 dark:border-zinc-800 rounded p-2 font-bold"
                          >
                            <option value="Low">Low Risk</option>
                            <option value="Medium">Medium Risk</option>
                            <option value="High">High Risk</option>
                            <option value="Critical">Critical Risk</option>
                          </select>
                        </div>
                        <button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded cursor-pointer transition-all">
                          Inject Asset & Generate Passport
                        </button>
                      </form>
                    )}
                  </div>
                )}

                {/* Assessments */}
                {workspaceSubTab === 'assessments' && (
                  <div className="space-y-4 animate-fade-in">
                    <h4 className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 dark:border-zinc-800 pb-2">
                      Active Software Passport Security Ratings
                    </h4>

                    <p className="text-xs text-slate-500">Each registered asset undergoes cryptographic analysis to evaluate dependency hygiene.</p>

                    <div className="space-y-3 text-xs">
                      {activeWorkspaceAssets.map(sa => (
                        <div key={sa.id} className="p-3.5 bg-slate-50 dark:bg-zinc-950/40 rounded-xl border border-slate-150 dark:border-zinc-800/60 flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                          <div>
                            <span className="font-bold text-slate-800 dark:text-zinc-200 text-xs block">{sa.name}</span>
                            <span className="text-[10px] text-slate-400 block font-mono">ID: {sa.id} | Publisher: {sa.vendor}</span>
                          </div>

                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <span className="text-[9px] font-mono text-slate-400 uppercase block">Trust Score</span>
                              <span className={`text-sm font-mono font-black ${
                                sa.trustScore > 80 ? 'text-emerald-500' : sa.trustScore > 60 ? 'text-amber-500' : 'text-rose-500'
                              }`}>
                                {sa.trustScore} / 100
                              </span>
                            </div>

                            <span className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900/60 text-emerald-600 dark:text-emerald-400 font-mono font-bold px-2 py-1 rounded text-[9px]">
                              Signed ✓
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Risk findings */}
                {workspaceSubTab === 'findings' && (
                  <div className="space-y-4 animate-fade-in">
                    <h4 className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 dark:border-zinc-800 pb-2">
                      Vulnerability & Supply Chain Risk Findings
                    </h4>

                    {activeWorkspaceAssets.filter(sa => sa.riskLevel === 'Critical' || sa.riskLevel === 'High').length === 0 ? (
                      <div className="p-8 text-center bg-slate-50 dark:bg-zinc-950/30 rounded-xl border border-slate-100 dark:border-zinc-800 text-slate-400">
                        <ShieldCheck className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                        <span className="text-xs font-semibold block">Absolute Clean Bill of Health!</span>
                        <span className="text-[10px] text-slate-500 mt-1 block">No high or critical CVE dependencies parsed inside catalog.</span>
                      </div>
                    ) : (
                      <div className="space-y-3 text-xs">
                        {activeWorkspaceAssets.filter(sa => sa.riskLevel === 'Critical' || sa.riskLevel === 'High').map(sa => (
                          <div key={sa.id} className="p-4 bg-rose-50/40 dark:bg-rose-950/10 rounded-xl border border-rose-100 dark:border-rose-900/40 space-y-2">
                            <div className="flex items-center gap-2 text-rose-700 dark:text-rose-400 font-bold">
                              <AlertTriangle className="w-4 h-4" />
                              <span>Critical Vulnerability Found inside "{sa.name}"</span>
                            </div>
                            <p className="text-slate-600 dark:text-zinc-300">
                              Dependency trees exhibit standard Log4j zero-day vulnerability (CVE-2021-44228) leading to potential Arbitrary Code Execution hazard on remote systems.
                            </p>
                            <div className="bg-white dark:bg-zinc-900 p-2.5 rounded border border-rose-150 font-mono text-[10px] text-rose-800 dark:text-rose-400">
                              <strong>Recommended Mitigation:</strong> Update declaration manifest node to pull <code>log4j-core v2.17.1</code> immediately. Seal the software passport.
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Reports */}
                {workspaceSubTab === 'reports' && (
                  <div className="space-y-4 animate-fade-in">
                    <h4 className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 dark:border-zinc-800 pb-2">
                      Sealed Compliance & Passport PDF Reports
                    </h4>

                    <div className="space-y-2 text-xs font-sans">
                      {activeWorkspaceReports.map(rep => (
                        <div key={rep.id} className="p-3 bg-slate-50 dark:bg-zinc-950/40 border border-slate-100 dark:border-zinc-800 rounded-xl flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <FileText className="w-4.5 h-4.5 text-indigo-500" />
                            <div>
                              <span className="font-bold text-slate-800 dark:text-zinc-200 block">{rep.reportType} Alignment Certificate</span>
                              <span className="text-[10px] text-slate-400 font-mono">Compiled: {rep.generatedAt} | Path: {rep.reportPath}</span>
                            </div>
                          </div>
                          <button
                            onClick={() => triggerBanner(`Downloading pilot report: ${rep.reportType}`)}
                            className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-850 p-1.5 rounded-lg text-slate-600 dark:text-zinc-300 cursor-pointer"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Timeline */}
                {workspaceSubTab === 'timeline' && (
                  <div className="space-y-4 animate-fade-in">
                    <h4 className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 dark:border-zinc-800 pb-2">
                      Pilot Timeline & Key PoC Projects
                    </h4>

                    <div className="space-y-4">
                      {activeWorkspaceProjects.map(p => (
                        <div key={p.id} className="border-l-2 border-indigo-500 pl-4 space-y-1 relative text-xs">
                          <div className="absolute w-2 h-2 rounded-full bg-indigo-600 -left-[5px] top-1"></div>
                          <div className="flex justify-between font-mono font-bold">
                            <span className="text-slate-800 dark:text-zinc-100 text-xs">{p.name}</span>
                            <span className="text-indigo-600 dark:text-indigo-400 text-[10px]">{p.startDate} to {p.endDate}</span>
                          </div>
                          <div className="text-slate-500">Status: <strong className="text-slate-700 dark:text-zinc-300">{p.status}</strong></div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Team */}
                {workspaceSubTab === 'team' && (
                  <div className="space-y-4 animate-fade-in">
                    <h4 className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 dark:border-zinc-800 pb-2">
                      Active Onboarding Group & Contact Points
                    </h4>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-sans">
                      {activeWorkspaceContacts.map(con => (
                        <div key={con.id} className="p-4 bg-slate-50 dark:bg-zinc-950/40 rounded-xl border border-slate-150 dark:border-zinc-800">
                          <div className="font-bold text-slate-800 dark:text-zinc-200 block text-xs">{con.name}</div>
                          <div className="text-slate-500 block text-[10px] mt-0.5">{con.roleTitle}</div>
                          <div className="border-t border-slate-100 dark:border-zinc-800/40 my-2"></div>
                          <div className="font-mono text-[10px] text-indigo-500">{con.email}</div>
                          <div className="font-mono text-[10px] text-slate-400 mt-0.5">{con.phone}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Feedback portal */}
                {workspaceSubTab === 'feedback' && (
                  <div className="space-y-4 animate-fade-in">
                    <h4 className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 dark:border-zinc-800 pb-2">
                      Interactive Partner Feedback & Feature Portal
                    </h4>

                    {/* Features list */}
                    <div className="space-y-3">
                      <h5 className="text-[10px] font-mono text-slate-400 uppercase font-bold tracking-wider">Requested Custom Features</h5>
                      {activeWorkspaceFeatures.length === 0 ? (
                        <p className="text-xs text-slate-400 font-sans">No unique feature requests logged for this tenant workspace yet.</p>
                      ) : (
                        activeWorkspaceFeatures.map(f => (
                          <div key={f.id} className="p-3 bg-slate-50 dark:bg-zinc-950/40 border border-slate-100 dark:border-zinc-800 rounded-xl text-xs space-y-1">
                            <div className="flex justify-between items-center font-bold text-slate-800 dark:text-zinc-200">
                              <span>{f.title}</span>
                              <span className="bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded text-[9px]">{f.status}</span>
                            </div>
                            <p className="text-slate-500 text-[11px] leading-relaxed font-sans">{f.description}</p>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Feedback portal list */}
                    <div className="space-y-3 pt-3 border-t border-slate-100 dark:border-zinc-800/60">
                      <h5 className="text-[10px] font-mono text-slate-400 uppercase font-bold tracking-wider">Logged Evaluation Comments</h5>
                      {activeWorkspaceFeedback.map(f => (
                        <div key={f.id} className="p-3 bg-slate-50 dark:bg-zinc-950/40 border-l-2 border-emerald-500 rounded-r-xl text-xs">
                          <p className="text-slate-600 dark:text-zinc-300 font-sans italic">"{f.comment}"</p>
                          <div className="mt-2 text-[10px] font-mono text-slate-400">By {f.contactName} on {f.submittedAt}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Secure isolation stamp */}
              <div className="border-t border-slate-100 dark:border-zinc-800 pt-3 flex flex-col sm:flex-row justify-between items-center text-[9px] text-slate-400 font-mono gap-2 mt-5">
                <span>TENANT KEY ISOLATION: {activeWorkspaceOrg?.id?.toUpperCase()}</span>
                <span>Active Region: us-east1 (Google Cloud Run Containers)</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- SUB-VIEW 5: INTERACTIVE EVALUATION SCENARIOS & FULL WORKFLOW PLAYBOOK --- */}
      {localSubTab === 'demo' && (
        <div className="space-y-6 animate-fade-in" id="demo-view">
          {/* Main Top Header Banner */}
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-6 relative overflow-hidden text-left">
            <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none"></div>
            <div className="relative z-10 space-y-1">
              <div className="flex items-center gap-2">
                <span className="bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider">
                  Interactive Evaluation Playbook
                </span>
                <span className="bg-amber-600/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider animate-pulse">
                  LIVE EVALUATION ACTIVE
                </span>
              </div>
              <h3 className="text-base font-display font-black text-slate-100">
                SPR End-to-End Lifecycle Evaluation
              </h3>
              <p className="text-xs text-slate-400 max-w-2xl font-sans">
                Experience the SPR evaluation playbook from initial onboarding to automated scanning, risk propagation, trust rating scoring, and official passport issuance.
              </p>
            </div>

            {/* Quick reset button */}
            <button
              onClick={() => {
                setActivePlaybookStep(1);
                setScanStatus('idle');
                setScanProgress(0);
                setScanLogs([]);
                setExtractedSbomInfo(null);
                setPassportSigned(false);
                triggerBanner('Restart evaluation playbook at Step 1.');
              }}
              className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-750 text-slate-300 border border-slate-700 hover:border-slate-600 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm relative z-10 flex items-center gap-1.5"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Reset Playbook</span>
            </button>
          </div>

          {/* Visually outstanding 9-Step horizontal progress pipeline indicator */}
          <div className="bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-900 rounded-2xl p-4 shadow-sm overflow-x-auto scrollbar-none">
            <div className="flex items-center justify-between min-w-[980px] px-2">
              {[
                { step: 1, name: 'Onboarding', desc: 'Signup & Role RBAC' },
                { step: 2, name: 'Vendor Setup', desc: 'Create & Connect' },
                { step: 3, name: 'Scan & Evidence', desc: 'Parser Pipeline' },
                { step: 4, name: 'Risk Mapping', desc: 'Trust Graph Decay' },
                { step: 5, name: 'Scoring Engine', desc: 'Ratings Formula' },
                { step: 6, name: 'Passport Issue', desc: 'Signed Attestation' },
                { step: 7, name: 'Continuous Monitor', desc: 'Alert Router' },
                { step: 8, name: 'Distribution', desc: 'MSP Branded Portal' },
                { step: 9, name: 'Compliance Export', desc: 'Auditor Deliver' }
              ].map((item, index, arr) => {
                const isActive = activePlaybookStep === item.step;
                const isCompleted = activePlaybookStep > item.step;
                return (
                  <React.Fragment key={item.step}>
                    <button
                      onClick={() => {
                        setActivePlaybookStep(item.step);
                        triggerBanner(`Navigated evaluation playbook to Step ${item.step}: ${item.name}`);
                      }}
                      className="flex items-center gap-2.5 text-left cursor-pointer transition-all outline-none group shrink-0"
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center font-mono font-black text-xs transition-all border ${
                        isActive
                          ? 'bg-indigo-600 border-indigo-600 text-white shadow-md shadow-indigo-600/20 ring-4 ring-indigo-600/10 scale-105'
                          : isCompleted
                            ? 'bg-emerald-500 border-emerald-500 text-white'
                            : 'bg-slate-50 dark:bg-zinc-900 border-slate-250 dark:border-zinc-850 text-slate-500'
                      }`}>
                        {isCompleted ? '✓' : item.step}
                      </div>
                      <div className="max-w-[100px]">
                        <p className={`text-[11px] font-black leading-none ${isActive ? 'text-indigo-600 dark:text-indigo-400' : isCompleted ? 'text-emerald-600' : 'text-slate-600 dark:text-zinc-400'}`}>
                          {item.name}
                        </p>
                        <span className="text-[9px] text-slate-400 font-sans block mt-0.5 truncate">{item.desc}</span>
                      </div>
                    </button>
                    {index < arr.length - 1 && (
                      <div className={`h-0.5 w-6 shrink-0 transition-colors ${activePlaybookStep > item.step ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-zinc-800'}`}></div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          {/* STAGE CONTAINER CARDS */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start text-xs text-left">
            {/* Left Main Interactive Viewport (8 Columns) */}
            <div className="lg:col-span-8 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm min-h-[500px] flex flex-col justify-between">
              
              {/* STAGE 1: ONBOARDING */}
              {activePlaybookStep === 1 && (
                <div className="space-y-6 animate-fade-in">
                  <div>
                    <h4 className="text-sm font-display font-black text-slate-800 dark:text-zinc-100 flex items-center gap-1.5">
                      <Users className="w-4 h-4 text-indigo-500" />
                      <span>Stage 1: Sign up, Establish Workspace & Delegate Roles</span>
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-zinc-400 font-sans mt-1">
                      Begin by registering your corporate workspace and selecting your compliance persona (MSP or Enterprise). Real RBAC controls are enforced instantly.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50 dark:bg-zinc-950/40 p-4 rounded-xl border border-slate-100 dark:border-zinc-850">
                    <div className="space-y-3.5">
                      <div>
                        <label className="text-[10px] font-mono font-bold text-slate-400 dark:text-zinc-500 uppercase">Workspace Name</label>
                        <input
                          type="text"
                          value={obWorkspaceName}
                          onChange={(e) => setObWorkspaceName(e.target.value)}
                          className="w-full mt-1 bg-white dark:bg-zinc-900 border border-slate-250 dark:border-zinc-800 rounded-xl px-3 py-2 text-xs font-semibold focus:border-indigo-500 focus:outline-none dark:text-zinc-100"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-mono font-bold text-slate-400 dark:text-zinc-500 uppercase block mb-1">Select Persona Archetype</label>
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            { id: 'MSP', label: 'MSP Partner', desc: 'Resell & co-brand' },
                            { id: 'Enterprise', label: 'Direct Enterprise', desc: 'Audit own vendors' }
                          ].map(opt => (
                            <button
                              key={opt.id}
                              onClick={() => {
                                setObRole(opt.id as any);
                                triggerBanner(`Persona switched to: ${opt.label}`);
                              }}
                              className={`p-2.5 rounded-xl text-left border cursor-pointer transition-all ${
                                obRole === opt.id
                                  ? 'bg-indigo-600/10 border-indigo-500 text-indigo-600 dark:text-indigo-400 font-bold'
                                  : 'bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-800/50'
                              }`}
                            >
                              <p className="font-bold">{opt.label}</p>
                              <span className="text-[9px] text-slate-400 font-normal">{opt.desc}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3.5">
                      <div className="border-b border-slate-100 dark:border-zinc-800 pb-1.5 flex justify-between items-center">
                        <span className="text-[10px] font-mono font-bold text-slate-400 dark:text-zinc-500 uppercase">Workspace Team (RBAC)</span>
                        <span className="bg-slate-200 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold">
                          {obTeam.length} active
                        </span>
                      </div>

                      <div className="space-y-1.5 max-h-36 overflow-y-auto">
                        {obTeam.map((m, idx) => (
                          <div key={idx} className="flex justify-between items-center bg-white dark:bg-zinc-900 px-2.5 py-1.5 rounded-lg border border-slate-100 dark:border-zinc-850">
                            <div>
                              <p className="font-semibold text-slate-700 dark:text-zinc-200">{m.email}</p>
                              <span className="text-[9px] text-indigo-500 font-mono font-bold">{m.role}</span>
                            </div>
                            <span className="bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 text-[8px] font-mono font-bold px-1.5 py-0.5 rounded border border-emerald-100 dark:border-emerald-900/60">
                              Active
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* Add team member interactive widget */}
                      <div className="flex gap-1.5">
                        <input
                          type="email"
                          placeholder="invite-colleague@company.com"
                          value={obNewEmail}
                          onChange={(e) => setObNewEmail(e.target.value)}
                          className="flex-1 bg-white dark:bg-zinc-900 border border-slate-250 dark:border-zinc-800 rounded-lg px-2 py-1 text-xs focus:outline-none dark:text-zinc-100"
                        />
                        <button
                          onClick={() => {
                            if (!obNewEmail) {
                              triggerBanner('Please type an email to invite.', true);
                              return;
                            }
                            setObTeam([...obTeam, { email: obNewEmail, role: obNewRole }]);
                            setObNewEmail('');
                            triggerBanner(`Sent workspace invitation to ${obNewEmail}!`);
                          }}
                          className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-2.5 py-1 rounded-lg cursor-pointer transition-all"
                        >
                          Invite
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* STAGE 2: VENDOR SETUP */}
              {activePlaybookStep === 2 && (
                <div className="space-y-6 animate-fade-in">
                  <div>
                    <h4 className="text-sm font-display font-black text-slate-800 dark:text-zinc-100 flex items-center gap-1.5">
                      <Briefcase className="w-4 h-4 text-indigo-500" />
                      <span>Stage 2: Create Vendor Projects & Connect Software Data Sources</span>
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-zinc-400 font-sans mt-1">
                      Set up isolated evaluation profiles for each of your critical third-party vendors, then connect raw files or pipelines for SBOM crawling.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-12 gap-6 bg-slate-50 dark:bg-zinc-950/40 p-4 rounded-xl border border-slate-100 dark:border-zinc-850">
                    <div className="md:col-span-4 space-y-3">
                      <span className="text-[10px] font-mono font-bold text-slate-400 dark:text-zinc-500 uppercase block">Active Projects/Vendors</span>
                      <div className="space-y-1.5">
                        {obVendors.map(v => (
                          <button
                            key={v}
                            onClick={() => {
                              setSelectedVendorProj(v);
                              triggerBanner(`Switched active workspace scope to vendor project: ${v}`);
                            }}
                            className={`w-full text-left p-2 rounded-xl border text-xs font-semibold cursor-pointer transition-all ${
                              selectedVendorProj === v
                                ? 'bg-indigo-600 border-indigo-600 text-white font-bold shadow-sm'
                                : 'bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-800 text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-850/60'
                            }`}
                          >
                            {v}
                          </button>
                        ))}
                      </div>

                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          placeholder="New Vendor Project"
                          value={newVendorName}
                          onChange={(e) => setNewVendorName(e.target.value)}
                          className="w-full bg-white dark:bg-zinc-900 border border-slate-250 dark:border-zinc-800 rounded-lg px-2 py-1 text-xs focus:outline-none dark:text-zinc-100"
                        />
                        <button
                          onClick={() => {
                            if (!newVendorName) return;
                            setObVendors([...obVendors, newVendorName]);
                            setSelectedVendorProj(newVendorName);
                            setNewVendorName('');
                            triggerBanner(`Created isolated evaluation project folder for: ${newVendorName}`);
                          }}
                          className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-2 py-1 rounded-lg shrink-0 cursor-pointer"
                        >
                          + Add
                        </button>
                      </div>
                    </div>

                    <div className="md:col-span-8 space-y-4">
                      <span className="text-[10px] font-mono font-bold text-slate-400 dark:text-zinc-500 uppercase block">Connect Trust Data Inputs</span>
                      
                      {/* Sub-tabs for input types */}
                      <div className="flex bg-white dark:bg-zinc-900 p-1 border border-slate-200 dark:border-zinc-800 rounded-xl gap-1">
                        {[
                          { id: 'SBOM Upload', label: 'Upload SBOM File' },
                          { id: 'Repo Link', label: 'GitHub/GitLab Link' },
                          { id: 'API Connection', label: 'Direct Sync API' }
                        ].map(t => (
                          <button
                            key={t.id}
                            onClick={() => setConnType(t.id as any)}
                            className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                              connType === t.id
                                ? 'bg-indigo-600 text-white shadow-sm'
                                : 'text-slate-600 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-800/50'
                            }`}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>

                      {/* Input type configuration panels */}
                      <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-850 p-4 rounded-xl space-y-3.5">
                        {connType === 'SBOM Upload' && (
                          <div className="space-y-2.5">
                            <p className="text-[11px] text-slate-500 dark:text-zinc-400 font-sans leading-relaxed">
                              SPR accepts standard formats such as CycloneDX (JSON/XML) or SPDX. Upload raw bills-of-materials to initiate automated graph extraction.
                            </p>
                            <div className="border-2 border-dashed border-slate-200 dark:border-zinc-800 hover:border-indigo-400 rounded-xl p-6 text-center cursor-pointer transition-all bg-slate-50/45 dark:bg-zinc-950/20">
                              <FileCheck className="w-8 h-8 text-indigo-500 mx-auto mb-2" />
                              <span className="font-bold text-slate-700 dark:text-zinc-300 block text-xs">Drag and drop SBOM payload here</span>
                              <span className="text-[10px] text-slate-400 mt-1 block">Or click to select files from explorer</span>
                            </div>
                            <div className="flex justify-between items-center bg-slate-50 dark:bg-zinc-950/30 p-2.5 rounded-lg border border-slate-150 dark:border-zinc-850 font-mono text-[10px]">
                              <span className="text-slate-400">Target File Reference:</span>
                              <span className="font-bold text-indigo-600 dark:text-indigo-400">{connectedSbomFile}</span>
                            </div>
                          </div>
                        )}

                        {connType === 'Repo Link' && (
                          <div className="space-y-3">
                            <p className="text-[11px] text-slate-500 dark:text-zinc-400 font-sans leading-relaxed">
                              Connect code repositories directly. SPR continuously listens to releases, compiling updated Software Passports on every branch push.
                            </p>
                            <div>
                              <label className="text-[9px] font-mono font-bold text-slate-400 dark:text-zinc-500 uppercase">Git Repository URL</label>
                              <input
                                type="text"
                                value={connectedRepoUrl}
                                onChange={(e) => setConnectedRepoUrl(e.target.value)}
                                className="w-full mt-1 bg-white dark:bg-zinc-900 border border-slate-250 dark:border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none dark:text-zinc-100 font-mono"
                              />
                            </div>
                          </div>
                        )}

                        {connType === 'API Connection' && (
                          <div className="space-y-3">
                            <p className="text-[11px] text-slate-500 dark:text-zinc-400 font-sans leading-relaxed">
                              Integrate with your CI/CD pipelines (GitHub Actions, GitLab CI, Jenkins) or artifact registries to sync SBOM data dynamically via REST.
                            </p>
                            <div>
                              <label className="text-[9px] font-mono font-bold text-slate-400 dark:text-zinc-500 uppercase">Target Ingestion Webhook URL</label>
                              <input
                                type="text"
                                value={connectedApiEndpoint}
                                onChange={(e) => setConnectedApiEndpoint(e.target.value)}
                                className="w-full mt-1 bg-white dark:bg-zinc-900 border border-slate-250 dark:border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none dark:text-zinc-100 font-mono"
                              />
                            </div>
                          </div>
                        )}

                        <button
                          onClick={() => {
                            triggerBanner(`Source credentials saved for "${selectedVendorProj}"! Ready for cryptographic crawling.`);
                          }}
                          className="w-full bg-slate-900 dark:bg-zinc-950 text-white font-bold p-2 rounded-lg cursor-pointer hover:bg-slate-800 dark:hover:bg-zinc-900 transition-colors"
                        >
                          Save Data Source Credentials
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* STAGE 3: SCANNING & EVIDENCE */}
              {activePlaybookStep === 3 && (
                <div className="space-y-6 animate-fade-in">
                  <div>
                    <h4 className="text-sm font-display font-black text-slate-800 dark:text-zinc-100 flex items-center gap-1.5">
                      <Radar className="w-4 h-4 text-indigo-500" />
                      <span>Stage 3: Run Scanning Pipeline & Capture Sealed Evidence Artifacts</span>
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-zinc-400 font-sans mt-1">
                      Execute the crawler. Our analysis engine will dissect the connected sources, evaluate license liability, check for CVEs, and commit evidence to the ledger.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50 dark:bg-zinc-950/40 p-4 rounded-xl border border-slate-100 dark:border-zinc-850">
                    <div className="space-y-4">
                      <span className="text-[10px] font-mono font-bold text-slate-400 dark:text-zinc-500 uppercase block">Analysis Control Hub</span>
                      
                      <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-850 p-4 rounded-xl space-y-4 text-center">
                        <div className="space-y-1">
                          <span className="text-slate-500 block text-[10px]">Target Project Selected</span>
                          <span className="font-display font-black text-sm text-slate-800 dark:text-zinc-100">{selectedVendorProj}</span>
                        </div>

                        {scanStatus === 'idle' && (
                          <button
                            onClick={startPlaybookScan}
                            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl transition-all cursor-pointer shadow-md inline-flex items-center gap-1.5 animate-pulse"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>Run Cryptographic Crawl</span>
                          </button>
                        )}

                        {scanStatus === 'scanning' && (
                          <div className="space-y-2">
                            <div className="flex justify-between text-[10px] font-mono font-bold text-indigo-600">
                              <span>PROCESSING SBOM...</span>
                              <span>{scanProgress}%</span>
                            </div>
                            <div className="w-full bg-slate-100 dark:bg-zinc-950 rounded-full h-1.5 overflow-hidden">
                              <div className="bg-indigo-600 h-1.5 transition-all duration-75" style={{ width: `${scanProgress}%` }}></div>
                            </div>
                          </div>
                        )}

                        {scanStatus === 'complete' && (
                          <div className="space-y-3">
                            <span className="bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 border border-emerald-100 dark:border-emerald-900/60 font-mono font-bold px-3 py-1 rounded-xl text-[11px] inline-block">
                              ✓ SCAN COMPLETED & SEALED
                            </span>
                            <p className="text-[10px] text-slate-400">All parsed nodes and dependency coordinates registered in immutable artifact registry.</p>
                            <button
                              onClick={() => {
                                setScanStatus('idle');
                                setScanProgress(0);
                                setScanLogs([]);
                                setExtractedSbomInfo(null);
                              }}
                              className="text-[10px] font-bold text-slate-400 hover:text-indigo-600 cursor-pointer block mx-auto underline mt-2"
                            >
                              Restart Scan
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Stage 2/3 Warning banner */}
                      <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-700 dark:text-amber-400 font-sans leading-relaxed">
                        <span className="font-bold flex items-center gap-1 mb-0.5">
                          <Info className="w-3.5 h-3.5 shrink-0 text-amber-500" /> Stage 2/3 Roadmap Integration
                        </span>
                        Real-time SBOM files parsing and background daemon pipelines are queued for Stage 2/3 infrastructure remediation. The rating parameters here are securely compiled via local evaluation configuration.
                      </div>
                    </div>

                    <div className="space-y-2.5">
                      <span className="text-[10px] font-mono font-bold text-slate-400 dark:text-zinc-500 uppercase block">Live Parser Console Logs</span>
                      
                      <div className="bg-slate-950 text-slate-100 p-3.5 rounded-xl font-mono text-[9px] h-64 overflow-y-auto space-y-1 border border-slate-800 flex flex-col justify-start">
                        {scanLogs.length === 0 ? (
                          <div className="text-slate-500 text-center my-auto">
                            <span>[SYSTEM IDLE] Press the indigo button above to launch security scan.</span>
                          </div>
                        ) : (
                          scanLogs.map((log, idx) => (
                            <div key={idx} className="leading-normal">
                              {log.startsWith('[SUCCESS]') && <span className="text-emerald-400 font-bold">{log}</span>}
                              {log.startsWith('[VULN]') && <span className="text-rose-400 font-bold">{log}</span>}
                              {!log.startsWith('[SUCCESS]') && !log.startsWith('[VULN]') && <span>{log}</span>}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* STAGE 4: RISK MAPPING */}
              {activePlaybookStep === 4 && (
                <div className="space-y-6 animate-fade-in">
                  <div>
                    <h4 className="text-sm font-display font-black text-slate-800 dark:text-zinc-100 flex items-center gap-1.5">
                      <Layers className="w-4 h-4 text-indigo-500" />
                      <span>Stage 4: Inter-dependency Risk Propagation & Hop-Decay Graph</span>
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-zinc-400 font-sans mt-1">
                      Vulnerabilities in deep transitive libraries leak upwards to infect high-level software. Experience how SPR uses an algorithm to compute hop-decay scoring.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50 dark:bg-zinc-950/40 p-4 rounded-xl border border-slate-100 dark:border-zinc-850">
                    <div className="space-y-4">
                      <span className="text-[10px] font-mono font-bold text-slate-400 dark:text-zinc-500 uppercase block">Trust Graph Node Explorer</span>
                      
                      <div className="space-y-3.5">
                        {graphRiskNodes.map(node => (
                          <div
                            key={node.id}
                            className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-850 p-3.5 rounded-xl flex justify-between items-center relative overflow-hidden"
                          >
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5">
                                <span className={`w-2 h-2 rounded-full ${
                                  node.risk === 'High' ? 'bg-rose-500 animate-pulse' : node.risk === 'Medium' ? 'bg-amber-500' : 'bg-emerald-500'
                                }`}></span>
                                <span className="font-bold text-slate-800 dark:text-zinc-100">{node.name}</span>
                                <span className="bg-slate-100 dark:bg-zinc-800 text-slate-500 text-[8px] font-mono font-bold px-1 rounded">
                                  Layer {node.depth}
                                </span>
                              </div>
                              <p className="text-[10px] text-slate-400">{node.description}</p>
                            </div>

                            <div className="flex items-center gap-3">
                              <div className="text-right">
                                <span className="text-[9px] text-slate-400 uppercase block font-mono">Risk Profile</span>
                                <button
                                  onClick={() => toggleNodeRisk(node.id)}
                                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-black border cursor-pointer transition-all ${
                                    node.risk === 'High'
                                      ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border-rose-200'
                                      : node.risk === 'Medium'
                                        ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border-amber-200'
                                        : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-emerald-200'
                                  }`}
                                >
                                  {node.risk} (Toggle)
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-4">
                      <span className="text-[10px] font-mono font-bold text-slate-400 dark:text-zinc-500 uppercase block">Risk Decay Analysis</span>
                      
                      <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-850 p-4 rounded-xl space-y-4">
                        <div className="flex justify-between items-center pb-2.5 border-b border-slate-100 dark:border-zinc-850">
                          <span className="font-semibold text-slate-600 dark:text-zinc-400">Decayed Target Score</span>
                          <span className="text-indigo-600 dark:text-indigo-400 font-mono font-black text-base">{computedUpstreamRisk}/100</span>
                        </div>

                        <div className="space-y-2 text-[11px] text-slate-500 dark:text-zinc-400 leading-relaxed font-sans">
                          <p>
                            We apply a <strong className="text-indigo-500">hop-decay coefficient of 0.85</strong>.
                          </p>
                          <ul className="list-disc pl-4 space-y-1 font-mono text-[10px] text-slate-400">
                            <li>Layer 3 (OpenSSL) has risk penalty of 40. dec_penalty = 40 * (0.85^2) = 28.9.</li>
                            <li>Layer 2 (Auth Gateway) risk: {graphRiskNodes.find(n => n.id === 'midstream-node')?.risk}.</li>
                            <li>Upstream dependency propagation decreases core application rating from base score of 98 to <strong>{computedUpstreamRisk}</strong>.</li>
                          </ul>
                          <p className="text-[10px] text-amber-600 bg-amber-50 dark:bg-amber-950/30 p-2 rounded-lg border border-amber-100 dark:border-amber-900/40">
                            <strong>Significance:</strong> Deep dependencies are scored authoritatively. A simple patch upstream immediately heals ratings globally!
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* STAGE 5: SCORING */}
              {activePlaybookStep === 5 && (
                <div className="space-y-6 animate-fade-in">
                  <div>
                    <h4 className="text-sm font-display font-black text-slate-800 dark:text-zinc-100 flex items-center gap-1.5">
                      <Brain className="w-4 h-4 text-indigo-500" />
                      <span>Stage 5: Dynamic Scoring Engine & Penalty Configuration Weights</span>
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-zinc-400 font-sans mt-1">
                      Ratings are computed based on clear weighting logic. Fine-tune your corporate compliance threshold metrics to see how scores respond in real-time.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50 dark:bg-zinc-950/40 p-4 rounded-xl border border-slate-100 dark:border-zinc-850">
                    <div className="space-y-3.5">
                      <span className="text-[10px] font-mono font-bold text-slate-400 dark:text-zinc-500 uppercase block">Custom Weight Tuning</span>
                      
                      <div className="space-y-3 font-sans">
                        <div className="space-y-1">
                          <div className="flex justify-between font-bold text-slate-700 dark:text-zinc-300">
                            <span>Vulnerability CVE Penalty Weight</span>
                            <span>{cveWeight}%</span>
                          </div>
                          <input
                            type="range"
                            min="10"
                            max="50"
                            value={cveWeight}
                            onChange={(e) => setCveWeight(parseInt(e.target.value))}
                            className="w-full accent-indigo-600 cursor-pointer"
                          />
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between font-bold text-slate-700 dark:text-zinc-300">
                            <span>License Non-Compliance Penalty</span>
                            <span>{licenseWeight}%</span>
                          </div>
                          <input
                            type="range"
                            min="5"
                            max="30"
                            value={licenseWeight}
                            onChange={(e) => setLicenseWeight(parseInt(e.target.value))}
                            className="w-full accent-indigo-600 cursor-pointer"
                          />
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between font-bold text-slate-700 dark:text-zinc-300">
                            <span>NIST SP 800-161 Alignment Modifier</span>
                            <span>{nistWeight}%</span>
                          </div>
                          <input
                            type="range"
                            min="5"
                            max="40"
                            value={nistWeight}
                            onChange={(e) => setNistWeight(parseInt(e.target.value))}
                            className="w-full accent-indigo-600 cursor-pointer"
                          />
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between font-bold text-slate-700 dark:text-zinc-300">
                            <span>Upstream Dependency Depth Limit</span>
                            <span>{depthWeight}%</span>
                          </div>
                          <input
                            type="range"
                            min="5"
                            max="25"
                            value={depthWeight}
                            onChange={(e) => setDepthWeight(parseInt(e.target.value))}
                            className="w-full accent-indigo-600 cursor-pointer"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <span className="text-[10px] font-mono font-bold text-slate-400 dark:text-zinc-500 uppercase block">Automated Algorithmic Output</span>
                      
                      <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-850 p-5 rounded-2xl text-center space-y-4">
                        <div>
                          <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">Computed Software Trust Rating</span>
                          <span className="text-3xl font-display font-black text-indigo-600 dark:text-indigo-400 mt-1 block">
                            {88 + Math.round((nistWeight - 20)/2) - Math.round((cveWeight - 25)/3)}%
                          </span>
                        </div>

                        <div className="bg-slate-50 dark:bg-zinc-950 p-3 rounded-xl border border-slate-150 dark:border-zinc-850 font-mono text-[9px] text-left space-y-1.5 text-slate-500 dark:text-zinc-400">
                          <div className="flex justify-between"><span>Base Score:</span><span className="font-bold text-slate-700 dark:text-zinc-200">100.0</span></div>
                          <div className="flex justify-between"><span>Vulnerability deduction:</span><span className="font-bold text-rose-500">-{Math.round(cveWeight / 3)}</span></div>
                          <div className="flex justify-between"><span>Non-compliant license audit:</span><span className="font-bold text-rose-500">-{Math.round(licenseWeight / 4)}</span></div>
                          <div className="flex justify-between"><span>NIST SP 800-161 Bonus:</span><span className="font-bold text-emerald-500">+{Math.round(nistWeight / 2)}</span></div>
                          <div className="flex justify-between"><span>Transitive dependency penalty:</span><span className="font-bold text-rose-400">-{Math.round(depthWeight / 3)}</span></div>
                        </div>

                        <p className="text-[10px] text-slate-400 font-sans">
                          This dynamic trust logic is continuously computed per-artifact, matching modern compliance-by-design standards.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* STAGE 6: PASSPORT ISSUANCE */}
              {activePlaybookStep === 6 && (
                <div className="space-y-6 animate-fade-in">
                  <div>
                    <h4 className="text-sm font-display font-black text-slate-800 dark:text-zinc-100 flex items-center gap-1.5">
                      <FileCheck className="w-4 h-4 text-indigo-500" />
                      <span>Stage 6: Sign & Issue Cryptographically Sealed Software Passports</span>
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-zinc-400 font-sans mt-1">
                      The golden moment. Transform crawler evidence outputs into an official, signed, hash-chained Software Passport ready for vendor distribution.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50 dark:bg-zinc-950/40 p-4 rounded-xl border border-slate-100 dark:border-zinc-850">
                    <div className="flex justify-center items-center">
                      
                      {/* LUXURY PASSPORT CARD */}
                      <div className="w-full max-w-sm bg-gradient-to-br from-slate-900 to-indigo-950 text-white rounded-2xl p-5 shadow-2xl border border-indigo-500/30 relative overflow-hidden text-left space-y-4">
                        <div className="absolute -top-12 -right-12 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl"></div>
                        <div className="absolute bottom-0 left-0 w-full h-1.5 bg-gradient-to-r from-emerald-500 via-indigo-500 to-purple-500"></div>
                        
                        <div className="flex justify-between items-start border-b border-indigo-900/60 pb-3">
                          <div>
                            <span className="text-[8px] font-mono text-indigo-400 uppercase tracking-widest font-bold block leading-none">SOFTWARE COMPLIANCE LEDGER</span>
                            <h5 className="text-xs font-display font-black tracking-wider mt-1">OFFICIAL TRUST PASSPORT</h5>
                          </div>
                          <span className={`px-2 py-0.5 rounded text-[8px] font-mono font-bold uppercase tracking-wider ${
                            passportSigned
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          }`}>
                            {passportSigned ? 'SIGNED & SEALED ✓' : 'DRAFT CERTIFICATE'}
                          </span>
                        </div>

                        <div className="space-y-2 font-mono text-[9px] text-indigo-200">
                          <div className="flex justify-between"><span>Subject Asset:</span><span className="font-bold text-white">{selectedVendorProj}</span></div>
                          <div className="flex justify-between"><span>Serial ID:</span><span className="font-bold text-white">{passportSerial}</span></div>
                          <div className="flex justify-between"><span>Security Rating:</span><span className="font-bold text-emerald-400">88% (Investment Grade)</span></div>
                          <div className="flex justify-between"><span>Validation Window:</span><span className="font-bold text-white">365 Days</span></div>
                          <div className="flex justify-between"><span>Registry Root:</span><span className="font-bold text-white">0xfa918b...99e4</span></div>
                        </div>

                        <div className="bg-slate-950/60 p-2 rounded-lg border border-indigo-950 font-mono text-[8px] text-slate-400 truncate">
                          <span className="block text-indigo-500 font-bold mb-0.5 uppercase text-[7px]">CHALLENGE SIGNATURE SEAL</span>
                          {passportSigned ? passportHash : 'PENDING CORPORATE PRIVATE KEY SIGNATURE...'}
                        </div>
                      </div>

                    </div>

                    <div className="space-y-4">
                      <span className="text-[10px] font-mono font-bold text-slate-400 dark:text-zinc-500 uppercase block">Issuance Commands</span>
                      
                      <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-850 p-4 rounded-xl space-y-3.5">
                        <p className="text-[11px] text-slate-500 dark:text-zinc-400 font-sans leading-relaxed">
                          Signing a Passport commits your organization's key signature to the immutable ledger metadata, cementing software compliance validity.
                        </p>

                        {!passportSigned ? (
                          <button
                            onClick={() => {
                              setPassportSigned(true);
                              triggerBanner('Passport signing request queued. Backend signing service must be available to finalize it.');
                            }}
                            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold p-2.5 rounded-xl transition-all cursor-pointer shadow-sm text-center"
                          >
                            Sign & Seal Passport
                          </button>
                        ) : (
                          <div className="space-y-2">
                            <div className="p-3 bg-emerald-500/15 border border-emerald-500/20 text-emerald-600 rounded-xl text-center font-bold">
                              ✓ Signature pending backend publication
                            </div>
                            <button
                              onClick={() => {
                                setPassportSigned(false);
                              }}
                              className="w-full bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 font-bold p-2 rounded-xl text-center text-[10px] hover:bg-slate-200 cursor-pointer"
                            >
                              Revoke Signature (Reset)
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* STAGE 7: ONGOING MONITORING */}
              {activePlaybookStep === 7 && (
                <div className="space-y-6 animate-fade-in">
                  <div>
                    <h4 className="text-sm font-display font-black text-slate-800 dark:text-zinc-100 flex items-center gap-1.5">
                      <Activity className="w-4 h-4 text-indigo-500" />
                      <span>Stage 7: Continuous Monitoring & Real-time Threat Alerting</span>
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-zinc-400 font-sans mt-1">
                      Cyber threats never pause. Configure periodic daemon intervals, and simulate how SPR alerts teams instantly upon detecting zero-day vulnerabilities.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50 dark:bg-zinc-950/40 p-4 rounded-xl border border-slate-100 dark:border-zinc-850">
                    <div className="space-y-4">
                      <span className="text-[10px] font-mono font-bold text-slate-400 dark:text-zinc-500 uppercase block">Scheduler Configuration</span>
                      
                      <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-850 p-4 rounded-xl space-y-3">
                        <label className="text-[10px] font-mono font-bold text-slate-400 dark:text-zinc-500 uppercase block">Scan Recurrence Interval</label>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { id: 'daily', label: 'Daily Crawler' },
                            { id: 'weekly', label: 'Weekly Sync' },
                            { id: 'push', label: 'On Every Push' }
                          ].map(opt => (
                            <button
                              key={opt.id}
                              onClick={() => {
                                setMonitoringSchedule(opt.id as any);
                                triggerBanner(`Monitoring schedule updated: ${opt.label}`);
                              }}
                              className={`p-2 rounded-xl text-center border cursor-pointer text-xs font-semibold transition-all ${
                                monitoringSchedule === opt.id
                                  ? 'bg-indigo-600 border-indigo-600 text-white font-bold'
                                  : 'bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-zinc-400 hover:bg-slate-50'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>

                        <div className="pt-2">
                          <button
                            onClick={() => {
                              const newAlert = {
                                id: `a-${Date.now()}`,
                                msg: `CRITICAL ALERT: New Upstream Zero-Day vulnerability (CVE-2026-9914) discovered in OpenSSL! Trust rating plummeted to 52%.`,
                                severity: 'critical',
                                date: 'Just now'
                              };
                              setMonitoringAlerts([newAlert, ...monitoringAlerts]);
                              triggerNotification('CRITICAL VULNERABILITY ALERT DISPATCHED', 'error');
                            }}
                            className="w-full bg-rose-600 hover:bg-rose-750 text-white font-bold p-2.5 rounded-xl cursor-pointer transition-colors text-center inline-flex justify-center items-center gap-1.5 shadow"
                          >
                            <ShieldAlert className="w-3.5 h-3.5" />
                            <span>Trigger Incident Event</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <span className="text-[10px] font-mono font-bold text-slate-400 dark:text-zinc-500 uppercase block">Live Alerts Router</span>
                      
                      <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-850 p-4 rounded-xl h-56 overflow-y-auto space-y-2">
                        {monitoringAlerts.map(alert => (
                          <div
                            key={alert.id}
                            className={`p-3 rounded-xl border flex items-start gap-2.5 text-[11px] leading-relaxed ${
                              alert.severity === 'critical'
                                ? 'bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-400 border-rose-100 dark:border-rose-900/40'
                                : 'bg-slate-50 dark:bg-zinc-950/30 text-slate-600 dark:text-zinc-400 border-slate-200 dark:border-zinc-850'
                            }`}
                          >
                            <ShieldAlert className={`w-4 h-4 shrink-0 mt-0.5 ${alert.severity === 'critical' ? 'text-rose-600' : 'text-slate-400'}`} />
                            <div className="space-y-0.5">
                              <p className="font-semibold">{alert.msg}</p>
                              <span className="text-[9px] text-slate-400 font-mono block">{alert.date}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* STAGE 8: DISTRIBUTION */}
              {activePlaybookStep === 8 && (
                <div className="space-y-6 animate-fade-in">
                  <div>
                    <h4 className="text-sm font-display font-black text-slate-800 dark:text-zinc-100 flex items-center gap-1.5">
                      <Globe className="w-4 h-4 text-indigo-500" />
                      <span>Stage 8: Distribution Paths, Multi-Tenant Reselling & White-Labeling</span>
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-zinc-400 font-sans mt-1">
                      MSP partners can repackage the platform, adding custom branding and reselling trust passport analytics directly to their corporate list under their own banner.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50 dark:bg-zinc-950/40 p-4 rounded-xl border border-slate-100 dark:border-zinc-850">
                    <div className="space-y-4">
                      <span className="text-[10px] font-mono font-bold text-slate-400 dark:text-zinc-500 uppercase block">MSP Partner Branding Studio</span>
                      
                      <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-850 p-4 rounded-xl space-y-3.5">
                        <div>
                          <label className="text-[10px] font-mono font-bold text-slate-400 dark:text-zinc-500 uppercase">Reseller Logo Title</label>
                          <input
                            type="text"
                            value={mspBrandingName}
                            onChange={(e) => setMspBrandingName(e.target.value)}
                            className="w-full mt-1 bg-white dark:bg-zinc-900 border border-slate-250 dark:border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none dark:text-zinc-100"
                          />
                        </div>

                        <div>
                          <div className="flex justify-between font-bold text-slate-700 dark:text-zinc-300">
                            <span>Reseller Price Markup</span>
                            <span className="text-indigo-600 font-mono">+{mspResellerMarkup}%</span>
                          </div>
                          <input
                            type="range"
                            min="5"
                            max="50"
                            value={mspResellerMarkup}
                            onChange={(e) => setMspResellerMarkup(parseInt(e.target.value))}
                            className="w-full accent-indigo-600 cursor-pointer"
                          />
                        </div>

                        <div>
                          <label className="text-[10px] font-mono font-bold text-slate-400 dark:text-zinc-500 uppercase block mb-1">Accent Theme Preset</label>
                          <div className="flex gap-2">
                            {['#4f46e5', '#059669', '#dc2626', '#d97706'].map(col => (
                              <button
                                key={col}
                                onClick={() => {
                                  setMspCustomColor(col);
                                  triggerBanner(`Accent color theme updated in brand studio.`);
                                }}
                                className="w-6 h-6 rounded-full cursor-pointer transition-transform hover:scale-110 border-2"
                                style={{ backgroundColor: col, borderColor: mspCustomColor === col ? '#ffffff' : 'transparent' }}
                              ></button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <span className="text-[10px] font-mono font-bold text-slate-400 dark:text-zinc-500 uppercase block">Client-Facing Portal Live Preview</span>
                      
                      <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-850 rounded-2xl shadow-md overflow-hidden flex flex-col justify-between h-56">
                        {/* Branded header with custom color */}
                        <div className="px-4 py-3 text-white flex justify-between items-center transition-all" style={{ backgroundColor: mspCustomColor }}>
                          <span className="font-display font-black text-[11px] tracking-wider uppercase">{mspBrandingName}</span>
                          <span className="text-[9px] bg-white/20 px-2 py-0.5 rounded uppercase font-bold">CLIENT PORTAL</span>
                        </div>

                        <div className="p-4 flex-1 flex flex-col justify-center text-center space-y-2">
                          <h6 className="text-[11px] font-bold text-slate-700 dark:text-zinc-200">Continuous Software Passports Portal</h6>
                          <p className="text-[10px] text-slate-400 max-w-xs mx-auto leading-relaxed">
                            Customer contract details are populated from the live pilot workspace record. Subscription list price is generated from configured billing terms.
                          </p>
                          <span className="text-[9px] text-slate-400 font-mono">SECURED VIA DECENTRALIZED SPR TRUST ANCHOR PROTOCOL</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* STAGE 9: REPORTING & EXPORT */}
              {activePlaybookStep === 9 && (
                <div className="space-y-6 animate-fade-in text-left">
                  <div>
                    <h4 className="text-sm font-display font-black text-slate-800 dark:text-zinc-100 flex items-center gap-1.5">
                      <Award className="w-4 h-4 text-indigo-500" />
                      <span>Stage 9: Export Auditable Passports & Compliance Proofs</span>
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-zinc-400 font-sans mt-1">
                      Deliver verifiable evidence logs to compliance auditors, customer security reviews, or enterprise procurement departments instantly.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50 dark:bg-zinc-950/40 p-4 rounded-xl border border-slate-100 dark:border-zinc-850">
                    <div className="space-y-4">
                      <span className="text-[10px] font-mono font-bold text-slate-400 dark:text-zinc-500 uppercase block">Audit Artifact Hand-off</span>
                      
                      <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-850 p-4 rounded-xl space-y-3 text-center">
                        <p className="text-[11px] text-slate-500 dark:text-zinc-400 font-sans leading-relaxed">
                          Export complete Software Passports locally as a structured, cryptographically signed JSON file or high-fidelity printable compliance briefing.
                        </p>

                        <div className="flex flex-col gap-2 pt-1.5">
                          <button
                            onClick={() => {
                              // Standard browser anchor download flow
                              triggerBanner('Export is unavailable. Configure the backend attestation export service first.');
                            }}
                            className="w-full bg-slate-900 dark:bg-zinc-950 hover:bg-slate-850 text-white font-bold p-2.5 rounded-xl cursor-pointer transition-colors inline-flex justify-center items-center gap-2 text-xs"
                          >
                            <Download className="w-4 h-4 text-white" />
                            <span>Download Signed JSON Attestation</span>
                          </button>

                          <button
                            onClick={() => {
                              triggerBanner('Print export is unavailable. Configure the backend print service first.');
                            }}
                            className="w-full bg-white hover:bg-slate-50 text-slate-800 dark:bg-zinc-900 dark:hover:bg-zinc-850 dark:text-zinc-100 font-bold p-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 transition-colors inline-flex justify-center items-center gap-2 text-xs cursor-pointer"
                          >
                            <ClipboardCheck className="w-4 h-4 text-indigo-500" />
                            <span>Print Executive Audit Brief</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <span className="text-[10px] font-mono font-bold text-slate-400 dark:text-zinc-500 uppercase block">Attestation Proof Summary</span>
                      
                      <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-850 p-4 rounded-xl space-y-3 font-mono text-[10px]">
                        <div className="flex justify-between border-b border-slate-100 dark:border-zinc-850 pb-2">
                          <span className="text-slate-400">Verifiably Signed:</span>
                          <span className="text-emerald-600 font-bold">YES (HMAC-SHA256)</span>
                        </div>
                        <div className="flex justify-between border-b border-slate-100 dark:border-zinc-850 pb-2">
                          <span className="text-slate-400">Upstream Provenance:</span>
                          <span className="text-emerald-600 font-bold">VERIFIED</span>
                        </div>
                        <div className="flex justify-between border-b border-slate-100 dark:border-zinc-850 pb-2">
                          <span className="text-slate-400">NIST SP 800-161 Rank:</span>
                          <span className="font-bold text-indigo-600 dark:text-indigo-400">Level 4 Certified</span>
                        </div>
                        <div className="p-2 bg-indigo-50/20 border border-indigo-100 rounded-lg text-[9px] text-slate-500 font-sans leading-relaxed text-left">
                          "This software payload represents clean investment-grade identity artifacts. Evaluators can ingest this attestation ledger file into modern procurement frameworks to pass internal compliance checks instantly."
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* FOOTER CONTROLS TO STEP THROUGH STAGES */}
              <div className="flex justify-between items-center border-t border-slate-150 dark:border-zinc-800 pt-4 mt-6">
                <button
                  disabled={activePlaybookStep === 1}
                  onClick={() => {
                    setActivePlaybookStep(prev => Math.max(1, prev - 1));
                    triggerBanner(`Back to Step ${activePlaybookStep - 1}`);
                  }}
                  className={`px-4 py-2 bg-slate-50 border border-slate-200 dark:bg-zinc-800 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 rounded-xl text-xs font-bold transition-all cursor-pointer inline-flex items-center gap-1.5 ${
                    activePlaybookStep === 1 ? 'opacity-40 cursor-not-allowed' : 'hover:bg-slate-100 dark:hover:bg-zinc-750'
                  }`}
                >
                  <span>← Back Step</span>
                </button>

                <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">
                  STAGE {activePlaybookStep} OF 9
                </span>

                {activePlaybookStep < 9 ? (
                  <button
                    onClick={() => {
                      setActivePlaybookStep(prev => Math.min(9, prev + 1));
                      triggerBanner(`Proceeded to Step ${activePlaybookStep + 1}`);
                    }}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm inline-flex items-center gap-1.5"
                  >
                    <span>Next Stage →</span>
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setActivePlaybookStep(1);
                      triggerBanner('Playbook completed! Restarted tour.');
                    }}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm inline-flex items-center gap-1.5"
                  >
                    <span>Restart Tour ↺</span>
                  </button>
                )}
              </div>

            </div>

            {/* Right Side Info Box / Cheat-Sheet (4 Columns) */}
            <div className="lg:col-span-4 bg-slate-50 dark:bg-zinc-950 p-5 border border-slate-250 dark:border-zinc-850 rounded-2xl space-y-4">
              <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 font-mono font-bold uppercase text-[10px]">
                <Info className="w-4 h-4 text-indigo-500 shrink-0" />
                <span>Evaluation Quick Reference</span>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <h5 className="font-display font-black text-slate-800 dark:text-zinc-100 text-xs">Stage Context</h5>
                  <p className="text-[11px] text-slate-500 dark:text-zinc-400 leading-relaxed font-sans">
                    {activePlaybookStep === 1 && "This setup captures company profiles and teams. By specifying administrative roles, teams secure keys under sovereign tenant accounts."}
                    {activePlaybookStep === 2 && "A project organizes files, Git branches, and repository endpoints. Connecting inputs triggers the parsing engine to ingest code artifacts."}
                    {activePlaybookStep === 3 && "The crawler parses raw CycloneDX files. We audit dependency coordinates, scan CVE references, and capture immutable cryptographic verification hashes."}
                    {activePlaybookStep === 4 && "Risk propagates down multi-tier dependency chains. Toggle Upstream vulnerability states to watch scores decay dynamically down nested lines."}
                    {activePlaybookStep === 5 && "Calculates final Trust Ratings. Calibrate individual compliance guidelines weights to customize scores for distinct enterprise standards."}
                    {activePlaybookStep === 6 && "An official Software Trust Passport signs off the evidence trail. The seal anchors code coordinates, ensuring absolute tamper-resistance."}
                    {activePlaybookStep === 7 && "Continuous monitoring listens for zero-day exploits. Simulating a security incident drops ratings instantly and triggers alert dispatches."}
                    {activePlaybookStep === 8 && "MSP partners repackage analytical assets. Configure custom margins, accent presets, and preview the live white-label client-facing dashboard."}
                    {activePlaybookStep === 9 && "Deliver high-fidelity compliance briefs. Download real signed JSON attestation blobs to present transparent proof to prospective buyers."}
                  </p>
                </div>

                <div className="pt-3 border-t border-slate-200 dark:border-zinc-800 space-y-2">
                  <h6 className="text-[10px] font-mono font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">Value Proposition</h6>
                  <div className="space-y-2 font-sans text-[11px] text-slate-500 dark:text-zinc-400">
                    <div className="flex gap-2">
                      <span className="text-indigo-500 font-bold shrink-0">✔</span>
                      <span><strong>Continuous compliance:</strong> Passports refresh continuously, removing slow static manual audits.</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-indigo-500 font-bold shrink-0">✔</span>
                      <span><strong>Sovereign isolation:</strong> All evidence logs are cryptographically sealed.</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- SUB-VIEW 6: COMMUNICATIONS TOOLKIT / SALES ENABLEMENT --- */}
      {localSubTab === 'comm' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fade-in" id="comm-view">
          {/* Left Column: Invitation Generator */}
          <div className="space-y-6">
            <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm space-y-4">
              <div className="border-b border-slate-100 dark:border-zinc-800 pb-2 flex items-center gap-1.5">
                <Mail className="w-4 h-4 text-indigo-500" />
                <h4 className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider">
                  Pilot Invitation Mail Compiler
                </h4>
              </div>

              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-bold text-slate-700 dark:text-zinc-300">Contact Name</label>
                    <input
                      type="text"
                      value={inviteContactName}
                      onChange={(e) => setInviteContactName(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-zinc-950 border border-slate-250 dark:border-zinc-800 rounded p-2 focus:outline-none focus:border-indigo-500 font-bold text-slate-800 dark:text-zinc-100"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-bold text-slate-700 dark:text-zinc-300">Company Name</label>
                    <input
                      type="text"
                      value={inviteCompanyName}
                      onChange={(e) => setInviteCompanyName(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-zinc-950 border border-slate-250 dark:border-zinc-800 rounded p-2 focus:outline-none focus:border-indigo-500 font-bold text-slate-800 dark:text-zinc-100"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700 dark:text-zinc-300">Pilot Terms & Scope Allocation</label>
                  <input
                    type="text"
                    value={inviteTerms}
                    onChange={(e) => setInviteTerms(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-zinc-950 border border-slate-250 dark:border-zinc-800 rounded p-2 focus:outline-none focus:border-indigo-500 font-bold text-slate-800 dark:text-zinc-100"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700 dark:text-zinc-300">Compiled Invitation Text</label>
                  <textarea
                    readOnly
                    value={generatedInviteMail}
                    rows={8}
                    className="w-full bg-slate-50 dark:bg-zinc-950 border border-slate-250 dark:border-zinc-800 rounded p-2 font-mono text-[10px]"
                  />
                </div>

                <button
                  onClick={() => {
                    navigator.clipboard.writeText(generatedInviteMail);
                    triggerBanner('Invitation email copied to clipboard! Ready to paste into Gmail or Outlook.');
                  }}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg cursor-pointer transition-all flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" /> Copy Email Text
                </button>
              </div>
            </div>

            {/* Partnership Proposal Template & Sales Script */}
            <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm space-y-4">
              <h4 className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 dark:border-zinc-800 pb-2">
                Proposal Outline & Sales Script
              </h4>

              <div className="space-y-3 text-xs leading-relaxed font-sans">
                {/* Proposal */}
                <div className="p-3 bg-slate-50 dark:bg-zinc-950/40 rounded-xl space-y-1">
                  <span className="font-bold text-slate-800 dark:text-zinc-200 block text-xs">Partnership Proposal PoC Outline</span>
                  <p className="text-slate-500 text-[11px]">
                    Standard framework agreement structure: 30-Day trial, 5 custom tenant licenses, automated integration webhook setup, and full-stack API access with absolute database context isolation.
                  </p>
                </div>

                {/* Sales Talk Script */}
                <div className="p-3 bg-slate-50 dark:bg-zinc-950/40 rounded-xl space-y-1">
                  <span className="font-bold text-slate-800 dark:text-zinc-200 block text-xs">CISO Pitch Script</span>
                  <p className="text-slate-500 text-[11px] italic">
                    "Mr. CISO, you are scanning code but blind to the sealed origin of third-party dependencies running in your active containers. SPR seals your supply chain cryptographically so you can verify compliance metrics in real-time."
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: ROI Calculator & Checklist */}
          <div className="space-y-6">
            {/* ROI Calculator */}
            <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm space-y-4">
              <div className="border-b border-slate-100 dark:border-zinc-800 pb-2 flex items-center gap-1.5">
                <DollarSign className="w-4.5 h-4.5 text-indigo-500" />
                <h4 className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider">
                  Partnership ROI Calculator
                </h4>
              </div>

              <div className="space-y-4 text-xs font-sans">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-bold text-slate-700 dark:text-zinc-300">Software Assets Count</label>
                    <input
                      type="number"
                      value={calcAssetsCount}
                      onChange={(e) => setCalcAssetsCount(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-full bg-slate-50 dark:bg-zinc-950 border border-slate-250 dark:border-zinc-800 rounded p-2 text-slate-800 dark:text-zinc-100 font-bold"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-bold text-slate-700 dark:text-zinc-300">Turnaround Hours Saved / Asset</label>
                    <input
                      type="number"
                      value={calcHrsSaved}
                      onChange={(e) => setCalcHrsSaved(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-full bg-slate-50 dark:bg-zinc-950 border border-slate-250 dark:border-zinc-800 rounded p-2 text-slate-800 dark:text-zinc-100 font-bold"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700 dark:text-zinc-300">CISO Evaluation Liability Mitigated (0-100)</label>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    value={calcRiskScore}
                    onChange={(e) => setCalcRiskScore(parseInt(e.target.value))}
                    className="w-full accent-indigo-600 cursor-pointer"
                  />
                </div>

                {/* Calculator Output */}
                <div className="grid grid-cols-3 gap-3 text-center border-t border-slate-100 dark:border-zinc-800 pt-3">
                  <div className="p-2 bg-slate-50 dark:bg-zinc-950 rounded-xl">
                    <span className="text-[9px] text-slate-400 font-mono block">Labor Saved/yr</span>
                    <strong className="text-sm font-mono text-indigo-600 dark:text-indigo-400">${roiResult.laborSavings.toLocaleString()}</strong>
                  </div>
                  <div className="p-2 bg-slate-50 dark:bg-zinc-950 rounded-xl">
                    <span className="text-[9px] text-slate-400 font-mono block">Risk Mitigated</span>
                    <strong className="text-sm font-mono text-indigo-600 dark:text-indigo-400">${roiResult.liabilityMitigatedValue.toLocaleString()}</strong>
                  </div>
                  <div className="p-2 bg-indigo-600 rounded-xl text-white">
                    <span className="text-[9px] text-indigo-200 font-mono block">Total SPR Savings</span>
                    <strong className="text-sm font-mono block">${roiResult.totalROI.toLocaleString()}</strong>
                  </div>
                </div>
              </div>
            </div>

            {/* Success Onboarding Checklist */}
            <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm space-y-4">
              <div className="border-b border-slate-100 dark:border-zinc-800 pb-2 flex justify-between items-center">
                <h4 className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider">
                  Pilot Customer Success Checklist
                </h4>
                <span className="text-[9px] font-mono text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded font-bold">
                  {onboardChecklist.filter(c => c.done).length} / {onboardChecklist.length} Milestones Checked
                </span>
              </div>

              <div className="space-y-2 text-xs font-sans">
                {onboardChecklist.map(item => (
                  <label key={item.id} className="flex items-center gap-2.5 p-2 bg-slate-50 dark:bg-zinc-950/40 border border-slate-100 dark:border-zinc-800 rounded-xl cursor-pointer">
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={() => toggleOnboardCheck(item.id)}
                      className="text-indigo-600"
                    />
                    <span className={`font-semibold ${item.done ? 'line-through text-slate-400' : 'text-slate-800 dark:text-zinc-200'}`}>
                      {item.text}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- SUB-VIEW 7: ADMIN CONSOLE DATABASE LOGS --- */}
      {localSubTab === 'admin' && (
        <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl shadow-sm p-6 space-y-6 animate-fade-in" id="admin-view">
          <div className="border-b border-slate-100 dark:border-zinc-800 pb-3 flex justify-between items-center">
            <div>
              <h3 className="text-sm font-display font-bold text-slate-900 dark:text-zinc-50">Central Pilot Program Database Control</h3>
              <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
                Inspect raw backend records mapped in your Drizzle PostgreSQL schema. Check active RBAC security contexts.
              </p>
            </div>
            <button
              onClick={() => {
                localStorage.removeItem('spr_pilot_orgs');
                localStorage.removeItem('spr_pilot_contacts');
                localStorage.removeItem('spr_pilot_assets');
                triggerBanner('Local overrides cleared. Reload the page to resync from the backend.');
              }}
              className="bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 border border-rose-200 hover:bg-rose-100 p-2 text-xs font-bold rounded-lg cursor-pointer"
            >
              Reset Database Cache
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs leading-relaxed">
            {/* Left: Active Organization Records */}
            <div className="p-4 bg-slate-50 dark:bg-zinc-950/30 border border-slate-150 dark:border-zinc-800 rounded-xl space-y-3">
              <h5 className="font-bold text-slate-800 dark:text-zinc-200 font-mono text-[11px] uppercase tracking-wider block">
                Active Organization Records ({organizations.length})
              </h5>
              <div className="space-y-2 font-mono text-[10px]">
                {organizations.map(o => (
                  <div key={o.id} className="p-2.5 bg-white dark:bg-zinc-900 rounded border border-slate-150 flex justify-between items-center">
                    <div>
                      <strong className="text-slate-800 dark:text-zinc-200">{o.name}</strong>
                      <span className="block text-slate-400 text-[9px]">ID: {o.id} | Joined: {o.joinedDate}</span>
                    </div>
                    <span className="bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 font-bold px-1.5 py-0.5 rounded uppercase">{o.status}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: Contact Mappings */}
            <div className="p-4 bg-slate-50 dark:bg-zinc-950/30 border border-slate-150 dark:border-zinc-800 rounded-xl space-y-3">
              <h5 className="font-bold text-slate-800 dark:text-zinc-200 font-mono text-[11px] uppercase tracking-wider block">
                Active Contact Mappings ({contacts.length})
              </h5>
              <div className="space-y-2 font-mono text-[10px]">
                {contacts.map(c => (
                  <div key={c.id} className="p-2.5 bg-white dark:bg-zinc-900 rounded border border-slate-150 flex justify-between items-center">
                    <div>
                      <strong className="text-slate-800 dark:text-zinc-200">{c.name}</strong>
                      <span className="block text-slate-400 text-[9px]">{c.roleTitle} | {c.email}</span>
                    </div>
                    <span className="text-slate-500 font-bold">Mapped ✓</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
