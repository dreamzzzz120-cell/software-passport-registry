/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Lock, Sparkles, Shield, ArrowRight, Loader2, Check, RefreshCw } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { Client } from '../types';

interface PaywallOverlayProps {
  featureName: string;
  featureDescription: string;
  requiredTier: 'Enterprise' | 'Premium';
  currentClientId: string;
  clients: Client[];
  onUpgradeSuccess: (updatedClient: Client) => void;
}

export default function PaywallOverlay({
  featureName,
  featureDescription,
  requiredTier,
  currentClientId,
  clients,
  onUpgradeSuccess,
}: PaywallOverlayProps) {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  // Identify current client context
  const selectedClient = clients.find(c => c.id === currentClientId);
  const currentTier = selectedClient ? selectedClient.subscriptionTier : 'Standard';

  const handleUpgrade = async () => {
    if (!selectedClient) {
      // If we are in 'global' mode, let's upgrade the first 'Standard' client or show a general upgrade
      const standardClient = clients.find(c => c.subscriptionTier === 'Standard');
      if (standardClient) {
        await runUpgradeRequest(standardClient.id, requiredTier);
      } else {
        alert('All clients are already upgraded! Please select a client to upgrade.');
      }
      return;
    }

    await runUpgradeRequest(selectedClient.id, requiredTier);
  };

  const runUpgradeRequest = async (clientId: string, tier: 'Enterprise' | 'Premium') => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/clients/${clientId}/tier`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptionTier: tier }),
      });

      if (!res.ok) {
        throw new Error('Failed to update subscription tier');
      }

      const updatedData = await res.json();
      setSuccess(true);
      setTimeout(() => {
        onUpgradeSuccess(updatedData);
        setSuccess(false);
      }, 1500);
    } catch (err) {
      console.error('[Paywall Ingress Error]:', err);
      alert('Subscription gateway failed to complete upgrade.');
    } finally {
      setLoading(false);
    }
  };

  const getTierBadgeColor = (tier: string) => {
    if (tier === 'Premium') return 'bg-[#094771] text-[#3794ff] border border-[#0e639c]';
    if (tier === 'Enterprise') return 'bg-[#094771] text-[#3794ff] border border-[#0e639c]';
    return 'bg-[#2d2d2d] text-[#d4d4d4] border border-[#3c3c3c]';
  };

  return (
    <div className="flex items-center justify-center min-h-[480px] p-4 animate-fade-in" id="paywall-view-panel">
      <div className="bg-[#1e1e1e] max-w-xl w-full p-8 rounded-md border border-[#3c3c3c] relative overflow-hidden transition-all duration-300">

        {/* Header Icon badge */}
        <div className="flex justify-center mb-6">
          <div className="relative">
            <div className="bg-[#094771] p-4 rounded-md border border-[#0e639c] flex items-center justify-center shrink-0">
              <Lock className="w-8 h-8 text-[#3794ff]" />
            </div>
            <div className="absolute -top-1 -right-1 bg-[#cca700] p-1 rounded-lg animate-pulse">
              <Sparkles className="w-3.5 h-3.5 text-[#1e1e1e]" />
            </div>
          </div>
        </div>

        {/* Title & Description */}
        <div className="text-center space-y-2 mb-6">
          <h2 className="text-lg font-display font-bold text-[#d4d4d4]">
            {featureName} Gated Feature
          </h2>
          <p className="text-xs text-[#9d9d9d] max-w-md mx-auto leading-relaxed">
            {featureDescription}
          </p>
        </div>

        {/* Feature Highlights Grid */}
        <div className="bg-[#252526] border border-[#3c3c3c] rounded-md p-4.5 mb-6 text-xs text-[#9d9d9d] space-y-2.5">
          <div className="flex items-center gap-2.5">
            <Shield className="w-4 h-4 text-[#89d185] shrink-0" />
            <span>Continuous security validation & SLSA build verification.</span>
          </div>
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-4 h-4 text-[#3794ff] shrink-0" />
            <span>24/7 AI-driven threat modeling & real-time remediation suggestions.</span>
          </div>
          <div className="flex items-center gap-2.5">
            <RefreshCw className="w-4 h-4 text-[#3794ff] shrink-0" />
            <span>Enterprise-wide audit logs & cross-platform synchronization pipelines.</span>
          </div>
        </div>

        {/* Subscription Target Context */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 border border-[#3c3c3c] rounded-md mb-6 text-xs bg-[#1e1e1e]">
          <div className="text-center sm:text-left">
            <span className="text-[10px] text-[#9d9d9d] font-mono font-bold uppercase block">Tenant Scope</span>
            <span className="font-bold text-[#d4d4d4]">
              {selectedClient ? selectedClient.name : 'Global MSP Context'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div>
              <span className="text-[9px] text-[#9d9d9d] font-mono font-bold uppercase block text-right sm:text-left">Plan</span>
              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold block ${getTierBadgeColor(currentTier)}`}>
                {currentTier}
              </span>
            </div>

            <ArrowRight className="w-3.5 h-3.5 text-[#6f6f6f]" />

            <div>
              <span className="text-[9px] text-[#3794ff] font-mono font-bold uppercase block">Required</span>
              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold block ${getTierBadgeColor(requiredTier)}`}>
                {requiredTier}
              </span>
            </div>
          </div>
        </div>

        {/* Actions Button */}
        <div>
          {success ? (
            <div className="w-full bg-[#89d185]/10 border border-[#89d185]/40 text-[#89d185] font-bold py-3 px-4 rounded-md flex items-center justify-center gap-2 text-sm animate-bounce">
              <Check className="w-4 h-4" />
              <span>Workspace Upgraded successfully! Unlocking...</span>
            </div>
          ) : (
            <button
              onClick={handleUpgrade}
              disabled={loading}
              className="spr-btn spr-btn-primary w-full py-3 px-4 text-xs cursor-pointer flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Processing secure upgrade transaction...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-[#cca700] shrink-0" />
                  <span>Upgrade {selectedClient ? selectedClient.name : 'MSP Account'} to {requiredTier}</span>
                </>
              )}
            </button>
          )}

          <span className="text-[10px] text-[#9d9d9d] block text-center mt-3">
            🔐 Unlock enterprise-grade audit and trust validation capabilities for your workspace.
          </span>
        </div>

      </div>
    </div>
  );
}
