/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Client, SoftwarePassport, Vendor, Scan, Alert, Integration, AlertStatus, Severity } from './types';

// Import Modular Views
import Sidebar from './components/Sidebar';
import PartnerProgramView from './components/PartnerProgramView';
import Header from './components/Header';
import MSPCommandCenter from './components/MSPCommandCenter';
import MonitoringView from './components/MonitoringView';
import ClientsView from './components/ClientsView';
import PassportsView from './components/PassportsView';
import PassportSwarmView from './components/PassportSwarmView';
import VendorsView from './components/VendorsView';
import SecurityCenterView from './components/SecurityCenterView';
import ComplianceView from './components/ComplianceView';
import TrustBrainView from './components/TrustBrainView';
import ReportsView from './components/ReportsView';
import AssetsView from './components/AssetsView';
import ScansView from './components/ScansView';
import AlertsView from './components/AlertsView';
import IntegrationsView from './components/IntegrationsView';
import BillingView from './components/BillingView';
import SettingsView from './components/SettingsView';
import TrustOSView from './components/TrustOSView';
import EnterpriseReadinessView from './components/EnterpriseReadinessView';
import PilotProgramView from './components/PilotProgramView';
import QuickActionsSpeedDial from './components/QuickActionsSpeedDial';
import { apiFetch } from './utils/apiClient';
import { auth } from './lib/firebase';
import { sendEmailVerification, signOut } from 'firebase/auth';
import LoginView from './components/LoginView';
import PaywallOverlay from './components/PaywallOverlay';
import OnboardingWizard from './components/OnboardingWizard';
import ExtensionMarketplace from './components/ExtensionMarketplace';
import TrustOSTutorial from './components/TrustOSTutorial';
import FounderDashboardView from './components/FounderDashboardView';

// Modals Icons
import { CheckCircle2, X, ShieldAlert, Sparkles, Plus, Layers, HelpCircle, RefreshCw } from 'lucide-react';

export default function App() {


  // Authentication & Dynamic RBAC Session States
  // Firebase and /api/user/me are the only sources of truth for session state.
  // localStorage is never trusted for identity, roles, or onboarding status.
  const [user, setUser] = useState<any>(null);
  const [userRole, setUserRole] = useState<string>('Viewer');
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Global Shared States
  const [clients, setClients] = useState<Client[]>([]);
  const [passports, setPassports] = useState<SoftwarePassport[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [scans, setScans] = useState<Scan[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [assets, setAssets] = useState<any[]>(() => {
    const saved = localStorage.getItem('msp_assets');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return [];
  });

  useEffect(() => {
    localStorage.setItem('msp_assets', JSON.stringify(assets));
  }, [assets]);

  // Listen for expired or invalid authentication sessions
  useEffect(() => {
    const handleAuthExpired = () => {
      console.warn('[Session Expiration] Detected expired or invalid token. Clearing cached session and redirecting to login.');
      localStorage.removeItem('msp_user');
      setUser(null);
      setOnboarded(false);
      setUserRole('Viewer');
      auth.signOut().catch(() => {});
    };

    window.addEventListener('auth-expired', handleAuthExpired);
    return () => {
      window.removeEventListener('auth-expired', handleAuthExpired);
    };
  }, []);

  // Synchronize actual Firebase authentication states
  useEffect(() => {
    const unsubscribe = auth.onIdTokenChanged(async (firebaseUser) => {
      if (firebaseUser) {
        setAuthLoading(true);
        try {
          const idTokenResult = await firebaseUser.getIdTokenResult(true);
          const claims = idTokenResult.claims;
          const jwtRole = (claims.role as string) || 'Viewer';
          const jwtWorkspaceId = (claims.workspaceId as string) || (claims.tenantId as string);
          const emailVerified = firebaseUser.emailVerified || !!claims.email_verified;

          const res = await apiFetch('/api/user/me');
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body?.error || `Profile request failed (${res.status})`);
          }
          const fullProfile: any = await res.json();

          const activeRole = fullProfile.role || jwtRole;
          const activeUser = {
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0],
            token: idTokenResult.token,
            role: activeRole,
            workspaceId: fullProfile.tenantId || jwtWorkspaceId,
            emailVerified,
            onboarded: fullProfile.onboarded === 1
          };

          localStorage.setItem('msp_user', JSON.stringify(activeUser));
          setUser(activeUser);
          setUserRole(activeRole);
          setOnboarded(fullProfile.onboarded === 1);
        } catch (err) {
          console.error('[Firebase Auth Sync Error]:', err);
          localStorage.removeItem('msp_user');
          setUser(null);
          setUserRole('Viewer');
          setOnboarded(false);
        } finally {
          setAuthLoading(false);
        }
      } else {
        console.log('[Firebase Auth Sync] Firebase Auth session is null. Clearing cached session.');
        localStorage.removeItem('msp_user');
        setUser(null);
        setUserRole('Viewer');
        setOnboarded(false);
        setAuthLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  // Fetch synchronized datasets once authenticated
  useEffect(() => {
    if (!user || !user.uid) {
      setClients([]);
      setPassports([]);
      setScans([]);
      setAlerts([]);
      setIntegrations([]);
      return;
    }

    // Pull database registers isolated by tenant domain
    apiFetch('/api/clients')
      .then(res => {
        if (res.ok) return res.json();
        throw new Error('Failed to fetch clients');
      })
      .then(data => setClients(data))
      .catch(err => console.error('Error fetching clients:', err));

    apiFetch('/api/passports')
      .then(res => {
        if (res.ok) return res.json();
        throw new Error('Failed to fetch passports');
      })
      .then(data => setPassports(data))
      .catch(err => console.error('Error fetching passports:', err));

    apiFetch('/api/scans')
      .then(res => {
        if (res.ok) return res.json();
        throw new Error('Failed to fetch scans');
      })
      .then(data => setScans(data))
      .catch(err => console.error('Error fetching scans:', err));

    apiFetch('/api/alerts')
      .then(res => {
        if (res.ok) return res.json();
        throw new Error('Failed to fetch alerts');
      })
      .then(data => setAlerts(data))
      .catch(err => console.error('Error fetching alerts:', err));

    apiFetch('/api/integrations')
      .then(res => {
        if (res.ok) return res.json();
        throw new Error('Failed to fetch integrations');
      })
      .then(data => setIntegrations(data))
      .catch(err => console.error('Error fetching integrations:', err));

    apiFetch('/api/vendors')
      .then(res => {
        if (res.ok) return res.json();
        throw new Error('Failed to fetch vendors');
      })
      .then(data => setVendors(data))
      .catch(err => console.error('Error fetching vendors:', err));

    const handleRefresh = () => {
      if (!user || !user.uid) return;
      apiFetch('/api/clients').then(res => res.ok && res.json()).then(data => data && setClients(data));
      apiFetch('/api/passports').then(res => res.ok && res.json()).then(data => data && setPassports(data));
      apiFetch('/api/scans').then(res => res.ok && res.json()).then(data => data && setScans(data));
      apiFetch('/api/alerts').then(res => res.ok && res.json()).then(data => data && setAlerts(data));
      apiFetch('/api/integrations').then(res => res.ok && res.json()).then(data => data && setIntegrations(data));
      apiFetch('/api/vendors').then(res => res.ok && res.json()).then(data => data && setVendors(data));
    };

    window.addEventListener('refresh-data', handleRefresh);
    return () => {
      window.removeEventListener('refresh-data', handleRefresh);
    };
  }, [user?.uid, user?.tenantId]);

  const handleChangeRole = async (newRole: string) => {
    try {
      const res = await apiFetch('/api/user/role', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole })
      });
      if (res.ok) {
        const profileResponse = await apiFetch('/api/user/me');
        if (!profileResponse.ok) {
          throw new Error('Role changed, but the updated profile could not be loaded.');
        }
        const profile = await profileResponse.json();
        setUserRole(profile.role);
        setUser((current: any) => current ? { ...current, role: profile.role } : current);
        triggerNotification(`Role updated to ${profile.role}`, 'success');
        // Refresh client-side views safely
        apiFetch('/api/clients').then(r => r.ok ? r.json() : null).then(data => data && setClients(data)).catch(() => {});
        apiFetch('/api/passports').then(r => r.ok ? r.json() : null).then(data => data && setPassports(data)).catch(() => {});
        apiFetch('/api/alerts').then(r => r.ok ? r.json() : null).then(data => data && setAlerts(data)).catch(() => {});
        apiFetch('/api/vendors').then(r => r.ok ? r.json() : null).then(data => data && setVendors(data)).catch(() => {});
      } else {
        let errMessage = 'Permission denied';
        try {
          const contentType = res.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const errData = await res.json();
            errMessage = errData.error || errData.message || errMessage;
          } else {
            const text = await res.text();
            if (text && !text.includes('<!DOCTYPE') && !text.includes('<html')) {
              errMessage = text.substring(0, 100);
            }
          }
        } catch {
          // ignore parsing failures
        }
        triggerNotification(errMessage, 'info');
      }
    } catch (err) {
      console.error('Failed to change role on backend:', err);
      triggerNotification('Your role could not be changed.', 'info');
    }
  };

  const handleUpgradeSuccess = (updatedClient: Client) => {
    setClients(prev => prev.map(c => c.id === updatedClient.id ? updatedClient : c));
    triggerNotification(`Successfully upgraded ${updatedClient.name} to ${updatedClient.subscriptionTier}!`, 'success');
  };

  // Theme Management
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark' || savedTheme === 'light') {
      return savedTheme;
    }
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return systemPrefersDark ? 'dark' : 'light';
  });

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [theme]);

  // Proactively trigger the onboarding tour once on initial session load
  useEffect(() => {
    const hasSeenTour = localStorage.getItem('has_seen_trust_os_tour_v2');
    if (!hasSeenTour) {
      setIsTutorialOpen(true);
      localStorage.setItem('has_seen_trust_os_tour_v2', 'true');
    }
  }, []);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };
  
  // Navigation & Context Selector States
  const [selectedClientId, setSelectedClientId] = useState<string>('global');
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [selectedPassportId, setSelectedPassportId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Dynamic Modular Extension States
  const [installedExtensions, setInstalledExtensions] = useState<string[]>([
    'sec-vuln',
    'ai-brain',
    'comp-soc2',
    'exec-board',
    'ops-cmdb'
  ]);
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);

  // Active Alert Count Helper
  const activeAlertsCount = alerts.filter(a => a.status === 'Active').length;

  // Rapid Action Modal States
  const [activeModal, setActiveModal] = useState<'add-client' | 'register-passport' | null>(null);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'info' } | null>(null);

  // New Client Input States
  const [newClientName, setNewClientName] = useState('');
  const [newClientDomain, setNewClientDomain] = useState('');
  const [newClientIndustry, setNewClientIndustry] = useState('Advanced Manufacturing');
  const [newClientTier, setNewClientTier] = useState<'Standard' | 'Enterprise' | 'Premium'>('Standard');

  // New Passport Input States
  const [newPassName, setNewPassName] = useState('');
  const [newPassVersion, setNewPassVersion] = useState('');
  const [newPassPublisher, setNewPassPublisher] = useState('');
  const [newPassCategory, setNewPassCategory] = useState('Networking & Web Servers');
  const [newPassLicense, setNewPassLicense] = useState('Apache License 2.0');

  // Custom Navigation override (specifically for drilldowns into passports)
  const handleNavigateWithItem = (tab: string, itemId?: string) => {
    setActiveTab(tab);
    if (tab === 'passports' && itemId) {
      setSelectedPassportId(itemId);
    } else if (tab === 'ai-swarm') {
      if (itemId) {
        setSelectedPassportId(itemId);
      }
    } else {
      setSelectedPassportId(null);
    }
  };

  // State mutator: Toggle Integration Connections
  const handleToggleConnection = async (id: string) => {
    const integration = integrations.find(i => i.id === id);
    if (!integration) return;

    const nextState = !integration.connected;
    const updatedData = {
      connected: nextState,
      apiKeyHint: nextState ? `${id}_key_usr_***` : '',
      lastSyncDate: nextState ? new Date().toISOString() : 'Never'
    };

    const response = await apiFetch(`/api/integrations/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedData)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      triggerNotification(body.message || 'Provider verification is required before connecting this integration.', 'info');
      return;
    }
    setIntegrations(prev => prev.map(item => item.id === id ? { ...item, ...body } : item));
    triggerNotification(`${integration.name} disconnected`, 'info');
  };

  const handleSyncIntegration = (id: string) => {
    const integration = integrations.find(i => i.id === id);
    if (!integration) return;

    const updatedData = {
      connected: true,
      apiKeyHint: integration.apiKeyHint || `${id}_key_usr_***`,
      lastSyncDate: new Date().toISOString().split('T')[0]
    };

    apiFetch(`/api/integrations/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedData)
    })
      .then(res => {
        if (res.ok) return res.json();
        return res.json().catch(() => ({})).then(body => {
          throw new Error(body.message || 'Provider verification is required before synchronization.');
        });
      })
      .then(updated => {
        setIntegrations(prev => prev.map(item => item.id === id ? { ...item, ...updated } : item));
        triggerNotification(`Successfully synchronized ${integration.name}!`, 'success');
      })
      .catch(err => {
        console.error('Failed to sync integration on backend:', err);
        triggerNotification(err.message || 'Integration was not synchronized.', 'info');
      });
  };

  // State mutator: Update threat alerts (Snoozed, Resolved)
  const handleUpdateAlertStatus = async (id: string, nextStatus: AlertStatus) => {
    const response = await apiFetch(`/api/alerts/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus })
    });
    if (!response.ok) {
      triggerNotification('Alert status was not saved.', 'info');
      return;
    }
    const savedAlert = await response.json();
    setAlerts(prev => prev.map(a => a.id === id ? savedAlert : a));
    triggerNotification(`Alert status saved: ${nextStatus}`, 'success');
  };

  // State mutator: Update software passport (for risk mitigations, etc.)
  const handleUpdatePassport = (updatedPassport: SoftwarePassport) => {
    apiFetch(`/api/passports/${updatedPassport.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedPassport)
    })
      .then(res => {
        if (!res.ok) throw new Error('Failed to update passport on backend');
        return res.json();
      })
      .then(data => {
        // Update local state with latest data from backend just in case
        setPassports(prev => prev.map(p => p.id === data.id ? data : p));
        triggerNotification(`Vulnerability mitigation updated successfully`, 'success');
      })
      .catch(err => {
        console.error('Error updating passport:', err);
        triggerNotification('Failed to update mitigation on backend server', 'info');
      });
  };

  // State mutator: Append completed scan logs with Heuristic Pattern Classification
  const handleNewScanRecord = (newScan: Scan) => {
    // Pattern heuristic rules to determine classification
    const targetLower = newScan.targetName.toLowerCase();
    const signatures = [
      { regex: /postgres|postgresql|psql|db|mysql|sqlite|oracle|mongo|database/i, category: 'Database Engine', defaultOS: 'RHEL 9.2', type: 'Virtual Machine' },
      { regex: /k8s|kubernetes|kube|docker|container|runc/i, category: 'Kubernetes Daemon', defaultOS: 'Alpine Linux', type: 'Kubernetes Pod' },
      { regex: /nginx|apache|httpd|iis|express|haproxy|web/i, category: 'Nginx Proxy', defaultOS: 'Ubuntu 22.04', type: 'Bare Metal Server' },
      { regex: /redis|memcached|cache/i, category: 'Redis Store', defaultOS: 'Debian 12', type: 'Virtual Machine' },
      { regex: /log4j|logging|logger/i, category: 'Apache Log4j Core', defaultOS: 'Debian 11', type: 'Docker Container' },
      { regex: /billing|payment|stripe|invoice|checkout/i, category: 'Legacy Billing Connector', defaultOS: 'Debian 11', type: 'Docker Container' }
    ];

    const matched = signatures.find(s => s.regex.test(targetLower));
    const isCustom = !matched;
    const finalScanType = isCustom ? 'Unclassified Record' : `${newScan.scanType} (Heuristic Match)`;

    const processedScan = {
      ...newScan,
      scanType: finalScanType as Scan['scanType']
    };

    apiFetch('/api/scans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(processedScan)
    })
      .then(res => {
        if (!res.ok) throw new Error(`Scan record was not persisted (${res.status})`);
        return res.json();
      })
      .then(savedScan => {
        if (!savedScan?.id) throw new Error('Scan API returned no committed record');
        const finalScan = savedScan;
        setScans(prev => [finalScan, ...prev]);
        triggerNotification(
          isCustom 
            ? `Unclassified Record logged for ${finalScan.targetName}` 
            : `Heuristic Pattern Classification recorded for ${finalScan.targetName}`, 
          'success'
        );

      })
      .catch(err => {
        console.error('Failed to save scan record to backend:', err);
        triggerNotification(`Scan record was not saved: ${processedScan.targetName}`, 'info');
      });
  };

  const handleNewAlertRecord = (newAlert: Alert) => {
    setAlerts(prev => [newAlert, ...prev]);
    triggerNotification(`Security threat alert logged for ${newAlert.clientName}`, 'success');
  };

  // State mutator: Batch-tag 'Unclassified Attestation' scans and update corresponding assets
  const handleBatchTagScans = (scanIds: string[], customCategory: string) => {
    apiFetch('/api/scans/batch-tag', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scanIds, customCategory })
    })
      .then(res => {
        if (!res.ok) throw new Error('Failed to batch-tag scans on backend');
        return res.json();
      })
      .then(() => {
        // 1. Update Scans State
        setScans(prev => prev.map(s => {
          if (scanIds.includes(s.id)) {
            return { ...s, scanType: customCategory as Scan['scanType'] };
          }
          return s;
        }));

        // 2. Update Corresponding Assets Inventory
        setAssets(prev => prev.map(a => {
          // Check if this asset corresponds to any of the updated scans
          const matchingScan = scans.find(s => {
            if (!scanIds.includes(s.id)) return false;
            const targetClean = s.targetName.toLowerCase().replace(/[^a-z0-9]/g, '-') || 'custom-node';
            return (
              a.hostName === `${targetClean}.node.internal` ||
              a.activePassport === `Custom/Generic: ${s.targetName}` ||
              a.activePassport === s.targetName ||
              (a.clientName === s.clientName && a.activePassport?.toLowerCase().includes(s.targetName.toLowerCase()))
            );
          });

          if (matchingScan) {
            return {
              ...a,
              activePassport: customCategory,
              type: 'Categorized Node'
            };
          }
          return a;
        }));

        triggerNotification(`Successfully batch-tagged ${scanIds.length} records to '${customCategory}' and synchronized assets inventory!`, 'success');
      })
      .catch(err => {
        console.error('Failed to batch-tag scans on backend:', err);
        triggerNotification(`Batch tag was not saved for ${scanIds.length} records.`, 'info');
      });
  };

  // Dynamic Modular Extension Actions
  const handleInstallExtension = (extId: string) => {
    if (!installedExtensions.includes(extId)) {
      setInstalledExtensions(prev => [...prev, extId]);
      triggerNotification(`Successfully activated capability: ${extId}`, 'success');
    }
  };

  const handleUninstallExtension = (extId: string) => {
    setInstalledExtensions(prev => prev.filter(id => id !== extId));
    triggerNotification(`Deactivated capability: ${extId}`, 'info');
  };

  // Global Toast Notifications
  const triggerNotification = (message: string, type: 'success' | 'info' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  // Workspace actions: Register New Client
  const handleOnboardClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClientName || !newClientDomain) return;

    const newClient: Client = {
      id: `c-new-${Date.now()}`,
      name: newClientName,
      domain: newClientDomain,
      industry: newClientIndustry,
      trustScore: 0,
      riskLevel: 'Unknown',
      avatarColor: 'bg-emerald-100 text-emerald-800 border-emerald-300',
      subscriptionTier: newClientTier,
      joinedDate: new Date().toISOString().substring(0, 10),
      teamCount: 1,
      passportCount: 0,
      criticalRisksCount: 0,
      complianceProgress: 0,
      softwareInventory: [],
      complianceStatus: [],
      teamMembers: [],
      activityTimeline: []
    };

    try {
      const response = await apiFetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newClient)
      });
      if (!response.ok) throw new Error(`Client was not persisted (${response.status})`);
      const savedClient = await response.json();
      if (!savedClient?.id) throw new Error('Client API returned no committed record');
      setClients(prev => [...prev, savedClient]);
      setActiveModal(null);
      triggerNotification(`Client record created: ${newClientName}`, 'success');
    } catch (error) {
      console.error('Failed to save client on backend:', error);
      triggerNotification(`Client record was not created: ${newClientName}`, 'info');
      return;
    }

    // Reset fields
    setNewClientName('');
    setNewClientDomain('');
  };

  // Workspace actions: Register New Software Passport
  const handleRegisterPassport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassName || !newPassVersion || !newPassPublisher) return;

    const newPassport: SoftwarePassport = {
      id: `pass-new-${Date.now()}`,
      name: newPassName,
      version: newPassVersion,
      publisher: newPassPublisher,
      category: newPassCategory,
      overallScore: 0,
      securityScore: 0,
      complianceScore: 0,
      vendorReputationScore: 0,
      releaseDate: new Date().toISOString().substring(0, 10),
      fileHash: '', // Pending SHA-256 verification via pipeline or file upload
      licenseType: newPassLicense,
      aiSummary: '', // No fake template summary; populated upon AI analysis run
      sbom: [
        { name: newPassName.toLowerCase().replace(/\s+/g, '-'), version: newPassVersion, license: newPassLicense, purl: `pkg:generic/${newPassName.toLowerCase()}@${newPassVersion}`, depth: 0, dependencyType: 'Direct', trustLevel: 'Review Required' }
      ],
      evidence: [], // Empty until verified cryptographic signatures or evidence are attached
      vulnerabilities: [],
      timeline: [
        { date: new Date().toISOString().substring(0, 10), event: 'Passport Registered', user: 'Registration Agent', details: 'Manual registration initiated. Pending scan verification.' }
      ]
    };

    try {
      const response = await apiFetch('/api/passports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPassport)
      });
      if (!response.ok) throw new Error(`Passport was not persisted (${response.status})`);
      const savedPassport = await response.json();
      if (!savedPassport?.id) throw new Error('Passport API returned no committed record');
      setPassports(prev => [savedPassport, ...prev]);
      setActiveModal(null);
      triggerNotification(`Passport record created: ${newPassName}`, 'success');
    } catch (error) {
      console.error('Failed to save passport on backend:', error);
      triggerNotification(`Passport record was not created: ${newPassName}`, 'info');
      return;
    }

    // Reset fields
    setNewPassName('');
    setNewPassVersion('');
    setNewPassPublisher('');
  };

  // Workspace action routers
  const handleOpenQuickAction = (actionType: 'add-client' | 'register-passport' | 'scan-sbom') => {
    if (actionType === 'add-client') {
      setActiveModal('add-client');
    } else if (actionType === 'register-passport') {
      setActiveModal('register-passport');
    } else {
      // Ingest/Scan SBOM redirect direct to the Scans page for best UX flow
      setActiveTab('scans');
      triggerNotification('Focusing SBOM file attestation drag-and-drop console', 'info');
    }
  };

  if (authLoading) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-zinc-950 text-slate-500 font-sans">
        <svg className="animate-spin h-6 w-6 text-indigo-600 mb-2" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <span className="text-xs font-mono tracking-wider font-bold uppercase text-slate-400">Securing Session Context...</span>
      </div>
    );
  }

  if (!user) {
    return (
      <LoginView
        onLoginSuccess={(loggedInUser: any) => {
          localStorage.setItem('msp_user', JSON.stringify(loggedInUser));
          setUser(loggedInUser);
          setUserRole(loggedInUser.role || 'Viewer');
          setOnboarded(loggedInUser.onboarded === 1);
        }}
      />
    );
  }

  // Email Verification Guard (Check verified claim & status)
  if (user && !user.emailVerified) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-slate-950 text-slate-100 p-6 font-sans">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl text-center space-y-6">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <ShieldAlert className="h-8 w-8" />
          </div>

          <div>
            <h2 className="text-xl font-bold text-white font-display">Email Verification Required</h2>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              To secure corporate workspace partitions, SPR requires email verification before granting tenant access.
            </p>
            <div className="mt-3 bg-black/40 p-3 rounded-xl border border-slate-800 font-mono text-xs text-indigo-300 break-all">
              {user.email}
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <button
              onClick={async () => {
                if (auth.currentUser) {
                  try {
                    await sendEmailVerification(auth.currentUser);
                    triggerNotification(`Verification link dispatched to ${user.email}`, 'success');
                  } catch (err: any) {
                    triggerNotification(err?.message || 'Failed to resend verification email', 'info');
                  }
                }
              }}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-4 rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg transition cursor-pointer"
            >
              <RefreshCw className="h-4 w-4" />
              <span>Resend Verification Email</span>
            </button>

            <button
              onClick={async () => {
                if (auth.currentUser) {
                  await auth.currentUser.reload();
                  if (auth.currentUser.emailVerified) {
                    const tokenResult = await auth.currentUser.getIdTokenResult(true);
                    setUser({
                      ...user,
                      emailVerified: true,
                      token: tokenResult.token
                    });
                    triggerNotification('Email verified! Access granted.', 'success');
                  } else {
                    triggerNotification('Email is not verified yet. Please check your inbox or spam folder.', 'info');
                  }
                }
              }}
              className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-3 px-4 rounded-xl text-xs flex items-center justify-center gap-2 border border-slate-700 transition cursor-pointer"
            >
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span>I Have Verified My Email (Check Status)</span>
            </button>

            <button
              onClick={() => {
                signOut(auth);
                localStorage.removeItem('msp_user');
                setUser(null);
              }}
              className="w-full text-slate-500 hover:text-slate-300 text-xs py-2 transition cursor-pointer hover:underline"
            >
              Sign Out / Switch Account
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (onboarded === false) {
    if (userRole !== 'Owner') {
      return (
        <div className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
          <div className="mx-auto max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-7">
            <h1 className="text-xl font-semibold">Workspace access is pending</h1>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Your account is authenticated, but an existing workspace Owner or Admin must assign your workspace role before setup can continue.
            </p>
            <button
              onClick={() => {
                signOut(auth);
                localStorage.removeItem('msp_user');
                setUser(null);
              }}
              className="mt-6 rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-800"
            >
              Sign out
            </button>
          </div>
        </div>
      );
    }
    return (
      <OnboardingWizard
        user={user}
        onOnboardingComplete={(updatedUser: any) => {
          const merged = { ...user, ...updatedUser };
          localStorage.setItem('msp_user', JSON.stringify(merged));
          setUser(merged);
          setUserRole(merged.role || 'Owner');
          setOnboarded(true);
        }}
      />
    );
  }



  const selectedClient = clients.find(c => c.id === selectedClientId);
  const currentClientTier = selectedClient ? selectedClient.subscriptionTier : 'Standard';

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 dark:bg-zinc-950 font-sans antialiased select-none text-slate-900 dark:text-zinc-50 transition-colors duration-300" id="software-passport-shell">
      {/* Mobile Sidebar Navigation Drawer */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden flex" id="mobile-nav-drawer-root">
            {/* Backdrop overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMobileMenuOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-xs"
            />
            
            {/* Slide-in Drawer Content */}
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 220 }}
              className="relative w-64 h-full flex flex-col bg-slate-900 shadow-2xl"
            >
              {/* Floating Close Button */}
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="absolute top-4 -right-12 p-2.5 bg-slate-900 text-slate-400 hover:text-white rounded-r-xl border-y border-r border-slate-800/80 flex items-center justify-center focus:outline-none cursor-pointer"
                aria-label="Close Mobile Menu"
              >
                <X className="w-5 h-5" />
              </button>

              <Sidebar
                clients={clients}
                selectedClientId={selectedClientId}
                setSelectedClientId={setSelectedClientId}
                activeTab={activeTab}
                setActiveTab={(tab) => {
                  handleNavigateWithItem(tab);
                  setIsMobileMenuOpen(false);
                }}
                alertCount={activeAlertsCount}
                installedExtensions={installedExtensions}
                userRole={userRole}
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 1. Left Navigation Sidebar (Desktop only) */}
      <div className="hidden lg:block h-full shrink-0">
        <Sidebar
          clients={clients}
          selectedClientId={selectedClientId}
          setSelectedClientId={setSelectedClientId}
          activeTab={activeTab}
          setActiveTab={(tab) => handleNavigateWithItem(tab)}
          alertCount={activeAlertsCount}
          installedExtensions={installedExtensions}
          userRole={userRole}
        />
      </div>

      {/* 2. Main Display Panel Layout */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        <Header
          clients={clients}
          selectedClientId={selectedClientId}
          setSelectedClientId={setSelectedClientId}
          onOpenQuickAction={handleOpenQuickAction}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          theme={theme}
          toggleTheme={toggleTheme}
          user={user}
          userRole={userRole}
          onChangeRole={handleChangeRole}
          onToggleMobileMenu={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          onStartTutorial={() => setIsTutorialOpen(true)}
        />

        {/* Scrollable Viewport Stage */}
        <main className="flex-1 overflow-y-auto p-6 lg:p-8" id="viewport-stage-container">
          {activeTab === 'dashboard' && (
            <MSPCommandCenter
              clients={clients}
              alerts={alerts}
              onSelectClient={setSelectedClientId}
              onNavigate={(tab) => handleNavigateWithItem(tab)}
            />
          )}

          {activeTab === 'enterprise-audit' && (
            <EnterpriseReadinessView clients={clients} />
          )}

          {activeTab.startsWith('pilot-') && (
            <PilotProgramView
              clients={clients}
              activeTab={activeTab}
              setActiveTab={(tab) => handleNavigateWithItem(tab)}
            />
          )}

          {activeTab === 'clients' && (
            <ClientsView
              clients={clients}
              selectedClientId={selectedClientId}
              setSelectedClientId={setSelectedClientId}
              passports={passports}
              onNavigateTab={handleNavigateWithItem}
              searchQuery={searchQuery}
            />
          )}

          {activeTab === 'passports' && (
            <PassportsView
              passports={passports}
              selectedPassportId={selectedPassportId}
              setSelectedPassportId={setSelectedPassportId}
              searchQuery={searchQuery}
              onUpdatePassport={handleUpdatePassport}
              onNavigateTab={handleNavigateWithItem}
              clients={clients}
              assets={assets}
            />
          )}

          {activeTab === 'ai-swarm' && (
            currentClientTier === 'Premium' ? (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                  <div>
                    <h1 className="text-xl font-display font-bold text-slate-900">24/7 Living Passport AI Swarm</h1>
                    <p className="text-xs text-slate-500 font-sans mt-1">
                      Select a Software Passport to inspect server-side scanner jobs and their recorded outputs.
                    </p>
                  </div>
                  
                  <div className="flex items-center gap-2 bg-white border border-slate-200 px-3 py-2 rounded-xl text-xs text-slate-600 shadow-sm">
                    <span className="font-semibold text-slate-700">Active Passport:</span>
                    <select
                      value={selectedPassportId || (passports[0]?.id || '')}
                      onChange={(e) => setSelectedPassportId(e.target.value)}
                      className="bg-transparent focus:outline-none font-bold cursor-pointer text-slate-800"
                    >
                      {passports.map(p => (
                        <option key={p.id} value={p.id}>{p.name} (v{p.version})</option>
                      ))}
                    </select>
                  </div>
                </div>
                
                {passports.find(p => p.id === (selectedPassportId || passports[0]?.id)) ? (
                  <PassportSwarmView passport={passports.find(p => p.id === (selectedPassportId || passports[0]?.id))!} />
                ) : (
                  <div className="p-8 text-center bg-white border border-slate-200 rounded-xl text-slate-400">
                    No Software Passports available to run AI Swarms on.
                  </div>
                )}
              </div>
            ) : (
              <PaywallOverlay
                featureName="Passport Scanner Pipeline"
                featureDescription="Run configured server-side checks and review their recorded findings. Continuous monitoring and signing require connected providers."
                requiredTier="Premium"
                currentClientId={selectedClientId}
                clients={clients}
                onUpgradeSuccess={handleUpgradeSuccess}
              />
            )
          )}

          {activeTab === 'vendors' && (
            <VendorsView vendors={vendors} searchQuery={searchQuery} />
          )}

          {activeTab === 'security' && (
            <SecurityCenterView clients={clients} passports={passports} />
          )}

          {activeTab === 'compliance' && <ComplianceView clients={clients} />}

          {activeTab === 'trust-brain' && (
            currentClientTier === 'Premium' ? (
              <TrustBrainView userRole={userRole} />
            ) : (
              <PaywallOverlay
                featureName="Trust Brain Cognitive Engine"
                featureDescription="Ingest entire code bases, software bill of materials, and CVE definitions to automatically resolve vulnerabilities and generate ready-to-merge patches."
                requiredTier="Premium"
                currentClientId={selectedClientId}
                clients={clients}
                onUpgradeSuccess={handleUpgradeSuccess}
              />
            )
          )}

          {activeTab === 'reports' && (
            (currentClientTier === 'Enterprise' || currentClientTier === 'Premium') ? (
              <ReportsView clients={clients} />
            ) : (
              <PaywallOverlay
                featureName="Advanced Executive Compliance Reports"
                featureDescription="Generate and export comprehensive security audit logs, HIPAA/SOC2 compliance matrices, and CISO-ready PDF executive summaries."
                requiredTier="Enterprise"
                currentClientId={selectedClientId}
                clients={clients}
                onUpgradeSuccess={handleUpgradeSuccess}
              />
            )
          )}

          {activeTab === 'assets' && (
            <AssetsView 
              clients={clients} 
              searchQuery={searchQuery} 
              assets={assets} 
              onUpdateAssets={setAssets} 
            />
          )}

          {activeTab === 'scans' && (
            <MonitoringView />
          )}

          {activeTab === 'alerts' && (
            <AlertsView alerts={alerts} onUpdateAlertStatus={handleUpdateAlertStatus} />
          )}

          {activeTab === 'trust-os' && (
            <TrustOSView
              passports={passports}
              clients={clients}
              selectedClientId={selectedClientId}
            />
          )}

          {activeTab === 'marketplace' && (
            <ExtensionMarketplace
              installedExtensions={installedExtensions}
              onInstall={handleInstallExtension}
              onUninstall={handleUninstallExtension}
              onNavigateTab={handleNavigateWithItem}
            />
          )}

          {activeTab === 'partner-program' && <PartnerProgramView />}

          {activeTab === 'integrations' && (
            <IntegrationsView
              integrations={integrations}
              onToggleConnection={handleToggleConnection}
              onSyncIntegration={handleSyncIntegration}
              onNavigateTab={(tab) => handleNavigateWithItem(tab)}
            />
          )}

          {activeTab === 'billing' && <BillingView />}

          {activeTab === 'founder' && <FounderDashboardView userRole={userRole} />}

          {activeTab === 'settings' && <SettingsView theme={theme} onToggleTheme={toggleTheme} />}
        </main>
      </div>

      {/* Interactive Trust OS Tutorial */}
      <TrustOSTutorial
        isOpen={isTutorialOpen}
        onClose={() => setIsTutorialOpen(false)}
        onNavigateTab={handleNavigateWithItem}
        onInstallExtension={handleInstallExtension}
        installedExtensions={installedExtensions}
      />

      {/* 3. Global Toast Alerts */}
      {notification && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 border border-slate-800 shadow-2xl p-4.5 rounded-xl flex items-center gap-3 animate-bounce">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold text-slate-200">{notification.message}</span>
        </div>
      )}

      {/* 4. Onboard Client Modal */}
      {activeModal === 'add-client' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <form
            onSubmit={handleOnboardClient}
            className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4"
          >
            <div className="flex justify-between items-start border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Plus className="w-5 h-5 text-indigo-600" />
                <h3 className="text-sm font-bold text-slate-900 font-display">Onboard New Tenant Client</h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div className="flex flex-col gap-1">
                <label className="font-semibold text-slate-700">Client Organization Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Acme Corp"
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 focus:outline-none focus:border-indigo-500 focus:bg-white"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-semibold text-slate-700">Domain URL</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. acme-corp.com"
                  value={newClientDomain}
                  onChange={(e) => setNewClientDomain(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 focus:outline-none focus:border-indigo-500 focus:bg-white font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="font-semibold text-slate-700">Industry Category</label>
                  <select
                    value={newClientIndustry}
                    onChange={(e) => setNewClientIndustry(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 focus:outline-none cursor-pointer text-slate-700 font-semibold"
                  >
                    <option value="Advanced Manufacturing">Manufacturing</option>
                    <option value="Healthcare Services">Healthcare</option>
                    <option value="Investment Banking & Fintech">Fintech</option>
                    <option value="Energy & Utilities">Energy</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="font-semibold text-slate-700">Subscription Contract</label>
                  <select
                    value={newClientTier}
                    onChange={(e) => setNewClientTier(e.target.value as any)}
                    className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 focus:outline-none cursor-pointer text-slate-700 font-semibold"
                  >
                    <option value="Standard">Standard Tier</option>
                    <option value="Enterprise">Enterprise Tier</option>
                    <option value="Premium">Premium Tier</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="px-4 py-2 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-500 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm cursor-pointer transition-colors"
              >
                Provision Workspace
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 5. Register Software Passport Modal */}
      {activeModal === 'register-passport' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <form
            onSubmit={handleRegisterPassport}
            className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4"
          >
            <div className="flex justify-between items-start border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4.5 h-4.5 text-indigo-600" />
                <h3 className="text-sm font-bold text-slate-900 font-display">Register Software Passport</h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="font-semibold text-slate-700">Software Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Apache Tom"
                    value={newPassName}
                    onChange={(e) => setNewPassName(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 focus:outline-none focus:border-indigo-500 focus:bg-white"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="font-semibold text-slate-700">Release Version</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 10.1.0"
                    value={newPassVersion}
                    onChange={(e) => setNewPassVersion(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 focus:outline-none focus:border-indigo-500 focus:bg-white font-mono"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="font-semibold text-slate-700">Publisher Organization</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Apache Software Foundation"
                  value={newPassPublisher}
                  onChange={(e) => setNewPassPublisher(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 focus:outline-none focus:border-indigo-500 focus:bg-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="font-semibold text-slate-700">Category</label>
                  <select
                    value={newPassCategory}
                    onChange={(e) => setNewPassCategory(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 focus:outline-none cursor-pointer text-slate-700 font-semibold"
                  >
                    <option value="Networking & Web Servers">Web Server / Proxy</option>
                    <option value="Databases & Storage">Database Engine</option>
                    <option value="Software Libraries & SDKs">Library / SDK</option>
                    <option value="Infrastructure & Containerization">Infrastructure</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="font-semibold text-slate-700">License Model</label>
                  <select
                    value={newPassLicense}
                    onChange={(e) => setNewPassLicense(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 focus:outline-none cursor-pointer text-slate-700 font-semibold"
                  >
                    <option value="Apache License 2.0">Apache 2.0</option>
                    <option value="MIT License">MIT License</option>
                    <option value="BSD 2-Clause Simplified">BSD 2-Clause</option>
                    <option value="PostgreSQL License">Postgres License</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="px-4 py-2 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-500 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm cursor-pointer transition-colors"
              >
                Sign & Ingest Passport
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 6. Floating Quick Actions Speed Dial Menu */}
      <QuickActionsSpeedDial
        clients={clients}
        onTriggerNewScan={handleNewScanRecord}
        onTriggerNewAlert={handleNewAlertRecord}
        onOpenRegisterPassport={() => setActiveModal('register-passport')}
      />
    </div>
  );
}
