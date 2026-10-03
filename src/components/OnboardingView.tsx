/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import PilotOnboardingChecklist from './PilotOnboardingChecklist';
import MSPLaunchChecklist from './MSPLaunchChecklist';

interface OnboardingViewProps {
  clientsCount: number;
  passportsCount: number;
  scansCount: number;
  onOpenQuickAction: (actionType: 'add-client' | 'register-passport' | 'scan-sbom') => void;
  onNavigateTab: (tab: string, itemId?: string) => void;
  onComplete: () => void;
}

export default function OnboardingView({
  clientsCount,
  passportsCount,
  scansCount,
  onOpenQuickAction,
  onNavigateTab,
  onComplete,
}: OnboardingViewProps) {
  return (
    <main className="min-h-[calc(100vh-2rem)] p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="spr-panel p-6 md:p-8">
          <div className="text-[11px] font-bold uppercase tracking-[.22em] text-[var(--spr-highlight)]">First-run workspace</div>
          <h1 className="mt-2 text-2xl md:text-3xl font-display font-extrabold text-[var(--spr-text)]">Set up your Software Trust workspace</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--spr-text-muted)]">Complete the core setup, then finish the MSP launch steps using real workspace data. SPR does not mark a step complete from a local flag or a fabricated record, and no founder intervention is required.</p>
        </div>
        <PilotOnboardingChecklist
          clientsCount={clientsCount}
          passportsCount={passportsCount}
          scansCount={scansCount}
          onOpenQuickAction={onOpenQuickAction}
          onNavigateTab={onNavigateTab}
        />
        <MSPLaunchChecklist onNavigateTab={onNavigateTab} onContinue={onComplete} />
      </div>
    </main>
  );
}
