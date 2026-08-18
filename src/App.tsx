/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion';
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

