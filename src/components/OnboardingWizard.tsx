/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import {
  ShieldCheck, ArrowRight, Building2, User2, Sliders, KeyRound, Check, RefreshCw, Sparkles, LogOut, CheckCircle2
} from 'lucide-react';
import { auth } from '../lib/firebase';
import { apiFetch } from '../utils/apiClient';

interface OnboardingWizardProps {
  user: any;
  onOnboardingComplete: (updatedUser: any) => void;
}

// Base32 decode and standard RFC 6238 TOTP generator
async function generateTOTPCode(base32Secret: string, timeOffset: number = 0): Promise<string> {
  const cleanSecret = base32Secret.replace(/\s+/g, '').toUpperCase();
  const base32chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (let i = 0; i < cleanSecret.length; i++) {
    const val = base32chars.indexOf(cleanSecret.charAt(i));
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.substring(i * 8, i * 8 + 8), 2);
  }

  const counter = Math.floor(Date.now() / 1000 / 30) + timeOffset;
  const counterBuffer = new ArrayBuffer(8);
  const counterView = new DataView(counterBuffer);
  counterView.setUint32(0, 0, false);
  counterView.setUint32(4, counter, false);

  const cryptoKey = await window.crypto.subtle.importKey(
    'raw',
    bytes,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const signature = await window.crypto.subtle.sign('HMAC', cryptoKey, counterBuffer);
  const hmac = new Uint8Array(signature);

  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (binary % 1000000).toString().padStart(6, '0');
}

async function verifyTOTPCode(base32Secret: string, inputCode: string): Promise<boolean> {
  const code = inputCode.trim();
  if (!/^\d{6}$/.test(code)) return false;
  
  for (const offset of [0, -1, 1]) {
    const valid = await generateTOTPCode(base32Secret, offset);
    if (valid === code) return true;
  }
  return false;
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
  const [mfaSecret, setMfaSecret] = useState(() => {
    // Generate a cryptographically secure Base32 TOTP secret key
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const randomBytes = new Uint8Array(16);
    if (typeof window !== 'undefined' && window.crypto) {
      window.crypto.getRandomValues(randomBytes);
    }
    let secret = '';
    for (let i = 0; i < 16; i++) {
      secret += chars.charAt(randomBytes[i] % chars.length);
    }
    return secret.match(/.{1,4}/g)?.join(' ') || secret;
  });

  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [totpCodeInput, setTotpCodeInput] = useState<string>('');
  const [isTotpVerified, setIsTotpVerified] = useState<boolean>(false);
  const [totpVerifying, setTotpVerifying] = useState<boolean>(false);
  const [totpError, setTotpError] = useState<string | null>(null);

  useEffect(() => {
    if (mfaEnabled && mfaSecret) {
      const cleanSecret = mfaSecret.replace(/\s+/g, '');
      const otpauth = `otpauth://totp/SoftwarePassportRegistry:${encodeURIComponent(companyName || 'User')}?secret=${cleanSecret}&issuer=SoftwarePassportRegistry`;
      QRCode.toDataURL(otpauth, { margin: 1, width: 160 })
        .then(url => setQrDataUrl(url))
        .catch(err => console.error('Failed to generate local QR code:', err));
    }
  }, [mfaEnabled, mfaSecret, companyName]);

  const handleVerifyTotp = async () => {
    setTotpVerifying(true);
    setTotpError(null);
    try {
      const res = await apiFetch('/api/organization/security/verify-mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: totpCodeInput,
          secret: mfaSecret
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setIsTotpVerified(true);
      } else {
        setIsTotpVerified(false);
        setTotpError(data.error || 'Invalid 6-digit TOTP code. Please check your authenticator app time and enter the current code.');
      }
    } catch (err: any) {
      setIsTotpVerified(false);
      setTotpError(err?.message || 'Verification error. Please enter a valid 6-digit numeric code.');
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
    <div className="min-h-screen w-screen flex flex-col items-center justify-center bg-slate-900 font-sans text-white p-4">
      {/* Background Ambience */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full bg-emerald-500/5 blur-3xl pointer-events-none" />

      {/* Header Info */}
      <div className="text-center space-y-2 mb-8 relative z-10">
        <div className="flex justify-center mb-4">
          <div className="bg-indigo-500/10 border border-indigo-500/30 p-3 rounded-2xl">
            <ShieldCheck className="h-8 w-8 text-indigo-400" />
          </div>
        </div>
        <h1 className="text-3xl font-bold tracking-tight font-display">Set up your SPR workspace</h1>
        <p className="text-sm text-slate-300 max-w-md">
          Four short steps. You can change these settings later.
        </p>
      </div>

      {/* Wizard Card */}
      <div className="max-w-md w-full bg-slate-950 border border-slate-800 rounded-3xl p-6 md:p-8 shadow-2xl relative z-10 flex flex-col justify-between min-h-[380px]">
        
        {/* Progress Bar */}
        <div className="flex items-center justify-between mb-6 border-b border-slate-900 pb-4">
          <span className="text-[10px] font-mono uppercase text-slate-400 font-bold tracking-wider">
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
                    ? 'bg-indigo-500' 
                    : s < step 
                      ? 'bg-emerald-500' 
                      : 'bg-slate-800'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Errors Display */}
        {error && (
          <div className="mb-4 p-3 bg-rose-950/40 text-rose-300 border border-rose-900/50 rounded-xl text-xs flex gap-2 items-start">
            <Sliders className="h-4 w-4 shrink-0 mt-0.5 text-rose-400" />
            <p>{error}</p>
          </div>
        )}

        {/* STEP 1: WORKSPACE NAME & ROLE */}
        {step === 1 && (
          <div className="space-y-4 text-left flex-1">
            <div>
              <h2 className="text-lg font-semibold">Name your workspace</h2>
              <p className="mt-1 text-sm text-slate-400">Use the company or team name your members will recognize.</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Workspace name
              </label>
              <div className="relative">
                <Building2 className="absolute left-3.5 top-3.5 h-4 w-4 text-slate-500" />
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Example: Acme Security"
                  autoFocus
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-4 py-3 text-sm text-white focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Your role
              </label>
              <div className="relative">
                <User2 className="absolute left-3.5 top-3.5 h-4 w-4 text-slate-500" />
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-4 py-3 text-sm text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  <option value="Owner">Owner</option>
                  <option value="Admin">Administrator</option>
                  <option value="Technician">Security operator</option>
                  <option value="Viewer">Auditor or viewer</option>
                  <option value="Client">Client</option>
                </select>
              </div>
            </div>
            
            <p className="text-xs text-slate-400 leading-normal">
              As the person creating this workspace, your account will receive the Owner role.
            </p>
          </div>
        )}

        {/* STEP 2: CAPACITY ASSESSMENT */}
        {step === 2 && (
          <div className="space-y-4 text-left flex-1">
            <div>
              <h2 className="text-lg font-semibold">Tell us what you need</h2>
              <p className="mt-1 text-sm text-slate-400">These answers personalize the workspace. They do not change your plan.</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase mb-1.5">
                  Team members
                </label>
                <input
                  type="number"
                  min="1"
                  value={numTechnicians}
                  onChange={(e) => setNumTechnicians(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase mb-1.5">
                  Clients
                </label>
                <input
                  type="number"
                  min="0"
                  value={clientCount}
                  onChange={(e) => setClientCount(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase mb-1.5">
                Main goal
              </label>
              <select
                value={primaryUseCase}
                onChange={(e) => setPrimaryUseCase(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
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
              <p className="mt-1 text-sm text-slate-400">Add an authenticator code now, or turn this option off and continue.</p>
            </div>
            <div className="flex items-center justify-between p-3.5 bg-slate-900 rounded-2xl border border-slate-800">
              <div className="space-y-1 pr-2">
                <h4 className="text-sm font-semibold text-slate-200">Use an authenticator app</h4>
                <p className="text-xs text-slate-400 leading-normal">
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
                className="h-5 w-5 accent-indigo-500 shrink-0 cursor-pointer"
              />
            </div>

            {mfaEnabled && (
              <div className="p-4 bg-black/60 rounded-2xl border border-slate-850 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <KeyRound className="h-4 w-4 text-indigo-400" />
                    <span className="text-[10px] font-mono uppercase text-indigo-300 font-bold tracking-wider">
                      Authenticator setup
                    </span>
                  </div>
                  {isTotpVerified && (
                    <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-800/80 px-2 py-0.5 rounded-full">
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
                      <div className="h-20 w-20 bg-slate-200 flex items-center justify-center text-[10px] text-slate-500 font-mono">
                        Generating QR...
                      </div>
                    )}
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-slate-400 block">Manual setup key</span>
                    <span className="font-mono text-xs text-white tracking-widest font-bold bg-slate-900 px-2 py-1 rounded border border-slate-800 select-all block">
                      {mfaSecret}
                    </span>
                    <p className="text-[9px] text-slate-500">
                      Scan the QR code, or enter this key in your authenticator app.
                    </p>
                  </div>
                </div>

                {/* Verification Code Input */}
                <div className="pt-2 border-t border-slate-800 space-y-2">
                  <label className="text-[10px] font-mono uppercase text-slate-400 block">
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
                      className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs font-mono text-white tracking-widest focus:outline-none focus:border-indigo-500 w-36"
                    />
                    <button
                      type="button"
                      onClick={handleVerifyTotp}
                      disabled={totpCodeInput.length !== 6 || totpVerifying}
                      className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-bold text-xs px-3 py-1.5 rounded-xl cursor-pointer transition-colors"
                    >
                      {totpVerifying ? 'Verifying...' : 'Verify Code'}
                    </button>
                  </div>
                  {totpError && (
                    <p className="text-[10px] text-rose-400 font-medium leading-tight">
                      {totpError}
                    </p>
                  )}
                  {isTotpVerified && (
                    <p className="text-[10px] text-emerald-400 font-medium leading-tight">
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
          <div className="space-y-4 text-left flex-1 font-mono text-[11px] text-slate-300 leading-normal">
            <div className="font-sans">
              <h2 className="text-lg font-semibold">Creating your workspace</h2>
              <p className="mt-1 text-sm text-slate-400">SPR is saving your settings and applying your Owner permissions.</p>
            </div>
            <div className="p-4 bg-black/80 rounded-2xl border border-slate-850 space-y-2 min-h-36 max-h-48 overflow-y-auto" role="status" aria-live="polite">
              {setupLogs.map((log, index) => (
                <div key={index} className="flex gap-2 items-start text-emerald-400">
                  <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                  <span>{log}</span>
                </div>
              ))}
              {setupLogs.length < 4 && (
                <div className="flex items-center gap-2 text-slate-500 animate-pulse">
                  <RefreshCw className="h-3 w-3 animate-spin text-slate-400" />
                  <span>Saving your setup...</span>
                </div>
              )}
            </div>
            
            {setupLogs.length === 4 && (
              <div className="p-3 bg-indigo-950/20 text-indigo-300 border border-indigo-900/40 rounded-xl flex gap-2 items-center text-[10px]">
                <Sparkles className="h-4 w-4 text-indigo-400 shrink-0" />
                <span>Your workspace is ready.</span>
              </div>
            )}
          </div>
        )}

        {/* ACTIONS */}
        <div className="flex justify-between items-center mt-6 pt-4 border-t border-slate-900">
          {step > 1 && step < 4 ? (
            <button
              onClick={() => setStep((s) => (s - 1) as any)}
              className="px-4 py-2 hover:bg-slate-900 border border-slate-800 rounded-xl text-slate-400 text-xs font-semibold cursor-pointer"
            >
              Back
            </button>
          ) : (
            <button
              onClick={handleSignOut}
              className="flex items-center gap-1 px-4 py-2 hover:bg-rose-950/10 hover:text-rose-400 border border-transparent rounded-xl text-slate-500 text-xs font-semibold cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Sign out</span>
            </button>
          )}

          {step < 4 ? (
            <button
              onClick={handleNextStep}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-4 rounded-xl shadow-lg text-xs cursor-pointer"
            >
              <span>{step === 3 ? 'Create workspace' : 'Continue'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={handleCompleteOnboarding}
              disabled={setupLogs.length < 4 || loading}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 px-4 rounded-xl shadow-lg text-xs cursor-pointer disabled:opacity-40"
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
