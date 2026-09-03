/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  ShieldCheck, ArrowRight, Building2, User2, Sliders, KeyRound, Check, RefreshCw, Sparkles, LogOut, CheckCircle2
} from 'lucide-react';
import { auth } from '../lib/firebase';
import { apiFetch } from '../utils/apiClient';
import { beginTotpEnrollment, finishTotpEnrollment } from '../lib/mfa';

interface OnboardingWizardProps {
  user: any;
  onOnboardingComplete: (updatedUser: any) => void;
}

export default function OnboardingWizard({ user, onOnboardingComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form Fields
  const [companyName, setCompanyName] = useState('');
  const [role, setRole] = useState('Owner');
  const [numTechnicians, setNumTechnicians] = useState('3');
  const [clientCount, setClientCount] = useState('12');
  const [primaryUseCase, setPrimaryUseCase] = useState('NIST Mapping & Risk Assessments');
  const [mfaEnabled, setMfaEnabled] = useState(true);
  const [mfaSecret, setMfaSecret] = useState<Awaited<ReturnType<typeof beginTotpEnrollment>> | null>(null);

  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [totpCodeInput, setTotpCodeInput] = useState<string>('');
  const [isTotpVerified, setIsTotpVerified] = useState<boolean>(false);
  const [totpVerifying, setTotpVerifying] = useState<boolean>(false);
  const [totpError, setTotpError] = useState<string | null>(null);

  useEffect(() => {
    if (!mfaEnabled || !auth.currentUser || mfaSecret) return;
    beginTotpEnrollment(auth.currentUser)
      .then(secret => setMfaSecret(secret))
      .catch(err => setTotpError(err?.message || 'Could not start authenticator enrollment.'));
  }, [mfaEnabled, mfaSecret]);

  useEffect(() => {
    if (mfaEnabled && mfaSecret) {
      const otpauth = mfaSecret.generateQrCodeUrl(auth.currentUser?.email || 'User', 'Software Passport Registry');
      import('qrcode').then(({ default: QRCode }) => QRCode.toDataURL(otpauth, { margin: 1, width: 160 }))
        .then(url => setQrDataUrl(url))
        .catch(err => console.error('Failed to generate enrollment QR code:', err));
    } else {
      setQrDataUrl('');
    }
  }, [mfaEnabled, mfaSecret]);

  const handleVerifyTotp = async () => {
    if (!auth.currentUser || !mfaSecret) {
      setTotpError('Authenticator enrollment is not ready. Please wait a moment and try again.');
      return;
    }
    setTotpVerifying(true);
    setTotpError(null);
    try {
      await finishTotpEnrollment(auth.currentUser, mfaSecret, totpCodeInput, 'SPR authenticator');
      setIsTotpVerified(true);
      setTotpError(null);
    } catch (err: any) {
      setIsTotpVerified(false);
      setTotpError(err?.code === 'auth/requires-recent-login' ? 'For security, sign in again before enabling MFA.' : err?.message || 'Invalid 6-digit TOTP code. Please check your authenticator app time and enter the current code.');
    } finally {
      setTotpVerifying(false);
    }
  };

  // Sequential setup steps tied to real API calls for step 4
  const [setupLogs, setSetupLogs] = useState<string[]>([]);
  const [completedUser, setCompletedUser] = useState<any>(null);

  const startSetupProcess = async () => {
    setSetupLogs(['Creating workspace record...']);
    setLoading(true);
    setError(null);

    try {
      // Step 1: Real backend call to register onboarding details
      const res = await apiFetch('/api/user/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName,
          role,
          numTechnicians: parseInt(numTechnicians) || 1,
          clientCount: parseInt(clientCount) || 0,
          primaryUseCase
        })
      });

      if (!res.ok) {
        throw new Error('Onboarding API failed to register details.');
      }

      const data = await res.json();
      setSetupLogs((prev) => [...prev, 'Saving organization settings...']);

      // Step 2: Real backend call to fetch full updated profile
      const profileRes = await apiFetch('/api/user/me');
      const updatedUser = profileRes.ok ? await profileRes.json() : data.user;

      setSetupLogs((prev) => [...prev, 'Applying user permissions...']);

      // Step 3: Complete setup log
      setSetupLogs((prev) => [...prev, 'Workspace setup complete.']);
      setCompletedUser(updatedUser);
    } catch (err: any) {
      console.error('[Onboarding Complete Error]:', err);
      setError('Failed to configure workspace. Please try again.');
      setStep(3);
    } finally {
      setLoading(false);
    }
  };

  const handleNextStep = () => {
    setError(null);
    if (step === 1) {
      if (!companyName.trim()) {
        setError('Please provide a company or workspace name.');
        return;
      }
      setStep(2);
    } else if (step === 2) {
      setStep(3);
    } else if (step === 3) {
      if (mfaEnabled && !isTotpVerified) {
        setError('You must enter and verify a valid 6-digit TOTP code from your authenticator app before enabling MFA.');
        return;
      }
      setStep(4);
      startSetupProcess();
    }
  };

  const handleCompleteOnboarding = () => {
    if (completedUser) {
      onOnboardingComplete(completedUser);
    } else {
      startSetupProcess();
    }
  };

  const handleSignOut = async () => {
    localStorage.removeItem('msp_user');
    await auth.signOut().catch(() => {});
    window.location.reload();
  };

  return (
    <div className="min-h-screen w-screen flex flex-col items-center justify-center bg-[var(--spr-surface)] font-sans text-[var(--spr-text)] p-4">
      {/* Header Info */}
      <div className="text-center space-y-2 mb-8 relative z-10">
        <div className="flex justify-center mb-4">
          <div className="bg-[var(--spr-accent-soft)] border border-[var(--spr-accent)]/40 p-3 rounded-md">
            <ShieldCheck className="h-8 w-8 text-[var(--spr-highlight)]" />
          </div>
        </div>
        <h1 className="text-3xl font-bold tracking-tight font-display">Set up your SPR workspace</h1>
        <p className="text-sm text-[var(--spr-text)] max-w-md">
          Four short steps. You can change these settings later.
        </p>
      </div>

      {/* Wizard Card */}
      <div className="max-w-md w-full spr-panel p-6 md:p-8 relative z-10 flex flex-col justify-between min-h-[380px]">
        
        {/* Progress Bar */}
        <div className="flex items-center justify-between mb-6 border-b border-[var(--spr-border)] pb-4">
          <span className="text-[10px] font-mono uppercase text-[var(--spr-text-muted)] font-bold tracking-wider">
            Step {step} of 4: {step === 1 && 'Workspace'}
            {step === 2 && 'Preferences'}
            {step === 3 && 'Account security'}
            {step === 4 && 'Finish'}
          </span>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4].map((s) => (
              <div
                key={s}
                className={`h-1.5 w-8 rounded-full transition-all duration-300 ${
                  s === step 
                    ? 'bg-[var(--spr-highlight)]'
                    : s < step 
                      ? 'bg-[var(--spr-green)]'
                      : 'bg-[var(--spr-border)]'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Errors Display */}
        {error && (
          <div className="mb-4 p-3 bg-[var(--spr-red)]/10 text-[var(--spr-red)] border border-[var(--spr-red)]/30 rounded-md text-xs flex gap-2 items-start">
            <Sliders className="h-4 w-4 shrink-0 mt-0.5 text-[var(--spr-red)]" />
            <p>{error}</p>
          </div>
        )}

        {/* STEP 1: WORKSPACE NAME & ROLE */}
        {step === 1 && (
          <div className="space-y-4 text-left flex-1">
            <div>
              <h2 className="text-lg font-semibold">Name your workspace</h2>
              <p className="mt-1 text-sm text-[var(--spr-text-muted)]">Use the company or team name your members will recognize.</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--spr-text)] mb-1.5">
                Workspace name
              </label>
              <div className="relative">
                <Building2 className="absolute left-3.5 top-3.5 h-4 w-4 text-[var(--spr-text-muted)]" />
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Example: Acme Security"
                  autoFocus
                  className="w-full bg-[var(--spr-surface-sunken)] border border-[var(--spr-border)] rounded-md pl-10 pr-4 py-3 text-sm text-[var(--spr-text)] focus:outline-none focus:border-[var(--spr-highlight)]"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--spr-text)] mb-1.5">
                Your role
              </label>
              <div className="relative">
                <User2 className="absolute left-3.5 top-3.5 h-4 w-4 text-[var(--spr-text-muted)]" />
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full bg-[var(--spr-surface-sunken)] border border-[var(--spr-border)] rounded-md pl-10 pr-4 py-3 text-sm text-[var(--spr-text)] focus:outline-none focus:border-[var(--spr-highlight)] cursor-pointer"
                >
                  <option value="Owner">Owner</option>
                  <option value="Admin">Administrator</option>
                  <option value="Technician">Security operator</option>
                  <option value="Viewer">Auditor or viewer</option>
                  <option value="Client">Client</option>
                </select>
              </div>
            </div>
            
            <p className="text-xs text-[var(--spr-text-muted)] leading-normal">
              As the person creating this workspace, your account will receive the Owner role.
            </p>
          </div>
        )}

        {/* STEP 2: CAPACITY ASSESSMENT */}
        {step === 2 && (
          <div className="space-y-4 text-left flex-1">
            <div>
              <h2 className="text-lg font-semibold">Tell us what you need</h2>
              <p className="mt-1 text-sm text-[var(--spr-text-muted)]">These answers personalize the workspace. They do not change your plan.</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-mono font-bold text-[var(--spr-text-muted)] uppercase mb-1.5">
                  Team members
                </label>
                <input
                  type="number"
                  min="1"
                  value={numTechnicians}
                  onChange={(e) => setNumTechnicians(e.target.value)}
                  className="w-full bg-[var(--spr-surface-sunken)] border border-[var(--spr-border)] rounded-md px-4 py-3 text-xs text-[var(--spr-text)] focus:outline-none focus:border-[var(--spr-highlight)] font-mono"
                />
              </div>

              <div>
                <label className="block text-[10px] font-mono font-bold text-[var(--spr-text-muted)] uppercase mb-1.5">
                  Clients
                </label>
                <input
                  type="number"
                  min="0"
                  value={clientCount}
                  onChange={(e) => setClientCount(e.target.value)}
                  className="w-full bg-[var(--spr-surface-sunken)] border border-[var(--spr-border)] rounded-md px-4 py-3 text-xs text-[var(--spr-text)] focus:outline-none focus:border-[var(--spr-highlight)] font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-mono font-bold text-[var(--spr-text-muted)] uppercase mb-1.5">
                Main goal
              </label>
              <select
                value={primaryUseCase}
                onChange={(e) => setPrimaryUseCase(e.target.value)}
                className="w-full bg-[var(--spr-surface-sunken)] border border-[var(--spr-border)] rounded-md px-4 py-3 text-xs text-[var(--spr-text)] focus:outline-none focus:border-[var(--spr-highlight)] cursor-pointer"
              >
                <option value="NIST Mapping & Risk Assessments">NIST Mapping & Risk Assessments</option>
                <option value="Continuous SBOM Monitoring">Continuous SBOM Monitoring</option>
                <option value="SOC 2 & Executive Compliance Audit">SOC 2 & Executive Compliance Audit</option>
                <option value="Software risk review">Software risk review</option>
              </select>
            </div>
          </div>
        )}

        {/* STEP 3: SECURITY & MFA SUPPORT */}
        {step === 3 && (
          <div className="space-y-4 text-left flex-1">
            <div>
              <h2 className="text-lg font-semibold">Protect your account</h2>
              <p className="mt-1 text-sm text-[var(--spr-text-muted)]">Add an authenticator code now, or turn this option off and continue.</p>
            </div>
            <div className="flex items-center justify-between p-3.5 bg-[var(--spr-surface-sunken)] rounded-md border border-[var(--spr-border)]">
              <div className="space-y-1 pr-2">
                <h4 className="text-sm font-semibold text-[var(--spr-text)]">Use an authenticator app</h4>
                <p className="text-xs text-[var(--spr-text-muted)] leading-normal">
                  Recommended for workspace owners.
                </p>
              </div>
              <input
                type="checkbox"
                checked={mfaEnabled}
                onChange={(e) => {
                  setMfaEnabled(e.target.checked);
                  if (!e.target.checked) {
                    setIsTotpVerified(false);
                    setTotpError(null);
                  }
                }}
                className="h-5 w-5 accent-[var(--spr-accent)] shrink-0 cursor-pointer"
              />
            </div>

            {mfaEnabled && (
              <div className="p-4 bg-[var(--spr-surface-sunken)] rounded-md border border-[var(--spr-border)] space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <KeyRound className="h-4 w-4 text-[var(--spr-highlight)]" />
                    <span className="text-[10px] font-mono uppercase text-[var(--spr-highlight)] font-bold tracking-wider">
                      Authenticator setup
                    </span>
                  </div>
                  {isTotpVerified && (
                    <span className="flex items-center gap-1 text-[10px] font-bold text-[var(--spr-green)]">
                      <CheckCircle2 className="h-3 w-3" />
                      MFA Verified
                    </span>
                  )}
                </div>
                
                {/* Local client-side TOTP QR code encoding otpauth URI */}
                <div className="flex gap-4 items-center">
                  <div className="bg-white p-1 rounded-lg shrink-0">
                    {qrDataUrl ? (
                      <img
                        src={qrDataUrl}
                        alt="TOTP MFA QR Code"
                        className="h-20 w-20"
                      />
                    ) : (
                      <div className="h-20 w-20 bg-[var(--spr-border)] flex items-center justify-center text-[10px] text-[var(--spr-text-muted)] font-mono">
                        Generating QR...
                      </div>
                    )}
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-[var(--spr-text-muted)] block">Manual setup key</span>
                    <span className="font-mono text-xs text-[var(--spr-text)] tracking-widest font-bold bg-[var(--spr-surface-sunken)] px-2 py-1 rounded border border-[var(--spr-border)] select-all block">
                      {mfaSecret?.secretKey || 'Generating...'}
                    </span>
                    <p className="text-[9px] text-[var(--spr-text-muted)]">
                      Scan the QR code, or enter this key in your authenticator app.
                    </p>
                  </div>
                </div>

                {/* Verification Code Input */}
                <div className="pt-2 border-t border-[var(--spr-border)] space-y-2">
                  <label className="text-[10px] font-mono uppercase text-[var(--spr-text-muted)] block">
                    Enter the 6-digit code
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      maxLength={6}
                      value={totpCodeInput}
                      onChange={(e) => {
                        setTotpCodeInput(e.target.value.replace(/\D/g, ''));
                        setTotpError(null);
                      }}
                      placeholder="e.g. 123456"
                      className="bg-[var(--spr-surface-sunken)] border border-[var(--spr-border)] rounded-md px-3 py-1.5 text-xs font-mono text-[var(--spr-text)] tracking-widest focus:outline-none focus:border-[var(--spr-highlight)] w-36"
                    />
                    <button
                      type="button"
                      onClick={handleVerifyTotp}
                      disabled={totpCodeInput.length !== 6 || totpVerifying}
                      className="spr-btn spr-btn-primary disabled:opacity-40 cursor-pointer"
                    >
                      {totpVerifying ? 'Verifying...' : 'Verify Code'}
                    </button>
                  </div>
                  {totpError && (
                    <p className="text-[10px] text-[var(--spr-red)] font-medium leading-tight">
                      {totpError}
                    </p>
                  )}
                  {isTotpVerified && (
                    <p className="text-[10px] text-[var(--spr-green)] font-medium leading-tight">
                      ✓ Code verified successfully! MFA active for this workspace.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* STEP 4: SERVER-BACKED WORKSPACE SETUP */}
        {step === 4 && (
          <div className="space-y-4 text-left flex-1 font-mono text-[11px] text-[var(--spr-text)] leading-normal">
            <div className="font-sans">
              <h2 className="text-lg font-semibold">Creating your workspace</h2>
              <p className="mt-1 text-sm text-[var(--spr-text-muted)]">SPR is saving your settings and applying your Owner permissions.</p>
            </div>
            <div className="p-4 bg-[var(--spr-surface-sunken)] rounded-md border border-[var(--spr-border)] space-y-2 min-h-36 max-h-48 overflow-y-auto" role="status" aria-live="polite">
              {setupLogs.map((log, index) => (
                <div key={index} className="flex gap-2 items-start text-[var(--spr-green)]">
                  <Check className="h-3.5 w-3.5 text-[var(--spr-green)] shrink-0 mt-0.5" />
                  <span>{log}</span>
                </div>
              ))}
              {setupLogs.length < 4 && (
                <div className="flex items-center gap-2 text-[var(--spr-text-muted)] animate-pulse">
                  <RefreshCw className="h-3 w-3 animate-spin text-[var(--spr-text-muted)]" />
                  <span>Saving your setup...</span>
                </div>
              )}
            </div>
            
            {setupLogs.length === 4 && (
              <div className="p-3 bg-[var(--spr-accent-soft)]/40 text-[var(--spr-highlight)] border border-[var(--spr-accent)]/40 rounded-md flex gap-2 items-center text-[10px]">
                <Sparkles className="h-4 w-4 text-[var(--spr-highlight)] shrink-0" />
                <span>Your workspace is ready.</span>
              </div>
            )}
          </div>
        )}

        {/* ACTIONS */}
        <div className="flex justify-between items-center mt-6 pt-4 border-t border-[var(--spr-border)]">
          {step > 1 && step < 4 ? (
            <button
              onClick={() => setStep((s) => (s - 1) as any)}
              className="spr-btn spr-btn-secondary cursor-pointer"
            >
              Back
            </button>
          ) : (
            <button
              onClick={handleSignOut}
              className="flex items-center gap-1 px-4 py-2 hover:bg-[var(--spr-red)]/10 hover:text-[var(--spr-red)] border border-transparent rounded-md text-[var(--spr-text-muted)] text-xs font-semibold cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Sign out</span>
            </button>
          )}

          {step < 4 ? (
            <button
              onClick={handleNextStep}
              className="flex items-center gap-1.5 spr-btn spr-btn-primary cursor-pointer"
            >
              <span>{step === 3 ? 'Create workspace' : 'Continue'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={handleCompleteOnboarding}
              disabled={setupLogs.length < 4 || loading}
              className="flex items-center gap-1.5 spr-btn spr-btn-primary cursor-pointer disabled:opacity-40"
            >
              {loading ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin text-white" />
              ) : (
                <>
                  <span>Open SPR</span>
                  <Check className="h-4 w-4" />
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
