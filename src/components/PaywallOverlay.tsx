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
    if (tier === 'Premium') return 'bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-400 border border-purple-200 dark:border-purple-900/40';
    if (tier === 'Enterprise') return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-900/40';
    return 'bg-slate-100 text-slate-700 dark:bg-zinc-800/60 dark:text-zinc-300 border border-slate-200 dark:border-zinc-700/50';
  };

  return (
    <div className="flex items-center justify-center min-h-[480px] p-4 animate-fade-in" id="paywall-view-panel">
      <div className="bg-white dark:bg-zinc-900 max-w-xl w-full p-8 rounded-2xl border border-slate-200 dark:border-zinc-800 shadow-xl relative overflow-hidden transition-all duration-300">
        
        {/* Decorative Grid Accent */}
        <div className="absolute inset-0 bg-radial-at-t from-indigo-50/30 via-transparent to-transparent dark:from-indigo-950/15 pointer-events-none" />

        {/* Header Icon badge */}
        <div className="flex justify-center mb-6">
          <div className="relative">
            <div className="bg-indigo-50 dark:bg-indigo-950/50 p-4 rounded-2xl border border-indigo-100 dark:border-indigo-900/40 flex items-center justify-center shrink-0">
              <Lock className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div className="absolute -top-1 -right-1 bg-gradient-to-tr from-amber-400 to-amber-300 p-1 rounded-lg shadow-md animate-pulse">
              <Sparkles className="w-3.5 h-3.5 text-slate-900" />
            </div>
          </div>
        </div>

        {/* Title & Description */}
        <div className="text-center space-y-2 mb-6">
          <h2 className="text-lg font-display font-bold text-slate-900 dark:text-zinc-50">
            {featureName} Gated Feature
          </h2>
          <p className="text-xs text-slate-500 dark:text-zinc-400 max-w-md mx-auto leading-relaxed">
            {featureDescription}
          </p>
        </div>

        {/* Feature Highlights Grid */}
        <div className="bg-slate-50 dark:bg-zinc-800/20 border border-slate-100 dark:border-zinc-800/40 rounded-xl p-4.5 mb-6 text-xs text-slate-600 dark:text-zinc-400 space-y-2.5">
          <div className="flex items-center gap-2.5">
            <Shield className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>Continuous security validation & SLSA build verification.</span>
          </div>
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-4 h-4 text-indigo-500 shrink-0" />
            <span>24/7 AI-driven threat modeling & real-time remediation suggestions.</span>
          </div>
          <div className="flex items-center gap-2.5">
            <RefreshCw className="w-4 h-4 text-sky-500 shrink-0" />
            <span>Enterprise-wide audit logs & cross-platform synchronization pipelines.</span>
          </div>
        </div>

        {/* Subscription Target Context */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 border border-slate-150 dark:border-zinc-800 rounded-xl mb-6 text-xs bg-white dark:bg-zinc-900/50 shadow-sm">
          <div className="text-center sm:text-left">
            <span className="text-[10px] text-slate-400 font-mono font-bold uppercase block">Tenant Scope</span>
            <span className="font-bold text-slate-800 dark:text-zinc-200">
              {selectedClient ? selectedClient.name : 'Global MSP Context'}
            </span>
          </div>
          
          <div className="flex items-center gap-2">
            <div>
              <span className="text-[9px] text-slate-400 font-mono font-bold uppercase block text-right sm:text-left">Plan</span>
              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold block ${getTierBadgeColor(currentTier)}`}>
                {currentTier}
              </span>
            </div>
            
            <ArrowRight className="w-3.5 h-3.5 text-slate-300" />
            
            <div>
              <span className="text-[9px] text-indigo-400 font-mono font-bold uppercase block">Required</span>
              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold block ${getTierBadgeColor(requiredTier)}`}>
                {requiredTier}
              </span>
            </div>
          </div>
        </div>

        {/* Actions Button */}
        <div>
          {success ? (
            <div className="w-full bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/50 text-emerald-700 dark:text-emerald-400 font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 text-sm animate-bounce">
              <Check className="w-4 h-4" />
              <span>Workspace Upgraded successfully! Unlocking...</span>
            </div>
          ) : (
            <button
              onClick={handleUpgrade}
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-xl transition text-xs cursor-pointer flex items-center justify-center gap-2 shadow-md shadow-indigo-100 dark:shadow-none hover:shadow-lg hover:scale-[1.01]"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Processing secure upgrade transaction...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-amber-300 shrink-0" />
                  <span>Upgrade {selectedClient ? selectedClient.name : 'MSP Account'} to {requiredTier}</span>
                </>
              )}
            </button>
          )}
          
          <span className="text-[10px] text-slate-400 dark:text-zinc-500 block text-center mt-3">
            🔐 Unlock enterprise-grade audit and trust validation capabilities for your workspace.
          </span>
        </div>

      </div>
    </div>
  );
}
